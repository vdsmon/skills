import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, RenderSurface } from 'claude-code'

import type { Drawn, Fold } from './blocks'
import { instanceKey, noteTip, renderBlocks } from './blocks'
import type { ClipboardBackend } from './clipboard'
import { clipboardCommand } from './clipboard'
import { clockText, promptKey, sentAt, withRecord } from './clock'
import type { Block } from './markdown'
import { parse } from './markdown'
import { boxArt, inlineMarks, mermaidText, shortenEdgeLabels, unsupportedKind } from './mermaid'
import { renderUserPrompt } from './prompt'
import { openText, registerStretch, stretchBody, stretchNote, writtenText } from './stretch/index'
import { deliveredText, isQueued, withQueued, withoutDelivered } from './queue'
import type { Table } from './tables'
import { MAX_ROWS, PREVIEW_ROWS, captionOf, isTabular, markdownTable, tableFooter, toolTable } from './tables'
import { remember, width } from './text'
import type { Style } from './theme'
import { THEME } from './theme'
import { bashEdits, editNotes, hasShellOutput, renderBashEdits, renderDiffCard, renderExpandedShell, renderToolGroup, renderToolRow, withoutBashEdits } from './tools'
import { takesClickableMarks, takesEditorLinks, takesHttpLinks } from './version'

const expandedCalls = new Set<string>()

const markExpanded = (id: string) => {
  expandedCalls.delete(id)
  expandedCalls.add(id)
  if (expandedCalls.size > 500) expandedCalls.delete(expandedCalls.values().next().value!)
}

const columnsOf = (viewport?: { columns?: number }) => Math.max(20, (viewport?.columns ?? 100) - 4)

const unfolded = atom({ plugin: 'cc-dazzle', key: 'unfolded' } as const, [] as string[])
const sent = atom({ plugin: 'cc-dazzle', key: 'sent' } as const, [])
const queued = atom({ plugin: 'cc-dazzle', key: 'queued' } as const, [] as string[])

const firstDrawn = async ($: EngineInterface, id: string): Promise<number> => {
  const ref = { plugin: 'cc-dazzle', key: 'drawn', id } as const
  const { value } = await $.state.get(ref)
  if (value !== undefined) return value
  const now = await $.clock.now()
  $.clock.after(0, () => void $.state.set(ref, now, { ifVersion: 0 }))
  return now
}

const locate = async ($: EngineInterface, style: Style) => {
  style.cwd = await $.session.root().catch(() => style.cwd)
  style.home ||= (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
}

const htmlBackend = async ($: EngineInterface): Promise<ClipboardBackend | null> => {
  if (await $.env.get('SSH_CONNECTION') || await $.env.get('SSH_TTY')) return null
  const helper = await $.fs.stat('/usr/bin/osascript').catch(() => null)
  return helper?.kind === 'file' ? 'macos' : null
}

type Reach = { http: boolean; editor: boolean; marks: boolean }

type Probes = { htmlCopy?: Promise<ClipboardBackend | null>; reach?: Promise<Reach> }

// What this Claude Code release opens: plain http links, VS Code file links and clickable footnote marks.
const reachOf = ($: EngineInterface, probes: Probes): Promise<Reach> =>
  (probes.reach ??= $.session.version().then(v => ({ http: takesHttpLinks(v.base), editor: takesEditorLinks(v.base), marks: takesClickableMarks(v.base) }), () => ({ http: false, editor: false, marks: false })))

const probe = async ($: EngineInterface, style: Style, probes: Probes): Promise<void> => {
  probes.htmlCopy ??= htmlBackend($)
  style.htmlCopy = await probes.htmlCopy
}

const copyTable = async ($: EngineInterface, html: string, text: string): Promise<string | null> => {
  const command = clipboardCommand(html, text)
  const result = await $.process.run(command.argv, { stdin: command.stdin, timeoutMs: 5000 }).catch(() => null)
  if (!result) return command.failure
  return result.exitCode === 0 ? null : result.stderr.trim() || command.failure
}

const folder = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, open?: string[]): Fold => (id, hidden, key) => {
  if (!open) return null
  const folded = !open.includes(id)
  return { folded, element: <el.Button key={key} variant="secondary" label={folded ? `+${hidden} more lines` : 'show less'} onPress={() => update($, unfolded, ids => (folded ? [...ids, id].slice(-500) : ids.filter(x => x !== id)))} /> }
}

