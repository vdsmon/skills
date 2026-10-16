import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { CLAUDE_DIFF, THEME as t } from './theme'
import { bashEdits, EDIT_NOTES, movesTree, withoutBashEdits } from './tools'
import { takesEditorLinks, takesHttpLinks } from './version'

// Link handling (prismantis #136, #139, #116) and shell-edit diff cards (#134), with their upstream tests.

const reply = (text: string, surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 100, rows: 40 },
})

const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

test('only http and https links become terminal hyperlinks', async ($, on) => {
  claudeAt(on, '2.1.289')
  const ui = await $.ui.mount(reply('[docs](https://example.com) [dev](http://localhost:3000) [plain](http://example.com) [mail](mailto:a@example.com) [run](javascript:alert(1)) [disk](file:///etc/passwd)'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com', 'http://localhost:3000', 'http://example.com'])
  expect(await ui.find({ type: 'Text', text: /^run \(javascript:alert\(1\)\)$/ })).toBeDefined()
  await ui.unmount()
})

test('a named link drops its own underline so the terminal hyperlink style shows', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply('[cc-dazzle on GitHub](https://github.com/vdsmon/skills)', surface))
    const label = await ui.find({ type: 'Text', text: /^cc-dazzle on GitHub$/ })
    expect((await ui.findAll({ type: 'Link' }))[0]?.props.href).toBe('https://github.com/vdsmon/skills')
    expect(label?.props.color).toBe(t.link)
    expect(label?.props.underline).toBeFalsy()
    await ui.unmount()
  }
})

for (const [where, surface, base] of [
  ['on desktop, which links only https', 'desktop', '2.1.289'],
  ['on Claude Code 2.1.288, which refuses http hyperlinks', 'terminal', '2.1.288'],
  ['when the Claude Code version is unknown', 'terminal', undefined],
] as const) {
  test(`plain http links draw as plain text ${where}`, async ($, on) => {
    if (base) claudeAt(on, base)
    const ui = await $.ui.mount(reply('[plain http](http://example.com) http://example.org/raw https://example.com/raw', surface))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com/raw'])
    for (const text of [/^plain http \(http:\/\/example\.com\)$/, /^http:\/\/example\.org\/raw$/]) {
      const drawn = await ui.find({ type: 'Text', text })
      expect(drawn).toBeDefined()
      expect(drawn?.props.color).toBeUndefined()
    }
    await ui.unmount()
  })
}

test('http hyperlinks start at Claude Code 2.1.289 and VS Code file links at 2.1.294', () => {
  for (const base of ['2.1.289', '2.1.289-dev', '2.1.296', '2.1.1000', '2.2.0', '3.0.0']) expect(takesHttpLinks(base)).toBe(true)
  for (const base of ['2.1.288', '2.1.287', '2.0.999', '1.9.400', 'dev', '', undefined]) expect(takesHttpLinks(base)).toBe(false)
  for (const base of ['2.1.294', '2.1.294-dev', '2.1.296', '2.2.0']) expect(takesEditorLinks(base)).toBe(true)
  for (const base of ['2.1.293', '2.1.289', 'dev', undefined]) expect(takesEditorLinks(base)).toBe(false)
})

const EDITOR_LINKS = '[note](vscode://file/C:/src/notes.md:12) [insiders](vscode-insiders://file/home/me/app.ts) [clone](vscode://vscode.git/clone?url=https://example.com/x.git)'

test('VS Code file links become terminal hyperlinks from Claude Code 2.1.294', async ($, on) => {
  claudeAt(on, '2.1.294')
  const ui = await $.ui.mount(reply(EDITOR_LINKS))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['vscode://file/C:/src/notes.md:12', 'vscode-insiders://file/home/me/app.ts'])
  expect(await ui.find({ type: 'Text', text: /^clone \(vscode:\/\/vscode\.git\/clone\?url=https:\/\/example\.com\/x\.git\)$/ })).toBeDefined()
  await ui.unmount()
})

