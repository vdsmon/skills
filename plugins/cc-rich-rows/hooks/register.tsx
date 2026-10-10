import type { Register } from 'claude-code'

import { fits, markdown, outputText, tableOf } from './table'

/** Cells the transcript keeps left of a tool result: its `⎿` gutter, and a margin. */
const GUTTER = 6

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function took(ms: number) {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

const isTabular = (tool: string) => tool === 'Bash' || tool.startsWith('mcp__')

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

  // Draws a table only when every row and column fits; any other output keeps the engine's drawing.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored || !isTabular(e.props.tool)) return next(e)
    const text = outputText(e.props.tool, e.props.output)
    const table = text === null ? null : tableOf(text)
    const columns = (e.viewport?.columns ?? 100) - GUTTER
    if (table === null || !fits(table, columns)) return next(e)
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const { value: ms } = await $.state.get({ plugin: 'cc-rich-rows', key: 'took', id: e.props.tool_use_id })
    const footer = [plural(table.rows.length, 'row'), ...(ms === undefined ? [] : [took(ms)])].join(' · ')
    return (
      <Box flexDirection="column">
        <Markdown text={markdown(table)} />
        <Text dimColor>{footer}</Text>
      </Box>
    )
  })
}
