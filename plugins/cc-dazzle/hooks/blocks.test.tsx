import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { MAC_TABLE_COPY } from './clipboard'
import { THEME as t } from './theme'

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const reply = (text: string, isFirstOfReply = true, columns = 100) => ({
  plugin: 'cc-dazzle',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply },
  viewport: { columns, rows: 40 },
})

type Node = { type?: string; key?: unknown; text?: string; props: Record<string, unknown>; children?: unknown[] }
type Ui = { findAll: (q: { type: string }) => Promise<Node[]> }

const within = (node: unknown, match: (n: Node) => boolean): boolean => {
  if (node === null || typeof node !== 'object') return false
  const n = node as Node
  return match(n) || (n.children ?? []).some(child => within(child, match))
}

const drawn = (node: unknown): string =>
  typeof node === 'string' ? node : node !== null && typeof node === 'object' ? ((node as Node).children ?? []).map(drawn).join('') : ''

const isButton = (label?: string) => (n: Node) => n.type === 'Button' && (label === undefined || n.props.label === label)

const labels = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
const roundBoxes = async (ui: Ui) => (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round')

const recordCopies = (on: On) => {
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return copies
}

const recordToasts = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

const macEnv = (on: On, environment: Record<string, string> = {}) => {
  mock.env(on, environment)
  on('fs.stat', (_, e, next) => e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')
    ? { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
    : next(e))
}

const startSession = async ($: Engine, on: On) => {
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

const runResult = (exitCode: number, stderr = '') =>
  ({ value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

const TABLE = '| Name | Value |\n|--|--:|\n| **api** | `2.14.0` |'

test('a reply part has the dot on the first part only, and a blank line before each part', async $ => {
  const first = await $.ui.mount(reply('One sentence.'))
  expect((await first.findAll({ type: 'Box' }))[0]?.props.marginTop).toBe(1)
  expect((await first.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(t.accent)
  await first.unmount()
  const later = await $.ui.mount(reply('Another sentence.', false))
  expect((await later.findAll({ type: 'Box' }))[0]?.props.marginTop).toBe(1)
  expect(await later.find({ type: 'Text', text: /^●$/ })).toBeUndefined()
  await later.unmount()
})

test('a one-paragraph reply is not bold', async $ => {
  const ui = await $.ui.mount(reply('Just one sentence here.'))
  const texts = (await ui.findAll({ type: 'Text' })).filter(n => /Just one sentence/.test(n.text ?? ''))
  expect(texts.length).toBeGreaterThan(0)
  expect(texts.every(n => !n.props.bold)).toBe(true)
  await ui.unmount()
})

test('H1 draws bold over a heavy rule, H2 bold alone, both with no box', async $ => {
  const ui = await $.ui.mount(reply('# Title\n\n## Section'))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'bold')).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^Title$/ }))?.props).toMatchObject({ bold: true, color: t.heading })
  expect((await ui.find({ type: 'Text', text: /^━━━━━$/ }))?.props.color).toBe(t.heading)
  expect((await ui.find({ type: 'Text', text: /^Section$/ }))?.props).toMatchObject({ bold: true, color: t.heading })
  expect(await ui.find({ type: 'Text', text: /^━━━━━━━$/ })).toBeUndefined()
  await ui.unmount()
})

test('a table draws boxed with a double line under the header and md, art and html buttons', async ($, on) => {
  macEnv(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply(TABLE))
  const top = (await ui.find({ type: 'Text', text: /^┌[─┬]+┐$/ }))?.text ?? ''
  expect(top.split('┬').length).toBe(2)
  const under = (await ui.find({ type: 'Text', text: /^╞[═╪]+╡$/ }))?.text ?? ''
  expect(under.length).toBe(top.length)
  expect((await ui.find({ type: 'Text', text: /^└[─┴]+┘$/ }))?.text.length).toBe(top.length)
  expect((await ui.find({ type: 'Text', text: /^Name$/ }))?.props.color).toBe(t.tableHeader)
  expect(await labels(ui)).toEqual(['⧉ md', '⧉ art', '⧉ html'])
  await ui.unmount()
})

test('html copy runs the macOS helper, falls back to plain text with the reason, and hides over SSH', async ($, on) => {
  macEnv(on)
  const calls: { argv: readonly string[]; input: string }[] = []
  let fail = false
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, input: e.init?.stdin ?? '' })
    return fail ? runResult(1, 'Clipboard unavailable') : runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply(TABLE))
  await ui.press({ key: 'html0' })
  expect(calls[0]?.argv).toEqual(['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_TABLE_COPY])
  const payload = JSON.parse(calls[0]?.input ?? '{}')
  expect(payload.text).toBe('Name\tValue\napi\t2.14.0')
  expect(payload.html).toContain('<strong>api</strong>')
  expect(payload.html).toContain('<code style="white-space: pre-wrap">2.14.0</code>')
  expect(copies).toEqual([])
  fail = true
  await ui.press({ key: 'html0' })
  expect(copies).toEqual(['Name\tValue\napi\t2.14.0'])
  expect(toasts).toEqual(['Copied formatted table', 'Copied as plain text (Clipboard unavailable)'])
  await ui.unmount()
})

