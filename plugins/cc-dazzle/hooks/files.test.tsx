import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { CLAUDE_DIFF, THEME as t } from './theme'
import { bashEdits, diffLines } from './tools'

// Diff and file cards ported from upstream prismantis 0.32.0 (#234, #236), each with its upstream test.

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const result = (tool: string, output: unknown, id = 'x1') =>
  ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'ToolResult' as const, requestId: id, props: { tool_use_id: id, tool, output, isErrored: false }, viewport: { columns: 100, rows: 40 } })

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const nodeCount = (n: unknown): number =>
  n == null || n === false ? 0 : Array.isArray(n) ? n.reduce((a: number, c) => a + nodeCount(c), 0) : typeof n !== 'object' ? 1 : 1 + nodeCount((n as Drawn).children)

const rowsOf = async (ui: { findAll: (q: object) => Promise<{ key?: string; text?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' })).filter(b => /^d\d+$/.test(b.key ?? '')).map(b => b.text)

const twoHunks = [
  { oldStart: 4, newStart: 4, oldLines: 3, newLines: 3, lines: [' const a = 3', '-const b = 4', '+const b = 5', ' const c = 6'] },
  { oldStart: 50, newStart: 50, oldLines: 3, newLines: 3, lines: [' const x = 50', '-const y = 51', '+const y = 52', ' const z = 52'] },
]

test('separate hunks are parted by a dim ... row, in edit and shell edit cards', async ($, on) => {
  engine(on)
  const bash = { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/tmp/far.ts', hunks: twoHunks }], moreFiles: 0 } }
  for (const [tool, output] of [['Edit', { filePath: '/tmp/far.ts', structuredPatch: twoHunks }], ['Bash', bash]] as const) {
    const ui = await $.ui.mount(result(tool, output))
    const drawn = (await ui.findAll({})).filter(n => /^d\d+$/.test(n.key ?? '') || (n.type === 'Text' && /^\.\.\.$/.test(n.text)))
    expect(drawn.map(n => n.key ?? n.text)).toEqual(['d0', 'd1', 'd2', 'd3', '...', 'd4', 'd5', 'd6', 'd7'])
    expect(drawn[4]!.props.dimColor).toBe(true)
    expect(drawn[5]!.text).toMatch(/^50   const x = 50$/)
    await ui.unmount()
  }
  const one = await $.ui.mount(result('Edit', { filePath: '/tmp/far.ts', structuredPatch: twoHunks.slice(0, 1) }))
  expect((await one.findAll({ type: 'Text', text: /^\.\.\.$/ })).length).toBe(0)
  await one.unmount()
})

const noNewline = { filePath: '/tmp/version.py', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' NAME = "tank"', '-VERSION = "1.0"', '\\ No newline at end of file', '+VERSION = "1.1"', '\\ No newline at end of file'] }] }

test('a diff keeps the no-newline marker as a row of its own that numbers nothing', () => {
  expect(diffLines(noNewline)?.map(r => `${r.num}${r.mark}${r.text}`)).toEqual(['1 NAME = "tank"', '2-VERSION = "1.0"', '0\\ No newline at end of file', '2+VERSION = "1.1"', '0\\ No newline at end of file'])
})

test('the no-newline marker draws plain and untinted, with no number or mark, and the lines around it still pair up for word marks', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', noNewline))
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => /^d\d+$/.test(b.key ?? ''))
  expect(rows.map(r => r.text)).toEqual(['1   NAME = "tank"', '2 - VERSION = "1.0"', '     No newline at end of file', '2 + VERSION = "1.1"', '     No newline at end of file'])
  expect(rows.map(r => r.props.backgroundColor)).toEqual([undefined, CLAUDE_DIFF.dark.delBg, undefined, CLAUDE_DIFF.dark.addBg, undefined])
  const note = await ui.find({ type: 'Text', text: /^ No newline at end of file$/ })
  expect(note?.props.color).toBe(t.codeText)
  expect(note?.props.dimColor).not.toBe(true)
  expect((await ui.find({ type: 'Text', text: /^1$/, props: { backgroundColor: CLAUDE_DIFF.dark.addWord } }))).toBeDefined()
  await ui.unmount()
})

