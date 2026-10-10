import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { diffLines, linesOf, unapply, unified } from './diff'
import { shown } from './register'

const ROOT = '/home/me/app'
const PANE = {
  title: 'Changes',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

type Seen = { disk: Map<string, string>; results: Map<string, unknown>; opened: number; closed: number }

// The engine beneath the mod: a disk the test writes, and tools that answer
// the record the test queued for each call id.
function world(on: On): Seen {
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  const seen: Seen = { disk: new Map(), results: new Map(), opened: 0, closed: 0 }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('env.get', async () => ({ value: '/home/me' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.open', async () => {
    seen.opened += 1
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async () => {
    seen.closed += 1
    return { value: undefined } as never
  })
  on('ui.render', async ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', async (_$, e) => {
    const text = seen.disk.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('tool.call', async (_$, e) => ({ result: seen.results.get(e.tool_use_id) }) as never)
  on('command.run', async () => ({ text: '' }))
  return seen
}

let calls = 0
const nextId = () => `toolu_${(calls += 1)}`

async function start($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

const patchOf = (before: string, after: string) => {
  const text = unified('f', diffLines(linesOf(before), linesOf(after)))
  return text === '' ? [] : [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: text.split('\n').slice(2) }]
}

async function edit($: Engine, seen: Seen, path: string, after: string) {
  const before = seen.disk.get(path) ?? ''
  seen.disk.set(path, after)
  const id = nextId()
  seen.results.set(id, { filePath: path, oldString: before, newString: after, originalFile: before, structuredPatch: [], userModified: false, replaceAll: false })
  await $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: path, old_string: before, new_string: after })
}

async function write($: Engine, seen: Seen, path: string, content: string) {
  const before = seen.disk.get(path)
  seen.disk.set(path, content)
  const id = nextId()
  seen.results.set(id, { type: before === undefined ? 'create' : 'update', filePath: path, content, structuredPatch: [], originalFile: before ?? null })
  await $.tool.call({ tool: 'Write', tool_use_id: id, file_path: path, content })
}

/** A Bash call that changed `path` to `after` (null deletes it), reported as bashEditDiff hunks. */
async function bash($: Engine, seen: Seen, path: string, after: string | null) {
  const before = seen.disk.get(path)
  const hunks = after === null ? patchOf(before ?? '', '') : before === undefined ? patchOf('', after) : realHunks(before, after)
  if (after === null) seen.disk.delete(path)
  else seen.disk.set(path, after)
  const id = nextId()
  const file = { filePath: path.replace(`${ROOT}/`, ''), hunks, ...(before === undefined ? { created: true as const } : {}), ...(after === null ? { deleted: true as const } : {}) }
  seen.results.set(id, { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [file], moreFiles: 0 } })
  await $.tool.call({ tool: 'Bash', tool_use_id: id, command: `sed -i '' x ${path}` })
}

/** Hunks with the line numbers a real unified diff carries. */
function realHunks(before: string, after: string) {
  const text = unified('f', diffLines(linesOf(before), linesOf(after)), 1)
  const hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] = []
  for (const line of text.split('\n').slice(2)) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line)
    if (header !== null) hunks.push({ oldStart: Number(header[1]), oldLines: Number(header[2]), newStart: Number(header[3]), newLines: Number(header[4]), lines: [] })
    else hunks[hunks.length - 1]?.lines.push(line)
  }
  return hunks
}

const pane = ($: Engine) => $.ui.mount({ plugin: 'cc-changes', surface: 'terminal', component: 'Pane', requestId: 'cc-changes', props: PANE })

async function rows(ui: Awaited<ReturnType<typeof pane>>) {
  return (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('file-')).map(b => b.text.replace(/\s+/g, ' ').trim())
}

