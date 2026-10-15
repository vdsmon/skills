import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { inlineText, parse } from './markdown'
import { THEME as t } from './theme'
import { takesClickableMarks } from './version'

// Structured quotes (prismantis #155) and clickable footnote marks (#138, #145), with their upstream tests.

const hl = { numbers: true, paths: true }
const CLICKABLE = '2.1.295'

const reply = (text: string, surface: 'terminal' | 'desktop' = 'terminal', columns = 100, requestId = 'r1') => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  requestId,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

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

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

const barLines = async (ui: { findAll: (query: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(│ \n)*│ $/ })).map(bar => bar.text.split('\n').length)

const DRAFT = [
  '> Yeah agreed, definitely a POC. It does check the dispatcher which nothing else does right now.',
  '>',
  '> It also does a few things worth carrying into whatever replaces it:',
  "> - **RoutableServiceNames** reproduces 0.2.0's grammar from reading `dispatcher.py`.",
  "> - That routing check doesn't need a server.",
  '>',
  '> The rest is fine to drop.',
].join('\n')

for (const surface of ['terminal', 'desktop'] as const) test(`a quote keeps its paragraphs, list rows and styling on ${surface}`, async ($, on) => {
  const copied = recordCopies(on)
  const ui = await $.ui.mount(reply(DRAFT, surface))
  for (const text of ['Yeah agreed, definitely a POC. It does check the dispatcher which nothing else does right now.', 'It also does a few things worth carrying into whatever replaces it:', 'The rest is fine to drop.']) {
    expect((await ui.find({ type: 'Text', text: exact(text) }))?.props).toMatchObject({ italic: true, color: t.quote })
  }
  expect(await ui.findAll({ type: 'Text', text: /^• $/ })).toHaveLength(2)
  expect((await ui.find({ type: 'Text', text: /^RoutableServiceNames$/ }))?.props).toMatchObject({ bold: true, color: t.strong })
  expect(Math.max(...(await barLines(ui))) >= 7).toBe(true)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ copy'])
  await ui.press({ key: buttons[0]!.key! })
  expect(copied).toEqual([DRAFT.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n')])
  await ui.unmount()
})

test('a nested quote draws with its own bar inside the outer one', async $ => {
  const ui = await $.ui.mount(reply('> outer\n>\n> > inner one\n> > inner two\n>\n> after'))
  for (const text of [/^outer$/, /^inner one inner two$/, /^after$/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect(await ui.find({ type: 'Box', text: /^│ inner one inner two$/ })).toBeDefined()
  expect(Math.max(...(await barLines(ui))) >= 5).toBe(true)
  await ui.unmount()
})

test('an alert keeps a list in its body', async ($, on) => {
  const copied = recordCopies(on)
  const ui = await $.ui.mount(reply('> [!NOTE]\n> Before you merge:\n> - run the tests\n> - update the CHANGELOG'))
  expect(await ui.find({ type: 'Text', text: /^Note$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Before you merge:$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^• $/ })).toHaveLength(2)
  expect((await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.text).toContain('update the CHANGELOG')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ copy'])
  await ui.press({ key: buttons[0]!.key! })
  expect(copied).toEqual(['[!NOTE]\nBefore you merge:\n- run the tests\n- update the CHANGELOG'])
  await ui.unmount()
})

test('a code block and a table inside a quote keep their own copy buttons', async ($, on) => {
  const copied = recordCopies(on)
  const table = '| Check | Result |\n|---|---|\n| lint | passes |'
  const source = `> Run it:\n>\n> \`\`\`bash\n> npm test\n> \`\`\`\n>\n${table.split('\n').map(line => `> ${line}`).join('\n')}`
  const ui = await $.ui.mount(reply(source, 'terminal', 80))
  expect((await ui.find({ type: 'Text', text: /^npm$/ }))?.props.color).toBe(t.codeCommand)
  expect((await ui.find({ type: 'Text', text: /^Check$/ }))?.props.color).toBe(t.tableHeader)
  const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels.filter(l => l === '⧉ copy')).toHaveLength(2)
  expect(labels.filter(l => l === '⧉ md')).toHaveLength(1)
  await ui.press({ key: 'b0.copy1' })
  await ui.press({ key: 'b0.copy2' })
  expect(copied).toEqual(['npm test', table])
  await ui.unmount()
})

test('footnotes number and links stay readable inside a quote', async $ => {
  const source = '> Intro.\n>\n> - Latency fell[^lat], see [docs](https://example.com).\n>\n> [^q]: Quoted note.\n\nAlso[^q].\n\n[^lat]: Median of 50 runs.'
  const ui = await $.ui.mount(reply(source))
  expect((await ui.find({ type: 'Text', text: /^¹$/ }))?.props.color).toBe(t.accent)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com'])
  expect(await ui.find({ type: 'Text', text: /^Also²\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^¹ Median of 50 runs\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^² Quoted note\.$/ })).toBeDefined()
  await ui.unmount()
})

test('a quote bar stays in the flow, clipped to the quote rows', async $ => {
  const ui = await $.ui.mount(reply(DRAFT))
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.overflow === 'hidden' && b.props.height === 0 && b.props.flexGrow === 1 && /^(│ \n){6,}│ $/.test(b.text))).toBe(true)
  expect(boxes.some(b => b.props.position === 'absolute' && b.text.includes('│'))).toBe(false)
  await ui.unmount()
})

test('a quote that opens with code puts its copy button on its last row', async $ => {
  const ui = await $.ui.mount(reply('> ```bash\n> npm test\n> ```\n>\n> Run that first.\n\n> One line.'))
  const low = (await ui.findAll({ type: 'Box' })).filter(b => b.props.alignSelf === 'flex-end')
  expect(low.map(b => b.text)).toEqual(['⧉ copy'])
  await ui.unmount()
})

test('footnotes follow quotes and fences', async () => {
  const marks = (source: string) => parse(source, hl).flatMap(b => (b.kind === 'notes' ? b.notes.map(n => `${n.mark} ${inlineText(n.inline)}`) : []))
  expect(marks('```md\n> ```\n[^fake]: Not a real note\n```\n\nReal[^real].\n\n[^real]: Real note')).toEqual(['¹ Real note'])
  expect(marks('> ```\n> [^x]: in code\n\nTop[^top].\n\n[^top]: Top note')).toEqual(['¹ Top note'])
  expect(marks('> a[^q]\n>\n> > [^q]: Nested note\n> >   continued')).toEqual(['¹ Nested note continued'])
})

test('a quote with nothing to draw is left out', async () => {
  expect(parse('> [^q]: A note.\n\nSee[^q].', hl).map(b => b.kind)).toEqual(['paragraph', 'notes'])
  expect(parse('>\n> \n\ntext', hl).map(b => b.kind)).toEqual(['paragraph'])
  expect(parse('> [!NOTE]', hl).map(b => b.kind)).toEqual(['alert'])
})

test('quotes nested past eight levels keep their text and parse in linear time', async () => {
  const started = Date.now()
  const [block] = parse(`${'>'.repeat(20000)} deep`, hl)
  expect(Date.now() - started < 100).toBe(true)
  let depth = 0
  let at = block
  while (at?.kind === 'quote') {
    depth++
    at = at.blocks[0]
  }
  expect(depth).toBe(8)
  expect(at?.kind === 'paragraph' && inlineText(at.inline).endsWith('> deep')).toBe(true)
})

test('footnote clicks need Claude Code 2.1.295 or later', () => {
  const versions = ['2.1.287', '2.1.294', '2.1.295', '2.1.296-dev.20261013.t101500.sha1a2b3c4', '2.2.0', '3.0.0', '1.9.999', 'dev']
  expect(versions.map(takesClickableMarks)).toEqual([false, false, true, true, true, true, false, false])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a click on a footnote mark in a sentence, list, quote or table shows its note on ${surface}`, async ($, on) => {
    claudeAt(on, CLICKABLE)
    const toasts = recordToasts(on)
    const ui = await $.ui.mount(reply('Fast[^a] and steady.\n\n- Cold[^b] start\n\n> Quiet[^a] release.\n\n| M | V |\n|---|---|\n| p99 | 40ms[^b] |\n\n[^a]: Measured twice.\n[^b]: First request.', surface))
    const marks = await ui.findAll({ type: 'Button', text: /^[¹²]$/ })
    expect(marks.map(m => m.text)).toEqual(['¹', '²', '¹', '²'])
    for (const mark of marks) await ui.press({ key: mark.key! })
    expect(toasts).toEqual(['¹ Measured twice.', '² First request.', '¹ Measured twice.', '² First request.'])
    expect((await ui.find({ type: 'Text', text: /^Quiet$/ }))?.props).toMatchObject({ italic: true, color: t.quote })
    await ui.unmount()
  })

  test(`footnote marks stay plain text before Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    claudeAt(on, '2.1.294')
    const ui = await $.ui.mount(reply('Fast[^a].\n\n| M[^a] | V |\n|---|---|\n| x | 1 |\n\n[^a]: Measured twice.', surface))
    expect(await ui.findAll({ type: 'Button', text: /^¹$/ })).toEqual([])
    expect((await ui.findAll({ type: 'Text', text: /^¹$/ })).map(m => m.props.color)).toEqual([t.accent, t.accent])
    await ui.unmount()
  })
}

test('footnote marks in table header and body cells draw in the mark color', async ($, on) => {
  claudeAt(on, CLICKABLE)
  const ui = await $.ui.mount(reply('Fast[^a].\n\n| Metric[^b] | **Value**[^c] | A long header that has to wrap[^a] |\n|---|---|---|\n| p99[^a] | 40ms[^b] | x |\n\n[^a]: A.\n[^b]: B.\n[^c]: C.', 'terminal', 40))
  const marks = await ui.findAll({ type: 'Text', text: /^[¹²³]$/ })
  expect(new Set(marks.map(m => m.text))).toEqual(new Set(['¹', '²', '³']))
  expect(marks.filter(m => m.props.color !== t.accent).map(m => m.text)).toEqual([])
  expect(marks.length).toBe(6)
  await ui.unmount()
})

test('two identical replies light only their own footnote marks', async $ => {
  type DrawnNode = { hover?: { scope?: string }; children?: unknown[] }
  const hoverScopes = (node: DrawnNode): string[] => [
    ...(node.hover?.scope ? [node.hover.scope] : []),
    ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? hoverScopes(child as DrawnNode) : [])),
  ]
  const scopes: string[][] = []
  for (const requestId of ['m1', 'm2']) {
    const ui = await $.ui.mount(reply('Fast[^a].\n\n[^a]: Measured twice.', 'terminal', 100, requestId))
    scopes.push(hoverScopes((await ui.drawn()) as DrawnNode))
    await ui.unmount()
  }
  expect(scopes.map(s => s.length)).toEqual([2, 2])
  expect(scopes[1]!.some(s => scopes[0]!.includes(s))).toBe(false)
})