test('no-newline markers do not count as lines toward the fold', async ($, on) => {
  engine(on)
  const marker = '\\ No newline at end of file'
  const added = (n: number) => Array.from({ length: n }, (_, i) => `+line ${i + 1}`)
  const fits = await $.ui.mount(result('Edit', { filePath: '/tmp/n.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [...added(20), marker] }] }))
  expect(await fits.find({ key: 'fold' })).toBeUndefined()
  expect(await fits.find({ type: 'Text', text: /^ No newline at end of file$/ })).toBeDefined()
  await fits.unmount()
  const long = await $.ui.mount(result('Edit', { filePath: '/tmp/n.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [...added(25), marker] }] }))
  expect((await long.find({ key: 'fold' }))?.props.label).toBe('+5 more lines')
  expect(await long.find({ type: 'Text', text: /^line 20$/ })).toBeDefined()
  expect(await long.find({ type: 'Text', text: /^line 21$/ })).toBeUndefined()
  await long.unmount()
})

test('a comment spanning lines keeps its color on every added and context line, removed lines staying plain', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/a.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' /* open', '+new const', ' close */', '-old const'] }] }))
  expect((await ui.find({ type: 'Text', text: /^new const$/ }))?.props.color).toBe(t.codeComment)
  expect((await ui.find({ type: 'Text', text: /^close \*\/$/ }))?.props.color).toBe(t.codeComment)
  expect((await ui.find({ type: 'Text', text: /^old const$/ }))?.props.color).toBe(t.codeText)
  await ui.unmount()
})

test('separate hunks are highlighted apart, so one hunk\'s open string cannot color the next', async ($, on) => {
  engine(on)
  const hunks = [{ oldStart: 1, newStart: 1, lines: ['+const s = `open'] }, { oldStart: 40, newStart: 40, lines: ['+const n = 1'] }]
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/a.ts', structuredPatch: hunks }))
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.findAll({ type: 'Text', text: /^const$/ })).length).toBe(2)
  await ui.unmount()
})

const dense = (n: number) => Array.from({ length: n }, (_, i) => `+{${Array.from({ length: 12 }, (_, k) => `"k${k}": ${i * 12 + k}`).join(', ')}}`)

test('an opened card of dense lines stays under the engine\'s 20000-node ceiling, drawing the lines past its node allowance plain', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/data.json', structuredPatch: [{ oldStart: 1, newStart: 1, lines: dense(450) }] }))
  await ui.press({ key: 'fold' })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  expect(nodeCount(await ui.drawn())).toBeLessThan(20000)
  expect(await ui.find({ type: 'Text', text: /^"k0"$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^\{"k0": 4788, / }))?.children).toHaveLength(1)
  await ui.unmount()
})