test('VS Code file links draw as plain text before 2.1.294', async ($, on) => {
  claudeAt(on, '2.1.293')
  const ui = await $.ui.mount(reply(EDITOR_LINKS))
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^note \(vscode:\/\/file\/C:\/src\/notes\.md:12\)$/ })).toBeDefined()
  await ui.unmount()
})

test('links that cannot be clicked draw as plain text with their target, as Claude Code draws them', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply('[mail](mailto:someone@example.com) [someone@example.com](mailto:someone@example.com) [disk](file:///etc/passwd)', surface))
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    for (const text of ['mail (someone@example.com)', 'someone@example.com', 'disk (file:///etc/passwd)']) {
      const drawn = await ui.find({ type: 'Text', text: new RegExp(`^${text.replace(/[.()]/g, '\\$&')}$`) })
      expect(drawn).toBeDefined()
      expect(drawn?.props.color).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('a table cell link that cannot be clicked draws as plain text and its column fits it', async $ => {
  const ui = await $.ui.mount(reply('| who | n |\n|---|---|\n| [mail](mailto:someone@example.com) | 1 |'))
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^mail \(someone@example\.com\)$/ })).toBeDefined()
  const widths = (await ui.findAll({ type: 'Box' })).filter(b => typeof b.props.width === 'number' && b.props.flexShrink === 0).map(b => b.props.width as number)
  expect(Math.max(...widths) >= 'mail (someone@example.com)'.length).toBe(true)
  await ui.unmount()
})

const patch = { structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'] }] }
const bashEdit = (stdout = '', more = 0) => ({
  stdout,
  stderr: '',
  interrupted: false,
  bashEditDiff: {
    files: [
      { filePath: '/home/demo/app/src/app.ts', hunks: patch.structuredPatch.map(h => ({ ...h, oldLines: 2, newLines: 3 })) },
      { filePath: '/home/demo/app/NOTES.md', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }], created: true },
    ],
    moreFiles: more,
  },
})
const shellEdit = (id: string, output: unknown, isErrored = false, surface: 'terminal' | 'desktop' = 'terminal') =>
  ({ plugin: 'cc-dazzle', surface, component: 'ToolResult' as const, props: { tool_use_id: id, tool: 'Bash', output, isErrored } })
const said = (text: string) => ({ type: 'Text' as const, text: `(${text})` })

test('shell edits read one diff per file and a count of files not shown', () => {
  expect(bashEdits(bashEdit('', 3))?.files.map(f => [f.path, f.rows.map(r => `${r.num}${r.mark}${r.text}`)])).toEqual([
    ['/home/demo/app/src/app.ts', ['4 const a = 1', '5-const b = 2', '5+const b = 3', '6+const c = 4']],
    ['/home/demo/app/NOTES.md', ['1+one', '2+two']],
  ])
  expect(bashEdits(bashEdit('', 3))?.more).toBe(3)
  expect(bashEdits({ stdout: 'x' })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [], moreFiles: 0 } })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [{ filePath: '/tmp/a' }], moreFiles: 0 } })).toBeUndefined()
  expect(bashEdits({ bashEditDiff: { files: [null], moreFiles: 0 } })).toBeUndefined()
  expect(withoutBashEdits(bashEdit('hi'))).toEqual({ stdout: 'hi', stderr: '', interrupted: false })
})

