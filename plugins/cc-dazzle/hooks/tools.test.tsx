import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { formatDuration } from './tables'
import { CLAUDE_DIFF, THEME as t } from './theme'

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const call = (tool: string, input: unknown, id: string, extra: Record<string, unknown> = {}) =>
  ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra })

const toolUse = (tool: string, input: unknown, id: string, extra: Record<string, unknown> = {}) =>
  ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'ToolUse' as const, props: call(tool, input, id, extra), viewport: { columns: 100, rows: 10 } })

const group = (calls: ReturnType<typeof call>[], isExpanded = false) =>
  ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'ToolGroup' as const, props: { calls, isActive: false, isExpanded }, viewport: { columns: 100, rows: 40 } })

const result = (tool: string, output: unknown, id: string, isErrored = false) =>
  ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'ToolResult' as const, requestId: id, props: { tool_use_id: id, tool, output, isErrored }, viewport: { columns: 100, rows: 40 } })

const expand = async ($: Engine, id: string) => {
  const ui = await $.ui.mount(group([call('Bash', { command: 'ls' }, id)], true))
  await ui.unmount()
}

const bash = (stdout: string) => ({ stdout, stderr: '', interrupted: false })

const PRS = JSON.stringify([
  { number: 67, title: 'cc-rich-rows: draw tables', state: 'MERGED' },
  { number: 66, title: 'cc-timeline: a side pane', state: 'MERGED' },
])

type Ui = { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }
const footers = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(n => n.text ?? '').filter(text => /rows?( ·|$)/.test(text))

test('a Bash call draws as one dim row behind a bold corner, the command colored', async $ => {
  const ui = await $.ui.mount(toolUse('Bash', { command: 'gh pr view 12 --json state' }, 'b1'))
  expect((await ui.find({ type: 'Text', text: /^ {2}└─ $/ }))?.props).toMatchObject({ bold: true, color: t.number })
  expect(await ui.find({ type: 'Text', text: /⎿/ })).toBeUndefined()
  const line = (await ui.findAll({ type: 'Text' })).find(n => n.props.wrap === 'truncate-end')
  expect(line?.props.dimColor).toBe(true)
  expect(line?.text).toBe('Ran gh pr view 12 --json state')
  expect((await ui.find({ type: 'Text', text: /^gh$/ }))?.props.color).toBe(t.codeCommand)
  expect((await ui.find({ type: 'Text', text: /^--json$/ }))?.props.color).toBe(t.codeFlag)
  await ui.unmount()
})

test('a Read call draws Read and the path shortened against home', async ($, on) => {
  mock.env(on, { HOME: '/home/demo' })
  on('session.root', () => ({ value: '/home/demo/tank-monitor' }))
  const ui = await $.ui.mount(toolUse('Read', { file_path: '/home/demo/notes/todo.md' }, 'r1'))
  expect((await ui.findAll({ type: 'Text' })).find(n => n.props.wrap === 'truncate-end')?.text).toBe('Read ~/notes/todo.md')
  expect((await ui.find({ type: 'Text', text: /^~\/notes\/todo\.md$/ }))?.props.color).toBe(t.path)
  await ui.unmount()
})

