import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { CLAUDE_DIFF, PREVIEW_BAND } from './theme'

// Click-anywhere cards and wrapped diff rows, ported from upstream prismantis 0.32.0 (#234, #236).

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

const result = (tool: string, output: unknown, surface: 'terminal' | 'desktop' = 'terminal', columns = 100) =>
  ({ plugin: 'cc-dazzle', surface, component: 'ToolResult' as const, requestId: 'c1', props: { tool_use_id: 'c1', tool, output, isErrored: false }, viewport: { columns, rows: 40 } })

const added = (n: number) => Array.from({ length: n }, (_, i) => `+line ${i + 1}`)
const longEdit = { filePath: '/tmp/long.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: added(25) }] }
type Drawn = { props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
const hoverOf = (node: unknown, key: string): unknown => {
  if (node === null || typeof node !== 'object') return undefined
  const n = node as Drawn
  if (n.props?.key === key) return n.hover
  for (const c of n.children ?? []) {
    const found = hoverOf(c, key)
    if (found !== undefined) return found
  }
  return undefined
}
const rowKeys = async (ui: { findAll: (q: object) => Promise<{ key?: string }[]> }) => (await ui.findAll({ type: 'Box' })).filter(b => /^d\d+(\.\d+)?$/.test(b.key ?? '')).map(b => b.key)

test('a wrapped diff line fills its row to the last cell, breaks at a space, and repeats its mark and tint on each row', async ($, on) => {
  engine(on)
  const first = `${'a'.repeat(20)} ${'b'.repeat(47 - 21)}`
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/w.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${first} ccc`] }] }, 'terminal', 60))
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d0(\.\d+)?$/.test(b.key ?? ''))
  expect(rows.map(r => r.text)).toEqual([`1 + ${first}`, '  +  ccc'])
  expect(rows.map(r => r.props.backgroundColor)).toEqual([CLAUDE_DIFF.dark.addBg, CLAUDE_DIFF.dark.addBg])
  await ui.unmount()
})

test('a wrapped line breaks inside a word wider than the row, and draws tabs as spaces to the next stop of 8', async ($, on) => {
  engine(on)
  const word = 'x'.repeat(70)
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/w.go', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${word}`, '+\tport := 1', '+ab\tc'] }] }, 'terminal', 60))
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.filter(b => /^d0(\.\d+)?$/.test(b.key ?? '')).map(r => r.text.slice(4))).toEqual([word.slice(0, 47), word.slice(47)])
  expect(boxes.find(b => b.key === 'd1')?.text).toBe('2 +         port := 1')
  expect(boxes.find(b => b.key === 'd2')?.text).toBe('3 + ab      c')
  await ui.unmount()
})

test('a diff line with no room to spare stays one row', async ($, on) => {
  engine(on)
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/w.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [`+${long}`] }] }, 'terminal', 20))
  expect(await rowKeys(ui)).toEqual(['d0'])
  await ui.unmount()
})

for (const [base, surface] of [['2.1.294', 'terminal'], ['2.1.295', 'desktop']] as const) {
  test(`on Claude Code ${base} on the ${surface}, a folded card opens only from its button`, async ($, on) => {
    engine(on)
    claudeAt(on, base)
    const ui = await $.ui.mount(result('Edit', longEdit, surface))
    expect(await ui.find({ key: 'fold.rows' })).toBeUndefined()
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
    expect((await rowKeys(ui)).length).toBe(20)
    await ui.unmount()
  })
}

test('from Claude Code 2.1.295 on the terminal, a click anywhere on a folded diff card opens and closes it, and the press never inverts', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const ui = await $.ui.mount(result('Edit', longEdit))
  const card = await ui.find({ key: 'fold.rows' })
  expect(card?.props).toMatchObject({ plain: true, label: '+5 more lines' })
  expect(hoverOf(await ui.drawn(), 'fold.rows')).toEqual({ inverse: false })
  expect(card?.text).toMatch(/^\+25 −0\n 1 \+ line 1/)
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
  await ui.press({ key: 'fold.rows' })
  expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
  expect((await ui.find({ key: 'fold.rows' }))?.props.label).toBe('show less')
  await ui.press({ key: 'fold.rows' })
  expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeUndefined()
  await ui.unmount()
})

test('inside a press each tinted row is padded to the widest row so its tint reads as a band', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const lines = [...added(21), '+a much longer line than the others']
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/pad.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }))
  const card = (await ui.find({ key: 'fold.rows' }))?.text ?? ''
  const rows = card.split('\n').slice(1)
  expect(new Set(rows.map(r => r.length)).size).toBe(1)
  expect((await ui.findAll({ type: 'Text', text: /^ +$/ })).some(n => n.props.backgroundColor === CLAUDE_DIFF.dark.addBg)).toBe(true)
  await ui.unmount()
})

test('a short card has nothing to open, so it stays plain rows', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/s.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: added(3) }] }))
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await rowKeys(ui)).toEqual(['d0', 'd1', 'd2'])
  await ui.unmount()
})

const writeNew = (n: number) => ({ type: 'create', filePath: '/tmp/new.ts', content: Array.from({ length: n }, (_, i) => `export const n${i + 1} = ${i + 1}`).join('\n') + '\n', structuredPatch: [], originalFile: null })

test('a new file\'s preview opens from a click anywhere on it and lights a band under the pointer', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const ui = await $.ui.mount(result('Write', writeNew(14)))
  const card = await ui.find({ key: 'fold.rows' })
  expect(hoverOf(await ui.drawn(), 'fold.rows')).toEqual({ inverse: false, backgroundColor: PREVIEW_BAND })
  expect(card?.text).toMatch(/^Created \/tmp\/new\.ts \(14 lines\)\n 1   export const n1 = 1/)
  await ui.press({ key: 'fold.rows' })
  expect((await ui.find({ key: 'fold.rows' }))?.text).toContain('14   export const n14 = 14')
  await ui.unmount()
})

test('a deleted file\'s header is itself the button that opens its removed lines', async ($, on) => {
  engine(on)
  claudeAt(on, '2.1.295')
  const hunks = [{ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, lines: ['-alpha', '-beta'] }]
  const ui = await $.ui.mount(result('Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/tmp/old.txt', hunks, deleted: true }], moreFiles: 0 } }))
  const head = await ui.find({ key: 'fold0' })
  expect(head?.props).toMatchObject({ plain: true, label: 'show 2 lines' })
  expect(head?.text).toBe('Deleted /tmp/old.txt (2 lines)')
  expect(await ui.find({ type: 'Text', text: /alpha/ })).toBeUndefined()
  await ui.press({ key: 'fold0' })
  expect((await ui.find({ key: 'fold0.rows' }))?.text).toBe('1 - alpha\n2 - beta ')
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
  await ui.unmount()
})
