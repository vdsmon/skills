import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Call, Turn } from '../types'
import type { Kind } from './timeline'
import { bar, duration, kindOf, labelOf, ordered, span, toolName } from './timeline'

const PANE = 'cc-timeline'
const MAX_TURNS = 20
/** Per turn: past it the oldest calls are dropped, so a long agent run does not grow each state write without end. */
const MAX_CALLS = 300
const TICK_MS = 1_000

const turnsAtom = atom({ plugin: 'cc-timeline', key: 'turns' } as const, [])
const selectedAtom = atom({ plugin: 'cc-timeline', key: 'selected' } as const, null)
const nowAtom = atom({ plugin: 'cc-timeline', key: 'now' } as const, 0)

const COLOR: Record<Kind, string> = { read: 'suggestion', edit: 'success', shell: 'warning', agent: 'merged', mcp: 'planMode', other: 'inactive' }

/** Which Agent call each subagent loop belongs to, by agent id. */
const parents = new Map<string, string | undefined>()
let ticker: Timer | null = null

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const firstLine = (text: string) => (text.split('\n').find(line => line.trim() !== '') ?? '').trim().slice(0, 200)

function withCall(turns: Turn[], turnId: string | undefined, call: Call): Turn[] {
  const index = turnId === undefined ? -1 : turns.findIndex(turn => turn.id === turnId)
  const at = index === -1 ? turns.length - 1 : index
  if (at === -1) return [{ id: `before-${call.id}`, n: 1, prompt: '', start: call.start, end: null, calls: [call] }]
  return turns.map((turn, i) => {
    if (i !== at) return turn
    const calls = [...turn.calls, call]
    const over = calls.length - MAX_CALLS
    return over > 0 ? { ...turn, calls: calls.slice(over), dropped: (turn.dropped ?? 0) + over } : { ...turn, calls }
  })
}

/** The Agent call a subagent's loop came from: the running one whose description matches the agent's. */
async function parentOf($: EngineInterface, agentId: string, turns: readonly Turn[]): Promise<string | undefined> {
  if (parents.has(agentId)) return parents.get(agentId)
  const agent = (await $.agent.list()).find(one => one.id === agentId)
  const claimed = new Set(parents.values())
  const candidates = turns.flatMap(turn => turn.calls).filter(call => call.tool === 'Agent' && call.description === agent?.description && !claimed.has(call.id))
  const parent = candidates.find(call => call.end === null) ?? candidates[candidates.length - 1]
  parents.set(agentId, parent?.id)
  return parent?.id
}

async function begin($: EngineInterface, e: Readonly<Record<string, unknown>> & { tool: string; tool_use_id: string; agentId?: string }) {
  const start = await $.clock.now()
  const turns = e.agentId === undefined ? [] : await read($, turnsAtom)
  const parentId = e.agentId === undefined ? undefined : await parentOf($, e.agentId, turns)
  const call: Call = {
    id: e.tool_use_id,
    tool: e.tool,
    label: labelOf(e.tool, e),
    start,
    end: null,
    isError: false,
    ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(e.tool === 'Agent' && typeof e.description === 'string' ? { description: e.description } : {}),
  }
  const home = parentId === undefined ? undefined : turns.find(turn => turn.calls.some(one => one.id === parentId))?.id
  await update($, turnsAtom, current => withCall(current, home, call))
  if (await isUp($)) {
    await update($, nowAtom, () => start)
    startTicker($)
  }
}

async function finish($: EngineInterface, id: string, isError: boolean) {
  const end = await $.clock.now()
  await update($, turnsAtom, turns =>
    turns.map(turn => (turn.calls.some(call => call.id === id) ? { ...turn, calls: turn.calls.map(call => (call.id === id ? { ...call, end, isError } : call)) } : turn)),
  )
  if (await isUp($)) await update($, nowAtom, () => end)
}

// The engine's record, not a value of the mod's: a reload closes and reopens panes behind the mod's back.
const isUp = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE)

const isRunning = (turns: readonly Turn[]) => turns.some(turn => turn.calls.some(call => call.end === null))

// Redraws running bars once a second, only while the pane is open and a call runs.
function startTicker($: EngineInterface) {
  if (ticker !== null) return
  ticker = $.clock.every(TICK_MS, () => void tick($))
}

async function tick($: EngineInterface) {
  if (!(await isUp($)) || !isRunning(await read($, turnsAtom))) {
    ticker?.cancel()
    ticker = null
    return
  }
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
}

async function toggle($: EngineInterface) {
  if ((await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)) {
    await $.ui.close({ id: PANE })
    return 'Timeline pane closed.'
  }
  const now = await $.clock.now()
  await update($, nowAtom, () => now)
  if (isRunning(await read($, turnsAtom))) startTicker($)
  const opened = await $.ui.open({ id: PANE, title: 'Timeline' })
  return opened.isPlaced ? 'Timeline pane opened.' : `The timeline pane is waiting: ${opened.reason}`
}

/** An Agent call's bar runs to its last subagent call's end, since a background agent returns at once. */
function withChildren(calls: readonly Call[]): Call[] {
  return calls.map(call => {
    if (call.tool !== 'Agent') return call
    const children = calls.filter(one => one.parentId === call.id)
    if (children.length === 0 || call.end === null) return call
    const end = children.some(one => one.end === null) ? null : Math.max(call.end, ...children.map(one => one.end ?? 0))
    return { ...call, end }
  })
}

