import { expect, test } from 'claude-code/testing'

import { tableArt } from './blocks'
import type { Block } from './markdown'
import { parse } from './markdown'
import { inlineMarks, mermaidText } from './mermaid'
import { width } from './text'

// Fixes ported from upstream prismantis 0.15.1 to 0.19.0, each with its upstream test.

const hl = { numbers: true, paths: true }
const tableOf = (text: string) => {
  const [table] = parse(text, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  return table as Extract<Block, { kind: 'table' }>
}
const reply = (text: string, columns = 100) => ({
  plugin: 'cc-dazzle',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

for (const [input, expected] of [
  ['## Using C#', [{ kind: 'text', text: 'Using C#' }]],
  ['## Title ##', [{ kind: 'text', text: 'Title' }]],
  ['[Foo](https://e.org/wiki/Foo_(bar)) ok', [{ kind: 'link', text: 'Foo', href: 'https://e.org/wiki/Foo_(bar)' }, { kind: 'text', text: ' ok' }]],
  ['see https://e.org/wiki/Foo_(bar) ok', [{ kind: 'text', text: 'see ' }, { kind: 'link', text: 'https://e.org/wiki/Foo_(bar)', href: 'https://e.org/wiki/Foo_(bar)' }, { kind: 'text', text: ' ok' }]],
  ['see (https://e.org/x) ok', [{ kind: 'text', text: 'see (' }, { kind: 'link', text: 'https://e.org/x', href: 'https://e.org/x' }, { kind: 'text', text: ') ok' }]],
  ['[`render.tsx`](hooks/render.tsx)', [{ kind: 'link', text: 'render.tsx', href: 'hooks/render.tsx' }]],
  ['call f(*args, **kwargs) now', [{ kind: 'text', text: 'call f(*args, **kwargs) now' }]],
  ['**a *b* c**', [{ kind: 'strong', children: [{ kind: 'text', text: 'a ' }, { kind: 'emphasis', children: [{ kind: 'text', text: 'b' }] }, { kind: 'text', text: ' c' }] }]],
  ['f(_a, _)', [{ kind: 'text', text: 'f(_a, _)' }]],
  ['f(*args, **kwargs) and **b**', [{ kind: 'text', text: 'f(*args, **kwargs) and ' }, { kind: 'strong', children: [{ kind: 'text', text: 'b' }] }]],
] as const) test(`inline markdown: ${input}`, async () => {
  const [block] = parse(input, hl)
  expect(block && 'inline' in block ? block.inline : block).toEqual(expected)
})

test('a one-dash delimiter row makes a table', async () => {
  const table = tableOf('| a | b |\n|-|-|\n| x | y |')
  expect(table.header.length).toBe(2)
  expect(table.rows.length).toBe(1)
})

test('table art fits wide characters into columns too narrow for them', async () => {
  const cols = 26
  const art = tableArt(tableOf(`|${' h |'.repeat(cols)}\n|${'---|'.repeat(cols)}\n|${' 中文中文 |'.repeat(cols)}`))
  expect(art.split('\n').length > 3).toBe(true)
})

for (const [text, cols] of [['©', 1], ['™', 1], ['↔', 1], ['▶', 1], ['⚠', 1], ['⚠️', 2], ['✅', 2], ['🙂', 2], ['🇮🇱', 2], ['1️⃣', 2], ['𠀀', 2], ['中', 2], ['é', 1]] as const) test(`${text} takes ${cols} terminal column${cols > 1 ? 's' : ''}`, async () => {
  expect(width(text)).toBe(cols)
})

test('a footnote definition inside a four-backtick fence stays code', async () => {
  const blocks = parse('````text\n```\n[^x]: inside code\n````\n\nSee[^x]', hl)
  expect(blocks.some(b => b.kind === 'notes')).toBe(false)
})

test('a localhost lookalike host stays link text', async $ => {
  const ui = await $.ui.mount(reply('[a](http://localhost@evil.example/) [b](http://localhost.evil.example/) [c](http://localhost:3000/x) [d](http://localhost)'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:3000/x', 'http://localhost'])
  await ui.unmount()
})

test('two code blocks that differ only in where lines break fold on their own', async $ => {
  const body = Array.from({ length: 29 }, () => 'x').join('\n')
  const ui = await $.ui.mount(reply(`\`\`\`text\nab\nc\n${body}\n\`\`\`\n\nand\n\n\`\`\`text\na\nbc\n${body}\n\`\`\``))
  await ui.press({ key: 'fold0' })
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
  expect((await ui.find({ key: 'fold2' }))?.props.label).toBe('+11 more lines')
  await ui.unmount()
})

test('flowchart edges written without spaces draw the same as with spaces', async () => {
  for (const [compact, spaced] of [
    ['flowchart LR\n  A-->B-->C', 'flowchart LR\n  A --> B --> C'],
    ['flowchart LR\n  my-node-->other-node', 'flowchart LR\n  my-node --> other-node'],
    ['graph TD\n  A-.->B==>C---D', 'graph TD\n  A -.-> B ==> C --- D'],
    ['flowchart LR\n  A-->|yes|B', 'flowchart LR\n  A -->|yes| B'],
    ['flowchart LR\n  A[Start]-->B{ok?}', 'flowchart LR\n  A[Start] --> B{ok?}'],
  ]) {
    const art = mermaidText(spaced!, 100)
    expect(art).not.toBeNull()
    expect(mermaidText(compact!, 100)).toBe(art)
  }
})

test('inline HTML tags in mermaid labels draw as italic and bold, not as tags', async $ => {
  const art = mermaidText('flowchart TD\n  A["metrics-server<br/><i>one slow scrape</i>"] --> B["<b>kubelet</b>"]', 80)!
  expect(art).toContain('one slow scrape')
  expect(art).toContain('kubelet')
  expect(art).not.toMatch(/<\/?[ib]>/)
  expect(inlineMarks('A["x<br/><i>one slow</i>"] --> B["<b>kubelet</b>"]')).toEqual([[[...'one slow'], { italic: true }], [[...'kubelet'], { bold: true }]])
  const ui = await $.ui.mount(reply('```mermaid\nflowchart TD\n  A["metrics-server<br/><i>one slow scrape</i>"] --> B["<b>kubelet</b>"]\n```', 80))
  expect((await ui.find({ type: 'Text', text: /^scrape$/ }))?.props.italic).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^kubelet$/ }))?.props.bold).toBe(true)
  await ui.unmount()
})

test('a mermaid box around a text-style symbol closes', async () => {
  const art = mermaidText('flowchart TD\n  A[sync ↔ async] --> B[done]', 80)!
  const box = art.split('\n').slice(0, 3).map(l => [...l.trimEnd()].length)
  expect(new Set(box).size).toBe(1)
})

const barColumns = (axis: string) => [...axis.matchAll(/┬|▀+/g)].map(m => m.index + Math.floor(m[0].length / 2))
const isBlock = (ch = '') => /[█▀▄]/.test(ch)
for (const [values, axisRange] of [[[400, 1200, 1900, 2500, 800], '0 --> 2500'], [[12, 10, 8], '0 --> 14']] as const) {
  test(`a bar stands on the axis line, reaches the gridlines at or below its value and stops on its own, with its value centered on top: ${values.join(', ')}`, () => {
    for (const title of ['\n  title "Sizes"', ''])
    for (const columns of [60, 120, 200]) {
      const chart = `xychart-beta${title}\n  x-axis [${values.map((_, i) => `b${i + 1}`).join(', ')}]\n  y-axis ${axisRange}\n  bar [${values.join(', ')}]`
      const lines = mermaidText(chart, columns)!.split('\n')
      const axis = lines.find(l => /^\s*0┼─/.test(l)) ?? ''
      const bars = barColumns(axis)
      expect(bars.length).toBe(values.length)
      bars.forEach(c => expect(axis[c]).toBe('▀'))
      for (const line of lines) {
        const tick = line.match(/^\s*(\d+)┤/)?.[1]
        if (tick === undefined) continue
        bars.forEach((c, i) => {
          expect(isBlock(line[c])).toBe(Number(tick) <= values[i]!)
          if (Number(tick) === values[i]) expect(line[c]).toBe('▄')
        })
      }
      bars.forEach((c, i) => {
        const label = String(values[i])
        const top = lines.findIndex(l => isBlock(l[c]))
        const bar = lines[top]!
        let [left, right] = [c, c]
        while (isBlock(bar[left - 1])) left--
        while (isBlock(bar[right + 1])) right++
        const from = lines[top - 1]!.indexOf(label, left - label.length)
        expect(from).toBeGreaterThan(-1)
        expect([0, 1]).toContain(from - left - (right - (from + label.length - 1)))
      })
    }
  })
}

for (const values of [[-5, 3, 8, -2, 0], [-6, 6, -2, 2], [-5, -3, -8]]) {
  test(`bars with negatives grow both ways from a solid 0 line, stop on their own gridline and keep their value at their end: ${values.join(', ')}`, () => {
    const chart = `xychart-beta\n  x-axis [${values.map((_, i) => `b${i + 1}`).join(', ')}]\n  bar [${values.join(', ')}]`
    for (const columns of [60, 120, 200]) {
      const lines = mermaidText(chart, columns)!.split('\n')
      const ticks = lines.flatMap((l, r) => {
        const tick = l.match(/^\s*(-?[\d.]+)[┤┼]/)?.[1]
        return tick === undefined ? [] : [{ r, tick: Number(tick) }]
      })
      const axis = ticks.at(-1)!.r
      const bars = barColumns(lines[axis]!)
      expect(bars.length).toBe(values.length)
      const [hi, lo] = [ticks[0]!.tick, ticks.at(-1)!.tick]
      const base = Math.min(Math.max(0, lo), hi)
      const baseRow = ticks.find(t => t.tick === base)!.r
      expect(lines[baseRow]).toMatch(/^\s*-?[\d.]+┼[─▀▄]+$/)
      bars.forEach((c, i) => expect(lines[baseRow]![c]).toBe(values[i] === base ? '─' : values[i]! > base ? '▀' : '▄'))
      for (const { r, tick } of ticks.filter(t => t.r !== axis && t.r !== baseRow)) {
        bars.forEach((c, i) => {
          expect(isBlock(lines[r]![c])).toBe((base < tick && tick <= values[i]!) || (values[i]! <= tick && tick < base))
          if (tick === values[i]) expect(lines[r]![c]).toBe(tick > base ? '▄' : '▀')
        })
      }
      bars.forEach((c, i) => {
        const label = String(values[i])
        const filled = lines.flatMap((l, r) => (isBlock(l[c]) ? [r] : []))
        const row = values[i]! < 0 ? (filled.at(-1) ?? baseRow) + 1 : (filled[0] ?? baseRow) - 1
        if (row < axis) expect(lines[row]!.slice(c - label.length, c + label.length)).toContain(label)
      })
    }
  })
}

test('a line at 0 runs along the axis line', () => {
  for (const columns of [60, 120, 200]) {
    const lines = mermaidText('xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  line [0, 60, 100]', columns)!.split('\n')
    const axis = lines.findIndex(l => /^\s*0┼/.test(l))
    expect(lines[axis]).toMatch(/^\s*0┼─+╯/)
    expect(lines[axis - 1]).not.toMatch(/─/)
  }
})
