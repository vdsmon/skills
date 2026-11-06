import { expect, test } from 'claude-code/testing'

import { tableArt } from './blocks'
import { tableHtml, tableText } from './html'
import type { Block } from './markdown'
import { displayText, inlineText, parse } from './markdown'

// Fixes ported from upstream prismantis 0.32.1 to 0.44.0, each with its upstream test.

const hl = { numbers: true, paths: true }
const plain = { numbers: false, paths: false }
const tableOf = (text: string) => {
  const [table] = parse(text, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  return table as Extract<Block, { kind: 'table' }>
}
const reply = (text: string, columns = 100, surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})
const texts = (b: Block | undefined) => (b && 'inline' in b ? b.inline.map(n => ('text' in n ? n.text : '')).join('') : '')
const best = (run: () => unknown) => {
  let fastest = Infinity
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    run()
    fastest = Math.min(fastest, performance.now() - start)
  }
  return fastest
}

test('a <br> in a table cell parses as a line break, but not inside a code span', async () => {
  const table = tableOf('| a |\n|---|\n| Then:<br/>• one<BR>• two `x<br>y` |')
  expect(inlineText(table.rows[0]![0]!)).toBe('Then:\n• one\n• two x<br>y')
})

for (const surface of ['terminal', 'desktop'] as const) test(`a <br> in a table cell starts a new row of the cell on ${surface}`, async $ => {
  const ui = await $.ui.mount(reply('| Step | Detail |\n|---|---|\n| Prevent | Then:<br/>• Run `brew install gnu-sed` |', 100, surface))
  expect(await ui.find({ type: 'Text', text: /<br/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Then:$/ })).toBeDefined()
  await ui.unmount()
})

test('table art breaks a cell at <br> and sizes the column by its widest line', async () => {
  const lines = tableArt(tableOf('| a |\n|---|\n| short<br>a longer line |')).split('\n')
  expect(lines.filter(l => l.startsWith('│ ')).map(l => l.slice(2, -2).trim())).toEqual(['a', 'short', 'a longer line'])
  expect(lines[1]).toBe('┌───────────────┐')
})

test('a long unbroken word after a <br> wraps on its own line', async () => {
  const lines = tableArt(tableOf(`| h |\n|-|\n| short<br>${'x'.repeat(250)} |`)).split('\n').filter(l => l.startsWith('│ ')).map(l => l.slice(2, -2).trim())
  expect(lines[1]).toBe('short')
  expect(lines.slice(2).join('')).toBe('x'.repeat(250))
})

test('control characters inside a <br> cell are dropped and the break still applies', async () => {
  expect(inlineText(tableOf('| a |\n|-|\n| one\x1b[31m<br>two\x07 |').rows[0]![0]!)).toBe('one\ntwo')
})

test('copying a table keeps a <br> cell as one cell: a <br> in HTML, a quoted multi-line cell in TSV', async () => {
  const table = tableOf('| a | b |\n|-|-|\n| one<br>**two** | x |')
  expect(tableHtml(table)).toContain('<td style="text-align: left">one<br><strong>two</strong></td>')
  expect(tableText(table)).toBe('a\tb\n"one\ntwo"\tx')
})

test('a line break stays only before a tinted translation line', async () => {
  const gray = (s: string) => `\u001b[90m${s}\u001b[39m`
  const [one, para, list] = parse(`one\ntwo\n\nHello world.\n${gray('你好世界。')}\n\n- item\n  ${gray('项目')}\n  more`, plain)
  if (one?.kind !== 'paragraph' || para?.kind !== 'paragraph' || list?.kind !== 'list') throw new Error('unexpected blocks')
  expect(one.inline).toEqual([{ kind: 'text', text: 'one two' }])
  expect(para.inline.map(n => ('text' in n ? n.text : ''))).toEqual(['Hello world.\n', '你好世界。'])
  expect(list.items[0]?.inline.map(n => ('text' in n ? n.text : ''))).toEqual(['item\n', '项目', ' more'])
})

test('translation colors from BBilingual survive, other escape codes do not', async () => {
  const gray = (s: string) => `\u001b[90m${s}\u001b[39m`
  const [para, heading, other] = parse(`Hi **all**.\n${gray('你好')}**${gray('大家')}**\n\n## Results / ${gray('结果')}\n\nkeep \u001b[31mred\u001b[0m \u001b[36mcyan\u001b[39m`, plain)
  if (para?.kind !== 'paragraph' || heading?.kind !== 'heading' || other?.kind !== 'paragraph') throw new Error('unexpected blocks')
  expect(para.inline.at(-2)).toEqual({ kind: 'dim', text: '你好', tint: 'gray' })
  expect(para.inline.at(-1)).toEqual({ kind: 'strong', children: [{ kind: 'dim', text: '大家', tint: 'gray' }] })
  expect(heading.inline.at(-1)).toEqual({ kind: 'dim', text: '结果', tint: 'gray' })
  expect(other.inline).toEqual([{ kind: 'text', text: 'keep red ' }, { kind: 'dim', text: 'cyan', tint: 'cyan' }])
  expect(JSON.stringify([para, heading, other])).not.toMatch(/[\u001b-]/)
  expect(para.raw).toBe('Hi **all**.\n你好**大家**')
})