test('an expanded tool group goes to the engine, and an expanded Bash row shows command and output', async ($, on) => {
  engine(on)
  const opened = await $.ui.mount(group([call('Bash', { command: 'ls' }, 'x1')], true))
  expect(await opened.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await opened.unmount()
  await expand($, 'x2')
  const row = await $.ui.mount({ ...toolUse('Bash', { command: 'gh run list --repo "a/b"' }, 'x2'), props: { ...call('Bash', { command: 'gh run list --repo "a/b"' }, 'x2'), output: { stdout: 'in_progress\n', stderr: 'warn' } } })
  expect(await row.find({ type: 'Text', text: /^Bash\($/ })).toBeDefined()
  expect((await row.find({ type: 'Text', text: /^gh$/ }))?.props.color).toBe(t.codeCommand)
  expect(await row.find({ type: 'Text', text: /^in_progress$/ })).toBeDefined()
  expect((await row.find({ type: 'Text', text: /^warn$/ }))?.props.color).toBe(t.codeFlag)
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await row.unmount()
})

test('an Edit result draws a diff card in Claude Code colors with the changed words marked', async ($, on) => {
  engine(on)
  const js = { filePath: '/tmp/app.js', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' function greet() {', '-  log("Hello, World!");', '+  log("Hello, Claude!");', ' }'] }] }
  const ui = await $.ui.mount(result('Edit', js, 'e1'))
  expect((await ui.find({ type: 'Text', text: /^\+1$/ }))?.props.color).toBe(t.number)
  expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ type: 'Box', text: /^2 \+ {3}log\("Hello, Claude!"\);$/ }))?.props.backgroundColor).toBe(CLAUDE_DIFF.dark.addBg)
  expect((await ui.find({ type: 'Box', text: /^2 - {3}log\("Hello, World!"\);$/ }))?.props.backgroundColor).toBe(CLAUDE_DIFF.dark.delBg)
  expect((await ui.find({ type: 'Text', text: /^Claude$/ }))?.props.backgroundColor).toBe(CLAUDE_DIFF.dark.addWord)
  expect((await ui.find({ type: 'Text', text: /^World$/ }))?.props.backgroundColor).toBe(CLAUDE_DIFF.dark.delWord)
  expect((await ui.find({ type: 'Text', text: /^ {2}└─ $/ }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

test('a .ts file diff gets Prism colors', async ($, on) => {
  engine(on)
  const ts = { filePath: '/tmp/app.ts', structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' const a = 1', '-const b = "same" // 1', '+const b = "same" // 2'] }] }
  const ui = await $.ui.mount(result('Edit', ts, 'e2'))
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ type: 'Text', text: /^"same"$/ }))?.props.color).toBe(t.codeString)
  await ui.unmount()
})

test('a long diff folds behind a more-lines button that unfolds it through the unfolded state', async ($, on) => {
  engine(on)
  const content = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n')
  const ui = await $.ui.mount(result('Write', { type: 'create', filePath: '/tmp/new.txt', content }, 'w1'))
  expect(await ui.find({ type: 'Text', text: /^line 20$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^line 21$/ })).toBeUndefined()
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
  await ui.press({ key: 'fold' })
  expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
  await ui.unmount()
  const again = await $.ui.mount(result('Write', { type: 'create', filePath: '/tmp/new.txt', content }, 'w1'))
  expect(await again.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
  expect((await again.find({ key: 'fold' }))?.props.label).toBe('show less')
  await again.unmount()
})

test('an errored Edit and a non-tabular result go to the engine', async ($, on) => {
  engine(on)
  const patch = { filePath: '/tmp/app.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b'] }] }
  for (const target of [result('Edit', patch, 'n1', true), result('Edit', 'File updated', 'n2'), result('Bash', bash('total 8\nfile a\n'), 'n3'), result('Read', patch, 'n4')]) {
    const ui = await $.ui.mount(target)
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Bash output in columns draws as a boxed table with a row count and the run time from tool.call', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', async () => {
    await clock.sleep(400)
    return { result: bash(PRS) } as never
  })
  const ran = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_t', command: 'gh pr list --json number,title,state' } as never)
  await clock.advance(400)
  await ran
  const ui = await $.ui.mount(result('Bash', bash(PRS), 'toolu_t'))
  expect((await ui.find({ type: 'Text', text: /^number$/ }))?.props.color).toBe(t.tableHeader)
  expect(await ui.find({ type: 'Text', text: /^╞[═╪]+╡$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^cc-timeline: a side pane$/ })).toBeDefined()
  expect(await footers(ui)).toEqual(['2 rows · 0.4s'])
  await ui.unmount()
})

test('a collapsed tool group with tabular output draws its row with a preview table under it', async $ => {
  const long = JSON.stringify(Array.from({ length: 143 }, (_, n) => ({ n, name: `item ${n}` })))
  const ui = await $.ui.mount(group([call('Bash', { command: 'gh issue list --json number,title --limit 200' }, 'g1', { output: bash(long) })]))
  expect((await ui.findAll({ type: 'Text' })).find(n => n.props.wrap === 'truncate-end')?.text).toBe('Ran 1 command · last: gh issue list --json number,title --limit 200')
  expect(await ui.find({ type: 'Text', text: /^item 19$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^item 20$/ })).toBeUndefined()
  expect(await footers(ui)).toEqual(['20 of 143 rows · ctrl+o shows all'])
  await ui.unmount()
})

test('run times show tenths below 10 seconds and whole units above', () => {
  expect([0, 400, 2340, 9949, 9960, 75_000, 3_725_000].map(formatDuration)).toEqual(['0.0s', '0.4s', '2.3s', '9.9s', '10s', '1m 15s', '1h 2m'])
})