const fit = (text: string, width: number) => (text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(0, width - 1))}…`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started
    try {
      await $.command.register({ name: 'timeline', description: 'Show or hide a timeline of the tool calls in each turn' })
    } catch (error) {
      $.ui.log(`cc-timeline: could not register /timeline: ${errorText(error)}`, { to: 'debug' })
    }
    return started
  })

  // A subagent's run raises no turn.start, so each one here is a turn of the main loop.
  on('turn.start', async ($, e, next) => {
    const start = await $.clock.now()
    await update($, turnsAtom, turns => [...turns, { id: e.turnId, n: (turns[turns.length - 1]?.n ?? 0) + 1, prompt: firstLine(e.text), start, end: null, calls: [] }].slice(-MAX_TURNS))
    await update($, selectedAtom, () => null)
    if (await isUp($)) await update($, nowAtom, () => start)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const end = await $.clock.now()
      await update($, turnsAtom, turns => turns.map(turn => (turn.id === e.turnId ? { ...turn, end } : turn)))
      if (await isUp($)) await update($, nowAtom, () => end)
    }
    return next(e)
  })

  // Times every tool call around its own run. Fails open: a missed call is only missing from the chart.
  on('tool.call', async ($, e, next) => {
    try {
      await begin($, e as unknown as Readonly<Record<string, unknown>> & { tool: string; tool_use_id: string; agentId?: string })
    } catch (error) {
      $.ui.log(`cc-timeline: ${errorText(error)}`, { to: 'debug' })
    }
    const ran = await next(e)
    try {
      await finish($, e.tool_use_id, ran.deny !== undefined || ran.isError === true)
    } catch (error) {
      $.ui.log(`cc-timeline: ${errorText(error)}`, { to: 'debug' })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'timeline' }, async $ => ({ text: await toggle($) }))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      parents.clear()
      await update($, turnsAtom, () => [])
      await update($, selectedAtom, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const turns = await read($, turnsAtom)
    const selected = await read($, selectedAtom)
    const now = await read($, nowAtom)
    if (turns.length === 0) return <Text dimColor>No turn yet. Each turn's tool calls show here as bars on a time axis.</Text>

    const index = Math.max(0, selected === null ? turns.length - 1 : turns.findIndex(turn => turn.id === selected))
    const turn = turns[index] ?? turns[turns.length - 1]!
    const show = (at: number) => () => void update($, selectedAtom, () => (at >= turns.length - 1 ? null : (turns[at]?.id ?? null)))
    const calls = withChildren(turn.calls)
    const axis = span({ ...turn, calls }, now)
    const isLive = turn.end === null || calls.some(call => call.end === null)

    const width = Math.max(30, e.props.bodyColumns)
    const labelWidth = Math.min(32, Math.max(12, Math.round(width * 0.35)))
    const durationWidth = 7
    const barWidth = Math.max(8, width - labelWidth - durationWidth - 2)
    const total = duration(axis.span)

    const header = (
      <Box key="head" flexDirection="row" gap={1}>
        {index > 0 && <Button key="prev" label="◀" hotkey="p" onPress={show(index - 1)} />}
        <Text bold wrap="truncate-end">{`Turn ${turn.n} · ${total}${isLive ? '…' : ''} · ${plural(calls.length + (turn.dropped ?? 0), 'call')}${turn.dropped ? `, first ${turn.dropped} not shown` : ''}`}</Text>
        {index < turns.length - 1 && <Button key="next" label="▶" hotkey="n" onPress={show(index + 1)} />}
        {index < turns.length - 1 && <Button key="latest" label="Latest" hotkey="l" onPress={show(turns.length - 1)} />}
      </Box>
    )

    const rows = ordered(calls).map(({ call, depth }) => {
      const end = call.end ?? now
      const { pad, bar: drawn } = bar(call.start, end, axis.from, axis.span, barWidth)
      const indent = depth === 0 ? '' : `${'  '.repeat(depth - 1)}└ `
      const name = `${indent}${toolName(call.tool)}${call.label === '' ? '' : ` ${call.label}`}`
      const took = `${duration(end - call.start)}${call.end === null ? '…' : ''}`
      return (
        <Box key={`call-${call.id}`}>
          <Text wrap="truncate-end">
            {fit(name, labelWidth)} {pad}
            <Text color={call.isError ? 'error' : COLOR[kindOf(call.tool)]}>{drawn}</Text>
            {' '.repeat(Math.max(0, barWidth - pad.length - drawn.length))} <Text dimColor={!call.isError} color={call.isError ? 'error' : undefined}>{took.padStart(durationWidth - 1)}</Text>
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {header}
        {turn.prompt !== '' && (
          <Text dimColor wrap="truncate-end">
            {`“${turn.prompt}”`}
          </Text>
        )}
        <Box marginTop={1} flexDirection="column">
          {rows.length === 0 ? <Text dimColor>No tool calls in this turn.</Text> : rows}
        </Box>
        {rows.length > 0 && (
          <Text dimColor>
            {' '.repeat(labelWidth + 1)}
            {`0s${' '.repeat(Math.max(1, barWidth - 2 - total.length))}${total}`}
          </Text>
        )}
        <Text dimColor>
          {(['read', 'edit', 'shell', 'agent', 'mcp'] as const).map(kind => (
            <Text>
              <Text color={COLOR[kind]}>■</Text> {kind}{'  '}
            </Text>
          ))}
          <Text color="error">■</Text> error
        </Text>
      </Box>
    )
  })
}