test('five opened shell edit cards of dense lines share one node allowance and stay under the ceiling', async ($, on) => {
  engine(on)
  const short = Array.from({ length: 450 }, (_, i) => `+[${Array.from({ length: 12 }, (_, k) => (i + k) % 10).join(',')}]`)
  const files = Array.from({ length: 5 }, (_, f) => ({ filePath: `/tmp/d${f}.json`, hunks: [{ oldStart: 1, newStart: 1, oldLines: 0, newLines: 450, lines: short }] }))
  const ui = await $.ui.mount(result('Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files, moreFiles: 0 } }))
  for (let f = 0; f < 5; f++) await ui.press({ key: `fold${f}` })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  expect(nodeCount(await ui.drawn())).toBeLessThan(20000)
  await ui.unmount()
})

test('carriage returns and other control characters never reach a diff row or a preview', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { filePath: '/tmp/crlf.txt', structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-a\r', '+b\u001b[31m\r'] }] }))
  expect(await rowsOf(ui)).toEqual(['1 - a', '1 + b'])
  await ui.unmount()
  const write = await $.ui.mount(result('Write', { type: 'create', filePath: '/tmp/crlf.txt', content: 'one\r\ntwo\u0007\r\n', structuredPatch: [], originalFile: null }))
  expect(await rowsOf(write)).toEqual(['1   one', '2   two'])
  await write.unmount()
})

const ts = (n: number) => Array.from({ length: n }, (_, i) => `export const n${i + 1} = ${i + 1}`)
const writeNew = (filePath: string, body: string[]) => ({ type: 'create', filePath, content: body.length ? `${body.join('\n')}\n` : '', structuredPatch: [], originalFile: null })

test('a file Write creates shows its first 10 lines as numbered, highlighted code with no diff marks, and opens to the rest', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Write', writeNew('/tmp/new.ts', ts(25))))
  expect(await ui.find({ type: 'Text', text: /^Created \/tmp\/new\.ts \(25 lines\)$/ })).toBeDefined()
  const rows = await rowsOf(ui)
  expect(rows).toHaveLength(10)
  expect(rows[0]).toBe(' 1   export const n1 = 1')
  expect((await ui.findAll({ type: 'Box' })).filter(b => /^d\d+$/.test(b.key ?? '')).every(b => b.props.backgroundColor === undefined)).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^export$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ key: 'fold' }))?.props.label).toBe('+15 more lines')
  await ui.press({ key: 'fold' })
  expect(await rowsOf(ui)).toHaveLength(25)
  await ui.unmount()
})

test('an empty file Write creates says so, with no lines and no button', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Write', writeNew('/tmp/empty.ts', [])))
  expect(await ui.find({ type: 'Text', text: /^Created \/tmp\/empty\.ts \(empty\)$/ })).toBeDefined()
  expect(await rowsOf(ui)).toEqual([])
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a write or edit held for review goes to the engine', async ($, on) => {
  engine(on)
  for (const [tool, output] of [['Write', { ...writeNew('/tmp/held.ts', ts(3)), staged: true }], ['Edit', { filePath: '/tmp/a.ts', structuredPatch: twoHunks, staged: true }]] as const) {
    const ui = await $.ui.mount(result(tool, output))
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})

const editMade = (filePath: string, body: string[]) =>
  ({ filePath, oldString: '', newString: body.join('\n'), originalFile: null as string | null, structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: body.length, lines: body.map(l => `+${l}`) }] })

test('an Edit that makes a file is a new file with added lines, also with no newline at its end', async ($, on) => {
  engine(on)
  const made = editMade('/tmp/made.ts', ['a', 'b'])
  made.structuredPatch[0]!.lines.push('\\ No newline at end of file')
  const ui = await $.ui.mount(result('Edit', made))
  expect(await ui.find({ type: 'Text', text: /^Created \/tmp\/made\.ts \(2 lines\)$/ })).toBeDefined()
  expect(await rowsOf(ui)).toEqual(['1 + a', '2 + b'])
  expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeUndefined()
  await ui.unmount()
})

test('an Edit into a file that had text stays a diff card, even when it only adds lines', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(result('Edit', { ...editMade('/tmp/kept.ts', ['b']), oldString: 'a', originalFile: 'a\n' }))
  expect(await ui.find({ type: 'Text', text: /^\+1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Created / })).toBeUndefined()
  await ui.unmount()
})

const madeFile = (name: string, body: string[]) =>
  ({ filePath: `/home/demo/app/${name}`, hunks: body.length ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: body.length, lines: body.map(l => `+${l}`) }] : [], created: true as const })
const removedFile = (name: string, body: string[]) =>
  ({ filePath: `/home/demo/app/${name}`, hunks: body.length ? [{ oldStart: 1, oldLines: body.length, newStart: 0, newLines: 0, lines: body.map(l => `-${l}`) }] : [], deleted: true as const })
