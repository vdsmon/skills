import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bar, duration, labelOf, ordered } from './timeline'

const PANE = {
  title: 'Timeline',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

let clock: MockClock

type Seen = { took: Map<string, number>; fails: Set<string>; agents: { id: string; description: string }[] }

// Tools that take the time the test gives each call id, and fail when told to.
function world(on: On): Seen {
  clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  const seen: Seen = { took: new Map(), fails: new Set(), agents: [] }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', async () => ({ value: undefined }) as never)
  on('ui.render', async ($, e) => $.ui.resolve(e).Box({}))
  on('agent.list', async () => ({ value: seen.agents.map(one => ({ ...one, type: 'general-purpose', status: 'running' })) }) as never)
  on('tool.call', async (_$, e) => {
    await clock.sleep(seen.took.get(e.tool_use_id) ?? 0)
    if (seen.fails.has(e.tool_use_id)) return { deny: 'failed' }
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('command.run', async () => ({ text: '' }))
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: '/home/me/app', surface: 'terminal', isInteractive: true })
}

type Input = { tool: string; tool_use_id: string; [key: string]: unknown }

/** Runs one call that takes `ms`, moving the clock while it runs. */
async function run($: Engine, seen: Seen, input: Input, ms: number) {
  seen.took.set(input.tool_use_id, ms)
  const done = $.tool.call(input as never)
  await clock.advance(ms)
  return done
}

const pane = ($: Engine) => $.ui.mount({ plugin: 'cc-timeline', surface: 'terminal', component: 'Pane', requestId: 'cc-timeline', props: PANE })
const slash = ($: Engine) => $.command.run({ command: 'timeline', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
const flat = (node: unknown): string => (typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(flat).join(''))
const rowText = async (ui: Awaited<ReturnType<typeof pane>>, id: string) => {
  const row = await ui.find({ key: `call-${id}` })
  return row === undefined ? undefined : flat(row).replace(/\s+/g, ' ').trim()
}

test('a turn draws one row per call, with its label, duration and an error in red', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ text: 'fix the build\nplease', turnId: 't1' })
  await run($, seen, { tool: 'Read', tool_use_id: 'r1', file_path: '/home/me/app/src/index.ts' }, 200)
  seen.fails.add('b1')
  await run($, seen, { tool: 'Bash', tool_use_id: 'b1', command: 'npm test', description: 'Run the tests' }, 3_000)
  await $.turn.complete({ answer: 'done', durationMs: 3_200, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await pane($)
  expect((await ui.find({ type: 'Text', text: /^Turn 1/ }))?.text).toBe('Turn 1 · 3.2s · 2 calls')
  expect((await ui.find({ type: 'Text', text: /fix the build/ }))?.text).toBe('“fix the build”')
  expect(await rowText(ui, 'r1')).toMatch(/^Read index\.ts █? ?.*0\.2s$/)
  expect(await rowText(ui, 'b1')).toMatch(/^Bash Run the tests .*█+.* 3\.0s$/)
  const red = (await ui.findAll({ type: 'Text' })).filter(one => one.props.color === 'error' && one.text.includes('█'))
  expect(red.length).toBe(1)
})

test("a subagent's calls sit under its Agent call, whose bar runs to their end", async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ text: 'look around', turnId: 't1' })
  seen.agents.push({ id: 'agent-1', description: 'Scan the repo' })
  seen.took.set('a1', 5_000)
  const agent = $.tool.call({ tool: 'Agent', tool_use_id: 'a1', description: 'Scan the repo', prompt: 'scan', subagent_type: 'Explore' } as never)
  await clock.advance(1_000)
  await run($, seen, { tool: 'Grep', tool_use_id: 'g1', pattern: 'TODO', agentId: 'agent-1' }, 1_000)
  await clock.advance(3_000)
  await agent
  await run($, seen, { tool: 'Edit', tool_use_id: 'e1', file_path: '/x/a.ts', old_string: 'a', new_string: 'b' }, 500)
  const ui = await pane($)
  const keys = (await ui.findAll({ type: 'Box' })).flatMap(one => (one.key?.startsWith('call-') ? [one.key] : []))
  expect(keys).toEqual(['call-a1', 'call-g1', 'call-e1'])
  expect(await rowText(ui, 'g1')).toMatch(/^└ Grep TODO /)
  expect(await rowText(ui, 'a1')).toMatch(/ 5\.0s$/)
})