test('the html button is hidden over SSH', async ($, on) => {
  macEnv(on, { SSH_CONNECTION: 'remote connection' })
  let processes = 0
  on('process.run', () => {
    processes++
    return { deny: 'Must not run the native helper' }
  })
  await startSession($, on)
  const ui = await $.ui.mount(reply(TABLE))
  expect(await labels(ui)).toEqual(['⧉ md', '⧉ art'])
  expect(processes).toBe(0)
  await ui.unmount()
})

test('a task list shows brackets and check marks, done items dimmed and struck through', async $ => {
  const ui = await $.ui.mount(reply('- [ ] todo\n- [x] done'))
  expect((await ui.find({ type: 'Text', text: /^\[ \] $/ }))?.props.color).toBe(t.bullet)
  expect((await ui.find({ type: 'Text', text: /^\[✓\] $/ }))?.props.color).toBe(t.bullet)
  expect((await ui.find({ type: 'Text', text: /^done$/ }))?.props).toMatchObject({ dimColor: true, strikethrough: true })
  expect((await ui.find({ type: 'Text', text: /^todo$/ }))?.props.dimColor).toBeFalsy()
  await ui.unmount()
})

test('numbers and file paths in prose get their colors', async $ => {
  const ui = await $.ui.mount(reply('Version 2.14.0 lives in /tmp/app.ts now.'))
  expect((await ui.find({ type: 'Text', text: /^2\.14\.0$/ }))?.props.color).toBe(t.number)
  expect((await ui.find({ type: 'Text', text: /^\/tmp\/app\.ts$/ }))?.props.color).toBe(t.path)
  await ui.unmount()
})

test('a code block draws its language and copy button above a rounded box', async $ => {
  const ui = await $.ui.mount(reply('Run:\n\n```python\nprint("hi")\n```'))
  expect((await ui.find({ type: 'Text', text: /^ python$/ }))?.props.color).toBe(t.codeComment)
  const [box] = await roundBoxes(ui)
  expect(box?.props.borderColor).toBe(t.rule)
  expect(drawn(box)).toContain('print("hi")')
  expect(drawn(box)).not.toContain('python')
  const isRound = (n: Node) => n.type === 'Box' && n.props.borderStyle === 'round'
  const parent = (await ui.findAll({ type: 'Box' })).find(b => ((b.children ?? []) as Node[]).some(c => c !== null && typeof c === 'object' && isRound(c)))
  const order = ((parent?.children ?? []) as Node[]).filter(n => n !== null && typeof n === 'object')
  const label = order.findIndex(n => n.type === 'Box' && drawn(n) === ' python')
  expect(label).toBeGreaterThanOrEqual(0)
  expect(label).toBeLessThan(order.findIndex(isRound))
  const top = order[label]
  expect(top?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' })
  const last = (top?.children ?? []).filter(Boolean).at(-1) as Node | undefined
  expect(last?.type).toBe('Button')
  expect(within(box, isButton())).toBe(false)
  expect(last?.props.label).toBe('⧉ copy')
  await ui.unmount()
})

test('a TypeScript code block gets Prism colors', async $ => {
  const ui = await $.ui.mount(reply('```ts\nconst name = "shop" // app\n```'))
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ type: 'Text', text: /^"shop"$/ }))?.props.color).toBe(t.codeString)
  expect((await ui.find({ type: 'Text', text: /^\/\/ app$/ }))?.props).toMatchObject({ color: t.codeComment, italic: true })
  await ui.unmount()
})

test('a console block colors commands, leaves output plain and copies the commands only', async ($, on) => {
  const copies = recordCopies(on)
  const ui = await $.ui.mount(reply('Run:\n\n```console\n$ git status --short\n## main...origin/main\n$ mise run test\nok - cc-keepwarm\n```'))
  expect((await ui.find({ type: 'Text', text: /^ok - cc-keepwarm$/ }))?.props).toMatchObject({ color: t.codeText, dimColor: true })
  expect((await ui.find({ type: 'Text', text: /^\$ $/ }))?.props.color).toBe(t.codeComment)
  expect((await ui.find({ type: 'Text', text: /^git$/ }))?.props.color).toBe(t.codeCommand)
  await ui.press({ key: 'copy1' })
  expect(copies).toEqual(['git status --short\nmise run test'])
  await ui.unmount()
})