test('shell edits draw the same diff card as the Edit tool, one per file', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/demo' })
  on('session.root', () => ({ value: '/home/demo/app' }))
  const ui = await $.ui.mount(shellEdit('s-1', bashEdit('', 2)))
  expect((await ui.find({ type: 'Text', text: /^src\/app\.ts $/ }))?.props.color).toBe(t.path)
  expect((await ui.find({ type: 'Text', text: /^NOTES\.md $/ }))?.props.color).toBe(t.path)
  expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe(CLAUDE_DIFF.dark.addMark)
  expect((await ui.find({ type: 'Text', text: /^−1$/ }))?.props.color).toBe(CLAUDE_DIFF.dark.delMark)
  expect((await ui.find({ type: 'Text', text: /^… \+2 more files$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

test('a shell edit with output keeps the engine output, without the engine diff, above the cards', async ($, on) => {
  const seen: unknown[] = []
  on('ui.render', ($, e) => {
    seen.push(e.props && 'output' in e.props ? e.props.output : undefined)
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(shellEdit('s-2', bashEdit('patched 2 files')))
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\+2$/ })).toBeDefined()
  expect(seen).toEqual([{ stdout: 'patched 2 files', stderr: '', interrupted: false }])
  await ui.unmount()
})

test('each shell edit card folds on its own', async ($, on) => {
  engine(on)
  const long = Array.from({ length: 25 }, (_, i) => `+line ${i + 1}`)
  const file = (name: string) => ({ filePath: `/tmp/${name}`, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 25, lines: long }] })
  const ui = await $.ui.mount(shellEdit('s-3', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [file('a.txt'), file('b.txt')], moreFiles: 0 } }))
  expect((await ui.findAll({ type: 'Text', text: /^line 21$/ })).length).toBe(0)
  await ui.press({ key: 'fold1' })
  expect((await ui.findAll({ type: 'Box', text: /^21 \+ line 21$/ })).length).toBe(1)
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('+5 more lines')
  expect((await ui.find({ key: 'fold1' }))?.props.label).toBe('show less')
  await ui.unmount()
})

test('failed shell edits and diffs the card cannot read go to the engine', async ($, on) => {
  engine(on)
  for (const [output, isErrored] of [[bashEdit(), true], [{ stdout: '', stderr: '', bashEditDiff: { files: [], moreFiles: 0, unavailable: true } }, false], [{ stdout: '', stderr: '', bashEditDiff: { files: [{ filePath: '/tmp/a', hunks: 'x' }], moreFiles: 0 } }, false]] as const) {
    const ui = await $.ui.mount(shellEdit('s-4', output, isErrored))
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a git step that can move the working tree is told apart from other git calls', () => {
  for (const command of ['git checkout main', 'git -C repo switch feature', 'sudo git reset --hard HEAD~1', 'make && git stash pop', 'git -c core.pager=cat pull --rebase', 'FOO=1 git cherry-pick abc123'])
    expect(movesTree(command)).toBe(true)
  for (const command of ['git commit -m "checkout later"', 'git log --oneline', "echo 'git checkout main'", 'sed -i s/a/b/ notes.md', 'git diff --stat'])
    expect(movesTree(command)).toBe(false)
})

test('shell edit cards carry the notes Claude Code gives its own diff', async ($, on) => {
  engine(on)
  const first = await $.ui.mount(shellEdit('n-1', bashEdit()))
  expect((await first.find(said(EDIT_NOTES.first)))?.props.dimColor).toBe(true)
  expect(await first.find(said(EDIT_NOTES.shared))).toBeUndefined()
  expect(await first.find(said(EDIT_NOTES.tree))).toBeUndefined()
  await first.unmount()
  const second = await $.ui.mount(shellEdit('n-2', { ...bashEdit(), bashEditDiff: { ...bashEdit().bashEditDiff, shared: true } }))
  expect(await second.find(said(EDIT_NOTES.first))).toBeUndefined()
  expect((await second.find(said(EDIT_NOTES.shared)))?.props.dimColor).toBe(true)
  await second.unmount()
  const call = { tool_use_id: 'n-3', tool: 'Bash', input: { command: 'git checkout main && sed -i s/b/c/ src/app.ts' }, isRunning: false, isErrored: false, isInterrupted: false }
  const row = await $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'ToolUse', props: call })
  const third = await $.ui.mount(shellEdit('n-3', bashEdit()))
  expect((await third.find(said(EDIT_NOTES.tree)))?.props.dimColor).toBe(true)
  await third.unmount()
  await row.unmount()
})