test('an open pane grows a running bar each second', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ text: 'build', turnId: 't1' })
  expect((await slash($)).text).toBe('Timeline pane opened.')
  seen.took.set('b1', 60_000)
  const running = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'make' } as never)
  await clock.settle()
  const ui = await pane($)
  await clock.advance(2_000)
  expect(await rowText(ui, 'b1')).toMatch(/2\.0s…$/)
  await clock.advance(10_000)
  expect(await rowText(ui, 'b1')).toMatch(/12s…$/)
  await clock.advance(48_000)
  await running
  expect(await rowText(ui, 'b1')).toMatch(/ 1m00s$/)
})

test('the arrows walk back through earlier turns, and a new turn shows the latest again', async ($, on) => {
  const seen = world(on)
  await start($)
  for (const id of ['t1', 't2']) {
    await $.turn.start({ text: `turn ${id}`, turnId: id })
    await run($, seen, { tool: 'Read', tool_use_id: `r-${id}`, file_path: `/x/${id}.ts` }, 100)
    await $.turn.complete({ answer: 'ok', durationMs: 100, isAborted: false, turnId: id, reason: 'answer' })
  }
  const ui = await pane($)
  expect((await ui.find({ type: 'Text', text: /^Turn/ }))?.text).toContain('Turn 2')
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['prev'])
  await ui.press({ key: 'prev' })
  expect((await ui.find({ type: 'Text', text: /^Turn/ }))?.text).toContain('Turn 1')
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['next', 'latest'])
  await $.turn.start({ text: 'turn 3', turnId: 't3' })
  expect((await ui.find({ type: 'Text', text: /^Turn/ }))?.text).toContain('Turn 3')
})

test('a very long turn keeps its last 300 calls and says how many it left out', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.start({ text: 'big run', turnId: 't1' })
  for (let n = 0; n < 305; n += 1) await run($, seen, { tool: 'Read', tool_use_id: `r${n}`, file_path: `/x/${n}.ts` }, 10)
  const ui = await pane($)
  expect((await ui.find({ type: 'Text', text: /^Turn/ }))?.text).toBe('Turn 1 · 3.0s… · 305 calls, first 5 not shown')
  expect(await rowText(ui, 'r4')).toBeUndefined()
  expect(await rowText(ui, 'r5')).toMatch(/^Read 5\.ts/)
})

test('/timeline opens the pane, and closes it when open', async ($, on) => {
  world(on)
  await start($)
  expect((await slash($)).text).toBe('Timeline pane opened.')
  expect((await slash($)).text).toBe('Timeline pane closed.')
})

test('helpers', async () => {
  expect(bar(0, 500, 0, 1_000, 10)).toEqual({ pad: '', bar: '█████' })
  expect(bar(500, 1_000, 0, 1_000, 10)).toEqual({ pad: '     ', bar: '█████' })
  expect(bar(0, 1, 0, 1_000, 10)).toEqual({ pad: '', bar: '▏' })
  expect(bar(0, 160, 0, 1_000, 10)).toEqual({ pad: '', bar: '█▋' })
  expect(bar(999, 5_000, 0, 1_000, 10)).toEqual({ pad: '         ', bar: '█' })
  expect([duration(400), duration(12_400), duration(64_000), duration(119_700)]).toEqual(['0.4s', '12s', '1m04s', '2m00s'])
  expect(labelOf('Bash', { command: '\n  git status\nmore' })).toBe('git status')
  expect(labelOf('Edit', { file_path: '/a/b/c.ts' })).toBe('c.ts')
  expect(labelOf('WebFetch', { url: 'https://docs.x.dev/a/b' })).toBe('docs.x.dev')
  expect(labelOf('mcp__claude_ai_Slack__slack_read_thread', {})).toBe('claude_ai_Slack')
  const calls = [
    { id: 'a', tool: 'Agent', label: '', start: 0, end: 1, isError: false },
    { id: 'b', tool: 'Read', label: '', start: 0, end: 1, isError: false, parentId: 'a' },
    { id: 'c', tool: 'Read', label: '', start: 0, end: 1, isError: false, parentId: 'gone' },
  ]
  expect(ordered(calls).map(one => [one.call.id, one.depth])).toEqual([['a', 0], ['b', 1], ['c', 0]])
})