test('a tinted translation is drawn in its color', async $ => {
  for (const [code, look] of [['90', { color: 'gray' }], ['36', { color: 'cyan' }], ['3', { italic: true }], ['2', { dimColor: true }]] as const) {
    const ui = await $.ui.mount(reply(`Hello.\n\u001b[${code}m你好\u001b[${code === '2' ? '22' : code === '3' ? '23' : '39'}m`))
    expect((await ui.find({ type: 'Text', text: /^你好$/ }))?.props).toMatchObject(look)
    await ui.unmount()
  }
})

test('two trailing spaces or a backslash end a paragraph line', async $ => {
  const [spaces, slash, soft] = parse('🟩🟩  \n ✅ DELIVERED  \n🟩🟩\n\none\\\ntwo\n\nthree  \nfour\\', plain)
  expect([texts(spaces), texts(slash), texts(soft)]).toEqual(['🟩🟩\n✅ DELIVERED\n🟩🟩', 'one\ntwo', 'three\nfour\\'])
  expect(spaces?.raw).toBe('🟩🟩  \n ✅ DELIVERED  \n🟩🟩')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply('🟩🟩  \n✅ DELIVERED  \n🟩🟩', 100, surface))
    expect(await ui.find({ type: 'Text', text: /^🟩🟩\n✅ DELIVERED\n🟩🟩$/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('two trailing spaces or a backslash end a list item line', async $ => {
  const [list] = parse('- one  \n  two\\\n  three\n  four\n- five\n  ```\n  c\n  ```\n  para  \n  next', plain)
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items.map(it => displayText(it.inline))).toEqual(['one\ntwo\nthree four', 'five'])
  const para = list.items[1]?.blocks?.[1]
  expect(para?.kind === 'paragraph' && displayText(para.inline)).toBe('para\nnext')
  const ui = await $.ui.mount(reply('- one  \n  two\n- three'))
  expect(await ui.find({ type: 'Text', text: /^one\ntwo$/ })).toBeTruthy()
  await ui.unmount()
})

test('HTML entities decode in text but not in code, and never make a control character', async () => {
  const [para] = parse('a &amp; b &lt;x&gt; &quot;&apos;&nbsp;&#65;&#x42; &bogus; `&amp;` x&#27;[31my&#0;', plain)
  if (para?.kind !== 'paragraph') throw new Error('not a paragraph')
  expect(para.inline).toEqual([{ kind: 'text', text: 'a & b <x> "\' AB &bogus; ' }, { kind: 'code', text: '&amp;' }, { kind: 'text', text: ' xy�' }])
  expect(para.raw).toBe('a &amp; b &lt;x&gt; &quot;&apos;&nbsp;&#65;&#x42; &bogus; `&amp;` x&#27;[31my&#0;')
  const [link] = parse('[a &amp; b](https://x.io) [`&amp;`](https://x.io)', hl)
  expect(link?.kind === 'paragraph' && link.inline.map(n => ('text' in n ? n.text : ''))).toEqual(['a & b', ' ', '&amp;'])
  const table = tableOf('| a |\n|--|\n| &amp; &lt;b&gt; |')
  expect(tableHtml(table)).toContain('<td style="text-align: left">&amp; &lt;b&gt;</td>')
  expect(tableText(table)).toBe('a\n& <b>')
})

test('an unterminated OSC escape strips only itself, not the rest of the reply', () => {
  const blocks = parse('before \u001b]8;;x rest\n\nsecond\n\n| a |\n|---|\n| 1 |', plain)
  expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'paragraph', 'table'])
  expect(blocks.map(b => b.raw).join('\n')).not.toMatch(/[\u001b\u0007]/)
})

test('parse cost grows linearly on long backtick cells and unclosed $$ lines', async () => {
  const cell = (n: number) => `| a |\n|---|\n| ${'`'.repeat(n * 6)} |`
  const unclosed = (n: number) => Array.from({ length: n }, () => '$$x').join('\n')
  for (const make of [cell, unclosed]) {
    parse(make(500), hl)
    const small = Math.max(best(() => parse(make(500), hl)), 0.05)
    const large = best(() => parse(make(5000), hl))
    expect(large < small * 40).toBe(true)
  }
})
