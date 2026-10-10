import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { Table } from './table'
import { markdown, outputText, tableOf } from './table'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function took(ms: number) {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

/**
 * A row of its own shows the whole table or none: no event says when ctrl+o
 * expands it, so a cut table would stay cut there. A folded group shows the
 * first rows only, since ctrl+o unfolds it to the raw output.
 */
const MAX_ROWS = 20
const PREVIEW_ROWS = 20

const isTabular = (tool: string) => tool === 'Bash' || tool.startsWith('mcp__')

/** A finished call's output as a table, else null. A table wider than the transcript wraps its cells, as a reply's does. */
function tableFor(tool: string, output: unknown): Table | null {
  if (!isTabular(tool)) return null
  const text = outputText(tool, output)
  return text === null ? null : tableOf(text)
}

/** What a group's table is captioned with: the command, or the MCP tool's name. */
function captionOf(tool: string, input: unknown) {
  const command = typeof input === 'object' && input !== null && 'command' in input ? String(input.command) : ''
  if (tool === 'Bash') return `$ ${command.split('\n')[0] ?? ''}`
  return tool.split('__').slice(1).join(' ')
}

async function block($: EngineInterface, e: RenderInput, table: Table, id: string | undefined, caption?: string) {
  const { Box, Markdown, Text } = $.ui.resolve(e)
  const ms = id === undefined ? undefined : (await $.state.get({ plugin: 'cc-rich-rows', key: 'took', id })).value
  const total = table.rows.length
  const shown = Math.min(total, PREVIEW_ROWS)
  const count = shown < total ? `${shown} of ${plural(total, 'row')}` : plural(total, 'row')
  const footer = [count, ...(ms === undefined ? [] : [took(ms)]), ...(shown < total ? ['ctrl+o shows all'] : [])].join(' · ')
  return (
    <Box key={`table-${id ?? caption ?? ''}`} flexDirection="column">
      {caption !== undefined && (
        <Text dimColor wrap="truncate-end">
          {caption}
        </Text>
      )}
      <Markdown text={markdown({ header: table.header, rows: table.rows.slice(0, shown) })} />
      <Text dimColor>{footer}</Text>
    </Box>
  )
}

export const register: Register = on => {
  // Times the calls whose output may become a table, for the footer.
  on('tool.call', async ($, e, next) => {
    if (!isTabular(e.tool)) return next(e)
    const start = await $.clock.now()
    const ran = await next(e)
    try {
      await $.state.set({ plugin: 'cc-rich-rows', key: 'took', id: e.tool_use_id }, (await $.clock.now()) - start)
    } catch (error) {
      $.ui.log(`cc-rich-rows: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Draws a table only when it holds every row; any other output keeps the engine's drawing.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const table = tableFor(e.props.tool, e.props.output)
    return table === null || table.rows.length > MAX_ROWS ? next(e) : block($, e, table, e.props.tool_use_id)
  })

  // The transcript folds read-only calls (most `gh`, `curl` and `jq` runs) into one count line,
  // which no ToolResult is drawn for. Their tables go under that line; ctrl+o unfolds the raw output.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const found = e.props.calls.flatMap(call => {
      if (call.isRunning || call.isErrored || call.isInterrupted) return []
      const table = tableFor(call.tool, call.output)
      return table === null ? [] : [{ call, table }]
    })
    if (found.length === 0) return next(e)
    const { Box } = $.ui.resolve(e)
    const line = await next(e)
    const isAlone = e.props.calls.length === 1
    const tables: RenderElement[] = []
    for (const { call, table } of found) tables.push(await block($, e, table, call.tool_use_id, isAlone ? undefined : captionOf(call.tool, call.input)))
    // Indented to the count line's text, which the transcript starts 2 cells in.
    return (
      <Box flexDirection="column">
        {line}
        <Box flexDirection="column" paddingLeft={2}>
          {tables}
        </Box>
      </Box>
    )
  })
}