const slash = ($: Engine) => $.command.run({ command: 'changes', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

test('edits to one file add up to its net change against the file the session found', async ($, on) => {
  const seen = world(on)
  seen.disk.set(`${ROOT}/a.ts`, 'one\ntwo\nthree\n')
  await start($)
  await edit($, seen, `${ROOT}/a.ts`, 'one\nTWO\nthree\nfour\n')
  await edit($, seen, `${ROOT}/a.ts`, 'one\nTWO\nthree\n')
  const ui = await pane($)
  expect(await rows(ui)).toEqual(['M a.ts +1 −1'])
  expect((await ui.find({ type: 'Text', text: /1 file/ }))?.text).toContain('+1')
})

test('Write, Bash create, Bash edit and Bash delete each show with their status', async ($, on) => {
  const seen = world(on)
  seen.disk.set(`${ROOT}/old.md`, 'a\nb\n')
  seen.disk.set(`${ROOT}/sed.txt`, 'x\ny\nz\nw\n')
  await start($)
  await write($, seen, `${ROOT}/new.ts`, 'export const x = 1\nexport const y = 2\n')
  await bash($, seen, `${ROOT}/made.sh`, 'echo hi\n')
  await bash($, seen, `${ROOT}/sed.txt`, 'x\nY\nz\nw\nv\n')
  await bash($, seen, `${ROOT}/old.md`, null)
  const ui = await pane($)
  expect(await rows(ui)).toEqual(['A made.sh +1 −0', 'A new.ts +2 −0', 'D old.md +0 −2', 'M sed.txt +2 −1'])
})

test('an Edit record with no originalFile is rebuilt from its patch', async ($, on) => {
  const seen = world(on)
  const path = `${ROOT}/a.ts`
  seen.disk.set(path, 'one\ntwo\nthree\n')
  await start($)
  seen.disk.set(path, 'one\n2\nthree\n')
  seen.results.set('toolu_np', { filePath: path, oldString: 'two', newString: '2', originalFile: null, structuredPatch: realHunks('one\ntwo\nthree\n', 'one\n2\nthree\n'), userModified: false, replaceAll: false })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_np', file_path: path, old_string: 'two', new_string: '2' })
  const ui = await pane($)
  expect(await rows(ui)).toEqual(['M a.ts +1 −1'])
})

test('a file changed back to how the session found it leaves the list', async ($, on) => {
  const seen = world(on)
  seen.disk.set(`${ROOT}/a.ts`, 'one\n')
  await start($)
  await edit($, seen, `${ROOT}/a.ts`, 'two\n')
  await edit($, seen, `${ROOT}/a.ts`, 'one\n')
  const ui = await pane($)
  expect(await rows(ui)).toEqual([])
  expect((await ui.find({ type: 'Text' }))?.text).toContain('No file changed')
})

test('pressing a file shows its diff, and Back returns to the list', async ($, on) => {
  const seen = world(on)
  seen.disk.set(`${ROOT}/src/a.ts`, 'const a = 1\nconst b = 2\n')
  await start($)
  await edit($, seen, `${ROOT}/src/a.ts`, 'const a = 1\nconst b = 3\n')
  const ui = await pane($)
  await ui.press({ key: 'file-0' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.props.source).toBe('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3')
  await ui.press({ key: 'back' })
  expect(await rows(ui)).toEqual(['M src/a.ts +1 −1'])
})

test('/changes opens the pane, and closes it when open', async ($, on) => {
  const seen = world(on)
  await start($)
  expect((await slash($)).text).toBe('Changes pane opened.')
  expect((await slash($)).text).toBe('Changes pane closed.')
  expect((await slash($)).text).toBe('Changes pane opened.')
  expect([seen.opened, seen.closed]).toEqual([2, 1])
})

test('/clear starts the list over', async ($, on) => {
  const seen = world(on)
  seen.disk.set(`${ROOT}/a.ts`, 'one\n')
  await start($)
  await edit($, seen, `${ROOT}/a.ts`, 'two\n')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { kind: 'id', id: 's1' } } as never)
  await edit($, seen, `${ROOT}/a.ts`, 'three\n')
  const ui = await pane($)
  expect(await rows(ui)).toEqual(['M a.ts +1 −1'])
  await ui.press({ key: 'file-0' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toContain('-two\n+three')
})

test('diff helpers', async () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n'
  const after = 'a\nB\nc\nd\ne\nf\ng\nh\nI\nj\nk\n'
  expect(unified('x', diffLines(linesOf(before), linesOf(after)), 1)).toBe(
    ['--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', '@@ -8,3 +8,4 @@', ' h', '-i', '+I', ' j', '+k'].join('\n'),
  )
  expect(unapply(after, realHunks(before, after))).toBe(before)
  expect(unapply('x\n', realHunks('x\ny\n', 'x\n'))).toBe('x\ny\n')
  expect(unified('x', diffLines(['same'], ['same']))).toBe('')
  expect(shown('/home/me/app/src/a.ts', '/home/me/app', '/home/me')).toBe('src/a.ts')
  expect(shown('/home/me/notes.md', '/home/me/app', '/home/me')).toBe('~/notes.md')
  expect(shown('/tmp/x', '/home/me/app', '/home/me')).toBe('/tmp/x')
})
