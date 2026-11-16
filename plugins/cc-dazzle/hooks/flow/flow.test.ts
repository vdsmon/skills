import { expect, test } from 'claude-code/testing'

import type { Checked } from './checks'
import { checkFlow, joinsInto } from './checks'
import { CORPUS } from './corpus'
import { FITS, drawFlow } from './index'
import { layout } from './layout'
import { wrapLabel } from './labels'
import { parseFlow } from './parse'
import { DIAGRAMS, FRAMES, STATES, WIDTHS } from './sets'

// Checked in batches, each its own test, so no test runs long; later tests read the same results.
const BATCH = 50
type Run = { name: string; columns: number; checked: Checked }
const runs = new Map<string, Run[]>()
const checkedBatch = (columns: number, from: number) =>
  runs.get(`${columns}:${from}`) ?? runs.set(`${columns}:${from}`, DIAGRAMS.slice(from, from + BATCH).map(([name, source]) => ({ name, columns, checked: checkFlow(source, columns) }))).get(`${columns}:${from}`)!
const BATCHES = Array.from({ length: Math.ceil(DIAGRAMS.length / BATCH) }, (_, i) => i * BATCH)
const checkedAll = () => WIDTHS.flatMap(columns => BATCHES.flatMap(from => checkedBatch(columns, from)))

for (const columns of WIDTHS) for (const from of BATCHES) test(`diagrams ${from + 1} to ${Math.min(from + BATCH, DIAGRAMS.length)} draw whole at ${columns} columns, every edge between boxes and every label on cells of its own`, () => {
  const batch = checkedBatch(columns, from)
  expect(batch.flatMap(({ name, checked }) => checked.failures.map(f => `${name}: ${f.check} ${f.what}`))).toEqual([])
  expect(batch.every(({ checked }) => checked.flow?.kind === 'drawn')).toBe(true)
})

test('every scrambled real diagram fits from 80 columns up', () => {
  const wide = checkedAll().flatMap(({ name, columns, checked }) =>
    name.startsWith('corpus ') && columns >= 80 && !(checked.flow?.kind === 'drawn' && checked.flow.fits && checked.flow.drawing.width <= columns) ? [`${name} at ${columns}`] : [])
  expect(wide).toEqual([])
})

test('a diagram that does not fit comes back as the narrowest of its drawings, with its width', () => {
  const unfit = checkedAll().filter(({ checked }) => checked.flow?.kind === 'drawn' && !checked.flow.fits)
  expect(unfit.length > 0).toBe(true)
  for (const { name, columns, checked } of unfit) {
    if (checked.flow?.kind !== 'drawn') continue
    const graph = parseFlow(DIAGRAMS.find(([n]) => n === name)![1])!
    const widths = FITS.map(fit => layout(graph, fit)!.width)
    expect(checked.flow.drawing.width).toBe(Math.min(...widths))
    expect(checked.flow.drawing.width > columns).toBe(true)
  }
})

test('boxes of one row share their top line, and a frame keeps an empty column inside each side', () => {
  const flow = drawFlow('flowchart TD\n  A --> B["two<br>lines"] & C[one]', 80)
  if (flow?.kind !== 'drawn') throw new Error('not drawn')
  const [b, c] = ['n:1', 'n:2'].map(key => flow.drawing.boxes.find(box => box.key === key)!)
  expect(b!.y).toBe(c!.y)
  const cramped = checkedAll().flatMap(({ name, checked }) => {
    if (checked.flow?.kind !== 'drawn') return []
    const { boxes, frames } = checked.flow.drawing
    return frames.flatMap(f => [...boxes, ...frames].filter(r => r !== f && r.x > f.x && r.x < f.x + f.w && r.y > f.y && r.y < f.y + f.h && (r.x < f.x + 2 || r.x + r.w > f.x + f.w - 2)).map(() => name))
  })
  expect(cramped).toEqual([])
})

test('each concurrent region of a composite state has its own start and end', () => {
  const graph = parseFlow(STATES.concurrent!)!
  expect(graph.ids.filter(id => id.startsWith('[*]start')).length).toBe(3)
  const flow = drawFlow('stateDiagram-v2\n  state Both {\n    [*] --> A\n    A --> [*]\n    --\n    [*] --> B\n    B --> [*]\n  }', 80)
  if (flow?.kind !== 'drawn') throw new Error('not drawn')
  expect(flow.drawing.boxes.filter(b => b.lines.some(l => l.text === '●')).length).toBe(4)
})

test('the parser reads every statement of every diagram the checks run over', () => {
  expect(DIAGRAMS.flatMap(([name, source]) => parseFlow(source)!.warnings.map(w => `${name}: ${w}`))).toEqual([])
})

// A reply draws its diagram on every streamed prefix of the source.
const SOURCES = [...CORPUS, ...Object.values(STATES), ...Object.values(FRAMES)]
for (let from = 0; from < SOURCES.length; from += 4) test(`every prefix of sources ${from + 1} to ${Math.min(from + 4, SOURCES.length)} of the corpus and the state diagrams draws without throwing`, () => {
  for (const source of SOURCES.slice(from, from + 4)) for (let end = 1; end <= source.length; end++) drawFlow(source.slice(0, end), 80)
})

test('the checks refuse a label that was cut, or that gained an ellipsis', () => {
  expect(joinsInto('make the task', ['make the', 'task'])).toBe(true)
  expect(joinsInto('cc-wrap-up', ['cc-', 'wrap-up'])).toBe(true)
  expect(joinsInto('make the task', ['make the t…'])).toBe(false)
  expect(joinsInto('make the task', ['make the'])).toBe(false)
  expect(joinsInto('wait…', ['wait…'])).toBe(true)
})

