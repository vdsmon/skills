import { expect, test } from 'claude-code/testing'

import { mermaidText } from './mermaid'

// A back edge points against the flow of a diagram: a return to an earlier node. Each one draws
// whole, on a lane of its own, with its own label. A diagram with a back edge that has no free route
// shows its source. The routing is scripts/dazzle-vendor/back-edges.ts, built into the vendor bundle.

const reply = (text: string, columns = 100) => ({
  plugin: 'cc-dazzle',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

const art = (...rows: string[]) => rows.join('\n')
const count = (text: string, part: string) => text.split(part).length - 1

const RETURNS = (direction: string) => `flowchart ${direction}
  PF[persona-fanout] --> MAP["MAP<br/>mapper + scripts<br/>out: the design, sealed"]
  MAP --> MAKE["MAKE<br/>Wonder + scripts<br/>in: one design<br/>out: the task"]
  MAKE --> QA["QA<br/>the only judge"]
  QA --> RP[rollouts-packaging]
  MAKE -. "once: this design cannot be made" .-> MAP
  QA -. fix .-> MAP
  RP -. difficulty .-> MAP`
const LABELS = ['once: this design cannot be made', 'fix', 'difficulty']

test('three edges that return to one node of a flowchart LR each draw whole, on a lane with its own label', () => {
  const rows = mermaidText(RETURNS('LR'), 200)!.split('\n')
  const flow = rows.find(row => row.includes('persona-fanout'))!
  expect(count(flow, '►')).toBe(4)
  for (const label of LABELS) expect(flow).not.toContain(label)

  const lanes = rows.slice(-3)
  expect(LABELS.map(label => rows.findIndex(row => row.includes(label)))).toEqual([rows.length - 3, rows.length - 2, rows.length - 1])
  for (const [i, lane] of lanes.entries()) {
    expect(count(lane, LABELS[i]!)).toBe(1)
    expect(lane).toMatch(/^ +[├└]┄+[^┄]+┄+┘/)
  }

  const head = rows[rows.length - 4]!
  expect(count(rows.join('\n'), '▲')).toBe(1)
  expect(count(head, '┆')).toBe(3)
  expect(count(rows[rows.length - 5]!, '┬')).toBe(3)
  const box = rows.find(row => row.includes('MAP'))!
  const under = [...head].indexOf('▲')
  expect(under).toBeGreaterThan([...box].indexOf('M') - 12)
  expect(under).toBeLessThan([...box].indexOf('M') + 12)
  expect([...lanes[0]!].indexOf('├')).toBe(under)
  expect([...lanes[2]!].indexOf('└')).toBe(under)
})

test('the same edges in a flowchart TD draw beside the boxes, each label on the leg that leaves its node', () => {
  const rows = mermaidText(RETURNS('TD'), 100)!.split('\n')
  expect(count(rows.join('\n'), '▼')).toBe(4)
  expect(count(rows.join('\n'), '◄')).toBe(1)
  expect(rows.find(row => row.includes('◄'))).toMatch(/mapper \+ scripts +│◄┄+┬┄┬┄┐$/)
  for (const [label, node] of [[LABELS[0], 'Wonder + scripts'], [LABELS[1], 'QA'], [LABELS[2], 'rollouts-packaging']] as const) {
    const row = rows.filter(r => r.includes(label!))
    expect(row).toHaveLength(1)
    expect(row[0]).toContain(node)
    expect(row[0]!.slice(row[0]!.indexOf('├'))).toMatch(/^├┄+[^┄]+┄+┘/)
  }
})

test('a wide flowchart LR with returns draws as TD where LR does not fit', async $ => {
  const ui = await $.ui.mount(reply('```mermaid\n' + RETURNS('LR') + '\n```'))
  for (const label of LABELS) expect(await ui.find({ type: 'Text', text: new RegExp(`^${label}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^diagram / })).toBeUndefined()
  await ui.unmount()
})

test('a return draws under a flowchart LR and beside a flowchart TD', () => {
  expect(mermaidText('flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]\n  C -->|retry| A', 100)).toBe(art(
    '┌───────┐   ┌──────┐   ┌───────┐',
    '│ Alpha ├──►│ Beta ├──►│ Gamma │',
    '└───────┘   └──────┘   └───┬───┘',
    '    ▲                      │',
    '    └────────retry─────────┘',
  ))
  expect(mermaidText('flowchart TD\n  A[Alpha] --> B[Beta] --> C[Gamma]\n  C -->|retry| A', 100)).toBe(art(
    '┌───────┐',
    '│ Alpha │◄───────┐',
    '└───┬───┘        │',
    '    ▼            │',
    '┌───────┐        │',
    '│  Beta │        │',
    '└───┬───┘        │',
    '    ▼            │',
    '┌───────┐        │',
    '│ Gamma ├─retry──┘',
    '└───────┘',
  ))
})

test('returns that share a port join with a tee, and returns that cross draw a cross', () => {
  expect(mermaidText('flowchart LR\n  A --> B\n  B -->|one| A\n  B -->|two| A', 100)).toBe(art(
    '┌───┐   ┌───┐',
    '│ A ├──►│ B │',
    '└───┘   └─┬─┘',
    '  ▲       │',
    '  ├──one──┤',
    '  └──two──┘',
  ))
  expect(mermaidText('graph TD\n  A --> B\n  B --> C\n  C --> A\n  C --> D\n  D --> B', 100)).toBe(art(
    '┌───┐',
    '│ A │◄──┐',
    '└─┬─┘   │',
    '  ▼     │',
    '┌───┐   │',
    '│ B │◄──┼─┐',
    '└─┬─┘   │ │',
    '  ▼     │ │',
    '┌───┐   │ │',
    '│ C ├───┘ │',
    '└─┬─┘     │',
    '  ▼       │',
    '┌───┐     │',
    '│ D ├─────┘',
    '└───┘',
  ))
})

test('a return to a node whose far side is taken goes around the outside of the diagram', () => {
  const rows = mermaidText('flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B', 100)!.split('\n')
  expect(rows.find(row => row.includes('OK?'))).toMatch(/^ ┌─►│ +OK\? +├/)
  expect(rows.find(row => row.includes('Fix'))).toMatch(/^ │ .*│ Fix │$/)
  expect(rows[rows.length - 2]).toMatch(/^ │ .*└──┬──┘$/)
  expect(rows[rows.length - 1]).toMatch(/^ └─+┘$/)
})

test('returns of different line styles keep to their own lanes and ports', () => {
  const rows = mermaidText('flowchart LR\n  A --> B --> C\n  C --> A\n  C -.-> B\n  B ==> A', 100)!
  expect(rows).toContain('└┄┄┄┄┄┄┄┘')
  expect(rows).toContain('┌━━━━━━━┐')
  expect(rows).toMatch(/└─+┘$/)
  expect(count(rows, '▲')).toBe(2)
  expect(count(rows, '▼')).toBe(1)
})

test('an edge from a node to itself turns one corner of the node', () => {
  expect(mermaidText('flowchart LR\n  A[Alpha] --> B[Beta]\n  B -->|again| B', 100)).toBe(art(
    '┌───────┐   ┌──────┐',
    '│ Alpha ├──►│ Beta │◄────┐',
    '└───────┘   └───┬──┘     │',
    '                └─again──┘',
  ))
})

test('a diagram with a back edge that has no free route shows its source', async $ => {
  const hemmedIn = 'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]\n  B -->|again| B'
  const inSubgraph = 'flowchart LR\n  subgraph one[First]\n    A[Alpha] --> B[Beta]\n    B -->|again| A\n  end\n  B --> C[Gamma]'
  for (const source of [hemmedIn, inSubgraph]) {
    expect(mermaidText(source, 100)).toBeNull()
    const ui = await $.ui.mount(reply('```mermaid\n' + source + '\n```'))
    expect(await ui.find({ type: 'Text', text: /^diagram failed to render$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /again/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an edge routed under the last row of nodes is drawn, not cut off', () => {
  const rows = mermaidText('flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma] --> D[Delta]\n  A -->|skip| D', 100)!
  expect(rows).toMatch(/│ Delta │◄─+┘/)
})

test('a flowchart with no back edge draws as before', () => {
  expect(mermaidText('flowchart LR\n  Q[Queue] --> A[One] & B[Two] & C[Three]\n  A & B & C --> D[Done]', 100)).toBe(art(
    '┌───────┐   ┌───────┐   ┌──────┐',
    '│ Queue ├──►│  One  ├──►│ Done │',
    '└───┬───┘   └───────┘   └──────┘',
    '    │                       ▲',
    '    │       ┌───────┐       │',
    '    ├──────►│  Two  ├───────┤',
    '    │       └───────┘       │',
    '    │       ┌───────┐       │',
    '    └──────►│ Three ├───────┘',
    '            └───────┘',
  ))
})
