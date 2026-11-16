import { expect, test } from 'claude-code/testing'

import { mermaidDiagram } from '../mermaid'
import { DIAGRAM_HUES, THEME } from '../theme'
import { CORPUS } from './corpus'

// What the mod shows for a flowchart or a state diagram: its drawing when it fits, else its source
// under a note that says why. "diagram failed to render" is never that note.

const reply = (text: string, columns = 100) => ({
  plugin: 'cc-dazzle',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

const fenced = (source: string) => '```mermaid\n' + source + '\n```'

test('a diagram too wide for the terminal shows its source, with the columns it needs and the columns that fit', async $ => {
  const workers = Array.from({ length: 16 }, (_, i) => `W${i + 1}[Worker ${i + 1}]`).join(' & ')
  const ui = await $.ui.mount(reply(fenced('flowchart TD\n  Q[Queue] --> ' + workers)))
  const note = await ui.find({ type: 'Text', text: /^diagram needs \d+ cols, \d+ fit$/ })
  expect(note).toBeDefined()
  const [needs, fit] = (note!.text.match(/\d+/g) ?? []).map(Number)
  expect(needs! > fit!).toBe(true)
  expect(fit).toBe(100 - 4 - 6)
  expect(await ui.find({ type: 'Text', text: /^flowchart TD$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /┌/ })).toBeUndefined()
  await ui.unmount()
})

test('a diagram over the size cap shows its source with a note that it is too large to draw', async $ => {
  const many = `flowchart TD\n  Q --> ${Array.from({ length: 130 }, (_, i) => `N${i}`).join(' & ')}`
  const long = `flowchart TD\n${Array.from({ length: 90 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`
  for (const source of [many, long, `stateDiagram-v2\n${Array.from({ length: 90 }, (_, i) => `  S${i} --> S${i + 1}`).join('\n')}`]) {
    const ui = await $.ui.mount(reply(fenced(source)))
    expect(await ui.find({ type: 'Text', text: /^diagram is too large to draw$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ {2}N0 --> |^ {2}Q --> N0|^ {2}S0 --> / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /┌|╭/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a flowchart or state diagram never shows "diagram failed to render"', async $ => {
  for (const source of ['flowchart TD', 'flowchart TD\n  A[never closed', 'stateDiagram-v2\n  this is not a statement', 'graph LR\n  A -->', 'stateDiagram-v2\n  [*] --> A\n  A --> ']) {
    const ui = await $.ui.mount(reply(fenced(source)))
    expect(await ui.find({ type: 'Text', text: /failed to render/ })).toBeUndefined()
    await ui.unmount()
  }
})

// An 80-column terminal leaves the reply 76 of them.
test('every scrambled real diagram draws in an 80-column terminal', () => {
  for (const source of CORPUS) expect('art' in mermaidDiagram(source, 76)).toBe(true)
})

test('each box takes its own hue, lines of every style the diagram color, and heads the accent', async $ => {
  const ui = await $.ui.mount(reply(fenced('flowchart TD\n  A[Start] -.-> B[End]\n  B ==> C[Last]\n  C --> A')))
  const color = async (text: RegExp) => (await ui.find({ type: 'Text', text }))?.props.color
  expect(await color(/^Start$/)).toBe(DIAGRAM_HUES[0])
  expect(await color(/^End$/)).toBe(DIAGRAM_HUES[1])
  expect(await color(/^Last$/)).toBe(DIAGRAM_HUES[2])
  for (const line of [/^╎$/, /^┃$/, /^──┘$/]) expect(await color(line)).toBe(THEME.diagram)
  for (const head of [/^▼$/, /^◄$/]) expect(await color(head)).toBe(THEME.accent)
  await ui.unmount()
})