test('a list puts its copy button on its first row at the right, not on a line of its own', async $ => {
  const ui = await $.ui.mount(reply('Steps:\n\n- Pull upstream\n- Run the checks'))
  const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.flexDirection === 'row' && b.props.columnGap === 2 && /Pull upstream/.test(b.text ?? ''))
  const [list, button] = (row?.children ?? []) as Node[]
  expect(drawn(list)).toContain('Pull upstream')
  expect(button?.type).toBe('Button')
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end')).toBe(false)
  await ui.unmount()
})

test('a quote puts its copy button at its right', async ($, on) => {
  const copies = recordCopies(on)
  const ui = await $.ui.mount(reply('> keep this short'))
  const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.flexDirection === 'row' && b.props.columnGap === 2)
  const [quote, button] = (row?.children ?? []) as Node[]
  expect(drawn(quote)).toContain('keep this short')
  expect(button?.type).toBe('Button')
  await ui.press({ key: 'copy0' })
  expect(copies).toEqual(['keep this short'])
  await ui.unmount()
})

test('a mermaid flowchart draws in a rounded box, with its label and buttons above it, outside the box', async $ => {
  const ui = await $.ui.mount(reply('Flow:\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```'))
  const boxes = await roundBoxes(ui)
  const diagram = boxes.find(b => /Start/.test(b.text ?? ''))
  expect(diagram).toBeDefined()
  expect(within(diagram, isButton())).toBe(false)
  expect(drawn(diagram)).not.toContain('mermaid')
  const column = (await ui.findAll({ type: 'Box' })).find(b => b.props.alignSelf === 'flex-start')
  const [header, body] = (column?.children ?? []) as Node[]
  expect(within(header, n => n.type === 'Text' && drawn(n) === ' mermaid')).toBe(true)
  expect(within(header, isButton('⧉ source'))).toBe(true)
  expect(body?.props.borderStyle).toBe('round')
  expect(await labels(ui)).toEqual(['⧉ source', '⧉ art'])
  await ui.unmount()
})

test('a diagram too wide for the terminal falls back to its source with a note', async $ => {
  const workers = Array.from({ length: 16 }, (_, i) => `W${i + 1}[Worker ${i + 1}]`).join(' & ')
  const ui = await $.ui.mount(reply('```mermaid\nflowchart TD\n  Q[Queue] --> ' + workers + '\n```'))
  expect((await ui.find({ type: 'Text', text: /^diagram is \d+ cols, terminal is \d+$/ }))?.props.color).toBe(t.codeComment)
  expect(await ui.find({ type: 'Text', text: /^ mermaid$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^flowchart TD$/ })).toBeDefined()
  expect(await labels(ui)).toEqual(['⧉ copy'])
  await ui.unmount()
})

test('a code block still streaming draws without error', async ($, on) => {
  engine(on)
  for (const text of ['```ts\nconst x =', 'intro\n\n```mermaid\nflowchart LR\n  A --> B']) {
    const ui = await $.ui.mount(reply(text))
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    expect(await roundBoxes(ui)).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^diagram/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a half-streamed diagram shows no note until its fence closes', async $ => {
  const open = await $.ui.mount(reply('```mermaid\npie\n  "a" : 3'))
  expect(await open.find({ type: 'Text', text: /diagram|draw as source/ })).toBeUndefined()
  await open.unmount()
  const closed = await $.ui.mount(reply('```mermaid\npie\n  "a" : 3\n```'))
  expect(await closed.find({ type: 'Text', text: /^pie diagrams draw as source for now$/ })).toBeDefined()
  await closed.unmount()
})

test('slash-command output draws like a reply; colored or errored output goes to the engine', async ($, on) => {
  engine(on)
  const command = (text: string, isErrored = false) => ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'CommandOutput' as const, props: { command: 'wrap-up', args: '', text, isErrored } })
  const ok = await $.ui.mount(command(`# Report\n\n${TABLE}`))
  expect((await ok.find({ type: 'Text', text: /^Report$/ }))?.props.color).toBe(t.heading)
  expect((await ok.find({ type: 'Text', text: /^Name$/ }))?.props.color).toBe(t.tableHeader)
  expect(await ok.find({ type: 'Text', text: /^╞[═╪]+╡$/ })).toBeDefined()
  expect(await labels(ok)).toEqual(['⧉ md', '⧉ art'])
  expect(await ok.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ok.unmount()
  for (const target of [command('\u001b[1mContext Usage\u001b[22m'), command('boom', true)]) {
    const ui = await $.ui.mount(target)
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})