const drawMarkdown = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, style: Style, blocks: ReturnType<typeof parse>, columns: number, open?: string[], notes?: { id: string; press: boolean }): RenderElement[] => {
  const { Button } = el
  const copy = (text: string | (() => string), key: string, label = '⧉ copy', html?: () => string) => {
    const copied = async (surface: RenderSurface): Promise<string> => {
      const content = typeof text === 'function' ? text() : text
      const failure = html && style.htmlCopy ? await copyTable($, html(), content) : undefined
      if (failure === null) return 'Copied formatted table'
      const result = await $.ui.copy({ text: content, surface })
      if (!result.isCopied) return `Copy failed: ${result.reason}`
      return failure ? `Copied as plain text (${failure})` : 'Copied'
    }
    return !html || style.htmlCopy ? (
      <Button
        key={key}
        variant="primary"
        label={label}
        onPress={async press => $.ui.toast(await copied(press.surface).catch(() => 'Copy failed'))}
      />
    ) : null
  }
  const drawn: Drawn = new Map()
  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid') continue
    const source = block.lines.join('\n')
    let narrowest = Infinity
    for (const max of [Infinity, 24, 12]) {
      const art = mermaidText(max === Infinity ? source : shortenEdgeLabels(source, max), columns)
      const wide = art === null ? Infinity : Math.max(...art.split('\n').map(width))
      narrowest = Math.min(narrowest, wide)
      if (art === null || wide > columns - 6) continue
      drawn.set(i, { element: boxArt(el, style, art, `b${i}`, inlineMarks(source)), art })
      break
    }
    if (!drawn.has(i) && !block.isOpen) {
      const kind = unsupportedKind(source)
      drawn.set(i, { note: kind ? `${kind} diagrams draw as source for now` : narrowest === Infinity ? 'diagram failed to render' : `diagram is ${narrowest} cols, terminal is ${columns}` })
    }
  }
  const tip = notes?.press ? noteTip(blocks, text => void $.ui.toast(text)) : undefined
  return renderBlocks(el, notes ? { ...style, noteKey: instanceKey(notes.id) } : style, blocks, columns, drawn, copy, folder($, el, open), tip)
}

const toolTableView = async ($: EngineInterface, e: RenderInput, style: Style, blocks: Block[], table: Table, id: string | undefined, shown: number, caption?: string): Promise<RenderElement> => {
  const el = $.ui.resolve(e)
  const { Box, Text } = el
  const ms = id === undefined ? undefined : (await $.state.get({ plugin: 'cc-dazzle', key: 'took', id })).value
  return (
    <Box key={`table-${id ?? caption ?? ''}`} flexDirection="column">
      {caption === undefined ? null : <Text color={style.theme.codeComment} wrap="truncate-end">{caption}</Text>}
      {drawMarkdown($, el, style, blocks, columnsOf(e.viewport))}
      <Text color={style.theme.codeComment}>{tableFooter(table.rows.length, shown, ms)}</Text>
    </Box>
  )
}

const isOwn = (kind: string) => kind === 'composer' || kind === 'bridge'