test('an id with hyphens is one id, as in Mermaid', () => {
  const graph = parseFlow('flowchart LR\n  cc-wrap-up --- better-compact\n  a-b-->c-d')!
  expect(graph.ids).toEqual(['cc-wrap-up', 'better-compact', 'a-b', 'c-d'])
  expect(graph.edges.map(e => [e.from, e.to, e.label])).toEqual([[0, 1, null], [2, 3, null]])
})

test('an edge label after a space, as in --> |yes|, belongs to the edge', () => {
  const graph = parseFlow('flowchart TD\n  A --> |yes| B\n  B -.-> |no| C')!
  expect(graph.edges.map(e => [graph.ids[e.from], graph.ids[e.to], e.label])).toEqual([['A', 'B', 'yes'], ['B', 'C', 'no']])
  expect(graph.warnings).toEqual([])
})

test('a node named again inside a subgraph moves into it, as in Mermaid', () => {
  const graph = parseFlow('flowchart TD\n  A --> B\n  C\n  subgraph S\n    A\n    subgraph T\n      B\n    end\n  end')!
  expect(graph.nodeGroup).toEqual([0, 1, null])
})

test('<br> breaks state descriptions, transition labels, state names and subgraph titles too', () => {
  const state = parseFlow('stateDiagram-v2\n  X : a<br>b\n  state "c<br/>d" as Y\n  X --> Y : e<br>f')!
  expect(state.nodes.map(n => n.label)).toEqual(['a\nb', 'c\nd'])
  expect(state.edges[0]!.label).toBe('e\nf')
  const flow = parseFlow('flowchart TD\n  subgraph "g<br>h"\n    A\n  end\n  subgraph two words\n    B\n  end')!
  expect(flow.groups.map(g => g.label)).toEqual(['g\nh', 'two words'])
})

test('inline edge text keeps its hyphens and ends at a whole operator', () => {
  const graph = parseFlow('flowchart TD\n  A -- re-run it --> B\n  B -. half-way .-> C\n  C --- D-E')!
  expect(graph.edges.map(e => e.label)).toEqual(['re-run it', 'half-way', null])
  expect(graph.ids).toEqual(['A', 'B', 'C', 'D-E'])
})

test('<br> breaks a label, and a long word breaks at _ - . / before breaking anywhere', () => {
  expect(parseFlow('flowchart TD\n  A["one<br/>two"]')!.nodes[0]!.label).toBe('one\ntwo')
  expect(wrapLabel('one\ntwo', 24)).toEqual(['one', 'two'])
  expect(wrapLabel('alpha-beta-gamma', 12)).toEqual(['alpha-beta-', 'gamma'])
  expect(wrapLabel('path/to/file.ts', 9)).toEqual(['path/to/', 'file.ts'])
  expect(wrapLabel('abcdefghijklmn', 5)).toEqual(['abcde', 'fghij', 'klmn'])
})

test('a long box label draws whole on as many lines as it takes', () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
  const flow = drawFlow(`flowchart TD\n  A["${words}"] --> B`, 80)
  expect(flow?.kind).toBe('drawn')
  if (flow?.kind !== 'drawn') return
  const box = flow.drawing.boxes.find(b => b.key === 'n:0')!
  expect(box.lines.length > 4).toBe(true)
  expect(joinsInto(words, box.lines.map(l => l.text))).toBe(true)
  expect(flow.drawing.lines.join('\n')).not.toContain('…')
})

test('every direction draws top-down', () => {
  for (const direction of ['LR', 'RL', 'BT', 'TD']) {
    const flow = drawFlow(`flowchart ${direction}\n  A[First] --> B[Second]`, 80)
    if (flow?.kind !== 'drawn') throw new Error('not drawn')
    const [first, second] = ['n:0', 'n:1'].map(key => flow.drawing.boxes.find(b => b.key === key)!)
    expect(second!.y > first!.y + first!.h).toBe(true)
  }
})

test('a composite state draws as a frame holding its states, nested ones too', () => {
  const flow = drawFlow('stateDiagram-v2\n  [*] --> Outer\n  state Outer {\n    [*] --> A\n    state Inner {\n      B --> C\n    }\n    A --> Inner\n  }', 80)
  if (flow?.kind !== 'drawn') throw new Error('not drawn')
  const [outer, inner] = ['g:0', 'g:1'].map(key => flow.drawing.frames.find(f => f.key === key)!)
  expect(outer!.title.map(t => t.text)).toEqual(['Outer'])
  const within = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h
  expect(within(inner!, outer!)).toBe(true)
  const c = flow.drawing.boxes.find(b => b.lines.some(l => l.text === 'C'))!
  expect(within(c, inner!)).toBe(true)
})

test('two diagrams drawn one after the other keep their own wrap widths', () => {
  const wide = 'flowchart TD\n  A["a label long enough that it wraps at a narrow width"] --> B'
  const before = drawFlow(wide, 160)
  drawFlow(wide, 30)
  drawFlow(CORPUS[0]!, 40)
  expect(drawFlow(wide, 160)).toEqual(before)
})

test('a source over a cap is too large to draw; one with no boxes has nothing to draw', () => {
  const many = `flowchart TD\n  Q --> ${Array.from({ length: 130 }, (_, i) => `N${i}`).join(' & ')}`
  expect(drawFlow(many, 80)).toEqual({ kind: 'too-large' })
  expect(drawFlow('flowchart TD', 80)).toEqual({ kind: 'empty' })
  expect(drawFlow('stateDiagram-v2\n  note left of X\n  x\n  end note', 80)).toEqual({ kind: 'empty' })
  expect(drawFlow('pie\n  "a" : 1', 80)).toBeNull()
})
