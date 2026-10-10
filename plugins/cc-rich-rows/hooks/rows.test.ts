import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { markdown, outputText, tableOf } from './table'

const VIEWPORT = { columns: 100, rows: 40, isFullscreen: true }
const JSON_ROWS = JSON.stringify([
  { number: 64, title: 'cc-turn-review: check each turn', state: 'MERGED' },
  { number: 63, title: 'Remove skill-smith', state: 'MERGED' },
])

// The engine's own drawing of a result is an empty Box, so a test tells it from the mod's table.
function world(on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.log', async () => ({ value: undefined }))
  on('ui.render', async ($, e) => $.ui.resolve(e).Box({}))
  on('tool.call', async () => {
    await clock.sleep(1_200)
    return { result: { stdout: JSON_ROWS, stderr: '', interrupted: false } } as never
  })
  return clock
}

const bash = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout, stderr: '', interrupted: false, ...extra })

function mount($: Engine, tool: string, output: unknown, opts: { isErrored?: boolean; id?: string; columns?: number } = {}) {
  const id = opts.id ?? 'toolu_x'
  return $.ui.mount({
    plugin: 'cc-rich-rows',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: id,
    viewport: { ...VIEWPORT, columns: opts.columns ?? VIEWPORT.columns },
    props: { tool_use_id: id, tool, output, isErrored: opts.isErrored ?? false },
  })
}

test('a Bash JSON array of objects draws as a table, with rows and time in the footer', async ($, on) => {
  const clock = world(on)
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_1', command: 'gh pr list --json number,title,state' })
  await clock.advance(1_200)
  await call
  const ui = await mount($, 'Bash', bash(JSON_ROWS), { id: 'toolu_1' })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(
    ['| number | title | state |', '|---|---|---|', '| 64 | cc-turn-review: check each turn | MERGED |', '| 63 | Remove skill-smith | MERGED |'].join('\n'),
  )
  expect((await ui.find({ type: 'Text' }))?.text).toBe('2 rows · 1.2s')
})

test('a table wider than the transcript still draws, its cells left to wrap', async ($, on) => {
  world(on)
  const ui = await mount($, 'Bash', bash(JSON.stringify([{ text: 'x'.repeat(120) }])), { columns: 40 })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('x'.repeat(120))
})

test('an MCP text block holding CSV draws as a table', async ($, on) => {
  world(on)
  const ui = await mount($, 'mcp__db__query', [{ type: 'text', text: 'id,name\n1,"Smith, Ann"\n2,Bo\n' }])
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('| id | name |\n|---|---|\n| 1 | Smith, Ann |\n| 2 | Bo |')
  expect((await ui.find({ type: 'Text' }))?.text).toBe('2 rows')
})

test('output that would not show whole, or is not a table, keeps the engine drawing', async ($, on) => {
  world(on)
  const many = JSON.stringify(Array.from({ length: 21 }, (_, n) => ({ n })))
  const cases: [string, unknown, { isErrored?: boolean; columns?: number }?][] = [
    ['Bash', bash(many)],
    ['Bash', bash(JSON_ROWS), { isErrored: true }],
    ['Bash', bash(JSON_ROWS, { stderr: 'warning: x' })],
    ['Bash', bash(JSON_ROWS, { backgroundTaskId: 'b1' })],
    ['Bash', bash('total 8\ndrwxr-xr-x  2 me  staff  64 Oct 10 a\n')],
    ['Bash', bash('64\tfix the build\tfeat/x\tOPEN\n63\tdocs\tfeat/y\tMERGED\n')],
    ['Read', { type: 'text', file: { content: JSON_ROWS } }],
  ]
  for (const [tool, output, opts] of cases) {
    const ui = await mount($, tool, output, opts)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  }
})

const groupCall = (id: string, command: string, stdout: string, extra: Record<string, unknown> = {}) => ({
  tool_use_id: id,
  tool: 'Bash',
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: bash(stdout),
  ...extra,
})

function group($: Engine, calls: ReturnType<typeof groupCall>[], isExpanded = false) {
  return $.ui.mount({
    plugin: 'cc-rich-rows',
    surface: 'terminal',
    component: 'ToolGroup',
    viewport: VIEWPORT,
    props: { calls, isActive: false, isExpanded },
  })
}

test('a folded group keeps its count line and draws its table under it', async ($, on) => {
  world(on)
  const ui = await group($, [groupCall('g1', 'gh pr list --json number,title,state', JSON_ROWS)])
  const drawn = await ui.drawn()
  expect(drawn.type).toBe('Box')
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text)).toEqual(['2 rows'])
})

test('a folded group of several calls captions each table with its command', async ($, on) => {
  world(on)
  const ui = await group($, [
    groupCall('g1', 'git status', 'On branch main\n'),
    groupCall('g2', 'gh pr list --json number,title,state', JSON_ROWS),
    groupCall('g3', 'curl -s api/x', 'id,name\n1,a\n'),
  ])
  expect((await ui.findAll({ type: 'Markdown' })).length).toBe(2)
  expect((await ui.findAll({ type: 'Text' })).map(one => one.text)).toEqual(['$ gh pr list --json number,title,state', '2 rows', '$ curl -s api/x', '1 row'])
})

test('an expanded, running or errored group call keeps the engine drawing', async ($, on) => {
  world(on)
  const cases = [
    group($, [groupCall('g1', 'gh pr list --json n', JSON_ROWS)], true),
    group($, [groupCall('g2', 'gh pr list --json n', JSON_ROWS, { isRunning: true })]),
    group($, [groupCall('g3', 'gh pr list --json n', JSON_ROWS, { isErrored: true })]),
  ]
  for (const pending of cases) {
    const ui = await pending
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  }
})

test('table helpers', async () => {
  expect(tableOf('name\tsize\na.ts\t12\nb.ts\t3')).toEqual({ header: ['name', 'size'], rows: [['a.ts', '12'], ['b.ts', '3']] })
  expect(tableOf('[{"a":1},{"b":{"c":true}}]')).toEqual({ header: ['a', 'b'], rows: [['1', ''], ['', '{"c":true}']] })
  expect(tableOf('[1,2,3]')).toBeNull()
  expect(tableOf('[]')).toBeNull()
  expect(tableOf('a,b\n1,2,3')).toBeNull()
  expect(tableOf('Hello, world\nHow are, you')).toBeNull()
  expect(tableOf('name,name\n1,2')).toBeNull()
  expect(markdown({ header: ['a|b'], rows: [['x\ny']] })).toBe('| a\\|b |\n|---|\n| x y |')
  expect(outputText('mcp__x__y', { content: [{ type: 'text', text: 'a' }, { type: 'image', data: '' }] })).toBeNull()
  expect(outputText('mcp__x__y', 'plain')).toBe('plain')
  expect(outputText('Bash', bash('out', { returnCodeInterpretation: 'No matches found' }))).toBeNull()
})