export const register: Register = (on, options) => {
  const style: Style = { theme: THEME, htmlCopy: null, cwd: '', home: '', copyButtonStyle: options.copyButtonStyle === 'hover' ? 'hover' : 'inline' }
  const parsed = new Map<string, ReturnType<typeof parse>>()
  const parseCached = (text: string) => remember(parsed, text, () => parse(text, { numbers: true, paths: true }))
  const forSurface = (base: Style, surface: RenderSurface, reach?: Reach): Style => {
    const drawn = surface === 'terminal' ? (reach?.http || reach?.editor ? { ...base, httpLinks: reach.http, editorLinks: reach.editor } : base) : base.htmlCopy ? { ...base, htmlCopy: null } : base
    // The phone app has no pointer to hover with.
    return surface === 'mobile' && drawn.copyButtonStyle === 'hover' ? { ...drawn, copyButtonStyle: 'inline' } : drawn
  }
  const probes: Probes = {}
  const shellCommands = new Map<string, string>()
  const noteCommand = (id: string | undefined, tool: string, input: unknown) => {
    const command = tool === 'Bash' && input !== null && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
    if (!id || typeof command !== 'string') return
    shellCommands.delete(id)
    shellCommands.set(id, command)
    if (shellCommands.size > 500) shellCommands.delete(shellCommands.keys().next().value!)
  }
  let firstEdit: string | undefined
  if (options.stretch === true) registerStretch(on)

  on('tool.call', async ($, e, next) => {
    if (!isTabular(e.tool)) return next(e)
    const start = await $.clock.now()
    const ran = await next(e)
    await $.state.set({ plugin: 'cc-dazzle', key: 'took', id: e.tool_use_id }, (await $.clock.now()) - start)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await locate($, style)
    for (const call of e.props.calls) noteCommand(call.tool_use_id, call.tool, call.input)
    if (e.props.isExpanded) {
      for (const call of e.props.calls) if (call.tool_use_id) markExpanded(call.tool_use_id)
      return next(e)
    }
    const row = renderToolGroup($.ui.resolve(e), style, e.props.calls, e.props.isActive)
    const found = e.props.calls.flatMap(call => {
      const table = call.isRunning || call.isErrored || call.isInterrupted ? null : toolTable(call.tool, call.output)
      return table === null ? [] : [{ call, table }]
    })
    if (found.length === 0) return row
    const { Box } = $.ui.resolve(e)
    const alone = e.props.calls.length === 1
    const tables = await Promise.all(found.map(({ call, table }) => toolTableView($, e, forSurface(style, e.surface), parseCached(markdownTable(table, Math.min(table.rows.length, PREVIEW_ROWS))), table, call.tool_use_id, Math.min(table.rows.length, PREVIEW_ROWS), alone ? undefined : captionOf(call.tool, call.input))))
    return (
      <Box flexDirection="column">
        {row}
        <Box flexDirection="column" paddingLeft={2}>{tables}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await locate($, style)
    noteCommand(e.props.tool_use_id, e.props.tool, e.props.input)
    if (!expandedCalls.has(e.props.tool_use_id)) return renderToolRow($.ui.resolve(e), style, e.props)
    const shell = e.props.tool === 'Bash' || e.props.tool === 'PowerShell'
    return shell && typeof e.props.output !== 'string' ? renderExpandedShell($.ui.resolve(e), style, e.props) : next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if ((e.props.tool === 'Edit' || e.props.tool === 'Write') && !e.props.isErrored) {
      const el = $.ui.resolve(e)
      return renderDiffCard(el, style, e.props.output, folder($, el, await read($, unfolded)), e.props.tool_use_id) ?? next(e)
    }
    const edits = e.props.tool === 'Bash' && !e.props.isErrored ? bashEdits(e.props.output) : undefined
    if (edits) {
      await locate($, style)
      const el = $.ui.resolve(e)
      const output = withoutBashEdits(e.props.output)
      const above = hasShellOutput(output) ? await next({ ...e, props: { ...e.props, output } }) : null
      firstEdit ??= e.props.tool_use_id
      const notes = editNotes(edits, firstEdit === e.props.tool_use_id, shellCommands.get(e.props.tool_use_id))
      const cards = renderBashEdits(el, style, edits, folder($, el, await read($, unfolded)), e.props.tool_use_id, above !== null, notes)
      return above === null ? cards : <el.Box flexDirection="column">{above}{cards}</el.Box>
    }
    if (!e.props.isErrored) {
      const table = toolTable(e.props.tool, e.props.output)
      if (table !== null && table.rows.length <= MAX_ROWS) return toolTableView($, e, forSurface(style, e.surface), parseCached(markdownTable(table)), table, e.props.tool_use_id, table.rows.length)
    }
    return next(e)
  })

  // The html copy check also runs here so replies drawn before the first prompt of a resumed session get the button.
  on('session.start', async ($, e, next) => {
    await probe($, style, probes)
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (e.message.name === 'queued_command') await update($, queued, list => withoutDelivered(list, deliveredText(e.message.content)))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, queued, () => [])
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.turnId !== undefined && isOwn(e.origin.kind)) await update($, queued, list => withQueued(list, e.text))
    if (isOwn(e.origin.kind)) {
      const at = await $.clock.now()
      await update($, sent, list => withRecord(list, { text: promptKey(e.text), at }))
    }
    await probe($, style, probes)
    const note = options.stretch === true && e.origin.kind === 'composer' ? await stretchNote($).catch(() => undefined) : undefined
    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    if (e.props.text.includes('\u001b')) return next(e)
    const blocks = parseCached(e.props.text)
    if (blocks.length === 0) return next(e)
    const el = $.ui.resolve(e)
    const { Box } = el
    const open = await read($, unfolded)
    return <Box flexDirection="column" rowGap={1}>{drawMarkdown($, el, forSurface(style, e.surface, await reachOf($, probes)), blocks, columnsOf(e.viewport), open)}</Box>
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const kind = e.props.origin.kind
    const own = isOwn(kind) || (kind === 'unclassified' && !e.props.from && !e.props.task)
    if (!own) return next(e)
    const at = sentAt(await read($, sent), e.props.text, await firstDrawn($, e.requestId))
    const time = at === undefined ? undefined : clockText(at, await $.clock.now())
    const waiting = isQueued(await read($, queued), e.props.text)
    return renderUserPrompt($.ui.resolve(e), style, e.props.text, time, waiting)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const open = await read($, unfolded)
    const reach = await reachOf($, probes)
    const notes = { id: e.requestId, press: reach.marks }
    const drawStyle = forSurface(style, e.surface, reach)
    const draw = (text: string) => drawMarkdown($, el, drawStyle, parseCached(text), columnsOf(e.viewport), open, notes)
    const reply = (body: RenderElement[]) => (
      <Box flexDirection="row" marginTop={1}>
        <Box width={2} flexShrink={0}>
          <Text color={style.theme.accent}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexDirection="column" rowGap={1} flexGrow={1}>{body}</Box>
      </Box>
    )
    const text = options.stretch === true && e.props.isSummary !== true ? await writtenText($, e.props.text) : e.props.text
    const stretched = options.stretch === true && e.props.isSummary !== true ? await stretchBody($, { ...e, props: { ...e.props, text } }, draw) : undefined
    if (stretched?.framed) return <Box flexDirection="column" rowGap={1} marginTop={1}>{stretched.body}</Box>
    if (stretched !== undefined) return reply(stretched.body)
    const blocks = parseCached(openText(e.props.text))
    if (blocks.length === 0) return next(e)
    return reply(drawMarkdown($, el, drawStyle, blocks, columnsOf(e.viewport), open, notes))
  })
}