const shellFiles = (...files: unknown[]) => ({ stdout: '', stderr: '', interrupted: false, bashEditDiff: { files, moreFiles: 0 } })
const inDemoApp = (on: On) => {
  mock.env(on, { HOME: '/home/demo' })
  on('session.root', () => ({ value: '/home/demo/app' }))
}
const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

test('shell edits tell new, removed and renamed files apart from changed ones', () => {
  const kinds = (...files: unknown[]) => bashEdits(shellFiles(...files))?.files.map(f => (f.kind === 'renamed' ? `${f.path} → ${f.to}` : `${f.kind} ${f.path}`))
  expect(kinds(removedFile('a.txt', ['one', 'two']), madeFile('b.txt', ['one', 'two']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt'])
  expect(kinds(madeFile('b.txt', ['one']), removedFile('a.txt', ['one']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt'])
  expect(kinds(removedFile('a.txt', ['one']), madeFile('b.txt', ['one', 'two']))).toEqual(['deleted /home/demo/app/a.txt', 'created /home/demo/app/b.txt'])
  expect(kinds(removedFile('a.txt', ['one']), madeFile('b.txt', ['one']), madeFile('c.txt', ['one']))).toEqual(['/home/demo/app/a.txt → /home/demo/app/b.txt', 'created /home/demo/app/c.txt'])
  expect(kinds(madeFile('empty.txt', []), { filePath: '/home/demo/app/src/app.ts', hunks: twoHunks })).toEqual(['created /home/demo/app/empty.txt', 'modified /home/demo/app/src/app.ts'])
  expect(bashEdits(shellFiles(removedFile('old.txt', ['alpha', 'beta'])))?.files).toEqual([{ kind: 'deleted', path: '/home/demo/app/old.txt', lines: ['alpha', 'beta'] }])
  expect(kinds(removedFile('pkg_a/__init__.py', []), madeFile('pkg_b/__init__.py', []))).toEqual(['deleted /home/demo/app/pkg_a/__init__.py', 'created /home/demo/app/pkg_b/__init__.py'])
})

test('a file a shell command creates shows its first 10 lines as added diff lines under a Created header', async ($, on) => {
  engine(on)
  inDemoApp(on)
  const ui = await $.ui.mount(result('Bash', shellFiles(madeFile('notes.py', numbered(14)))))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Created notes\.py \(14 lines\)$/ })).toBeDefined()
  const rows = await rowsOf(ui)
  expect(rows).toHaveLength(10)
  expect(rows[0]).toBe(' 1 + line 1')
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('+4 more lines')
  await ui.press({ key: 'fold0' })
  expect(await rowsOf(ui)).toHaveLength(14)
  await ui.unmount()
})

test('a file a shell command deletes is one Deleted line that opens to its removed lines', async ($, on) => {
  engine(on)
  inDemoApp(on)
  const ui = await $.ui.mount(result('Bash', shellFiles(removedFile('old.txt', ['alpha', 'beta']))))
  expect(await ui.find({ type: 'Text', text: /^Deleted old\.txt \(2 lines\)$/ })).toBeDefined()
  expect(await rowsOf(ui)).toEqual([])
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show 2 lines')
  await ui.press({ key: 'fold0' })
  expect(await rowsOf(ui)).toEqual(['1 - alpha', '2 - beta'])
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
  await ui.unmount()
})

test('a file moved unchanged is one Renamed line, an empty new file says so, and changed files beside them keep their card', async ($, on) => {
  engine(on)
  inDemoApp(on)
  const ui = await $.ui.mount(result('Bash', shellFiles(removedFile('a.txt', ['one']), madeFile('b/a.txt', ['one']), madeFile('empty.txt', []), { filePath: '/home/demo/app/src/far.ts', hunks: twoHunks })))
  expect(await ui.find({ type: 'Text', text: /^Renamed a\.txt → b\/a\.txt$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Created empty\.txt \(empty\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^src\/far\.ts $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})
