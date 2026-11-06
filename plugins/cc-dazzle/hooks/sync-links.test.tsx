import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

import { drawsHyperlinks } from './links'
import { isReadOnlyCall } from './readonly'
import { THEME } from './theme'

// Link and path fixes ported from upstream prismantis 0.32.1 to 0.44.0, each with its upstream test.

const reply = (text: string, columns = 100, surface: 'terminal' | 'desktop' = 'terminal', isFullscreen?: boolean) => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40, ...(isFullscreen === undefined ? {} : { isFullscreen }) },
})
const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))
const filesAt = (on: On, base: string) => {
  claudeAt(on, base)
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me' })
  on('session.root', () => ({ value: '/work/app' }))
}
// Older engines refuse links; a test that needs them stops early there.
const linksFiles = async (mounting: Promise<{ findAll: (q: { type: 'Link' }) => Promise<unknown[]>; unmount: () => Promise<void> }>) => {
  const ui = await mounting
  const links = (await ui.findAll({ type: 'Link' })).length > 0
  await ui.unmount()
  return links
}
const hrefs = async (ui: { findAll: (q: { type: 'Link' }) => Promise<{ props: { href?: unknown } }[]> }) => (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
const pathTexts = async (ui: { findAll: (q: { type: 'Text'; text: RegExp }) => Promise<{ props: { color?: unknown } }[]> }, text: RegExp) =>
  (await ui.findAll({ type: 'Text', text })).filter(n => n.props.color === THEME.path).length
const toolUse = (tool: string, input: unknown, id = `t-${tool}`) => ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'ToolUse' as const, props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false } })
const unixPath = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')

const COMMANDS = 'Run /config or /compact first.\n\n- /config opens the settings\n- /compact frees context\n\n| command | does |\n|---|---|\n| /config | settings |\n| /compact | context |'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`slash commands like /config in a paragraph, a list and a table stay unlinked path-colored text on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    const ui = await $.ui.mount(reply(COMMANDS, 100, surface))
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect([await pathTexts(ui, /^\/config$/), await pathTexts(ui, /^\/compact$/)]).toEqual([3, 3])
    await ui.unmount()
  })
}

test('an absolute path links only when a name follows its first slash-separated name', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const ui = await $.ui.mount(reply('Open /tmp/app.ts, ./x.md or ~/x.md. See /tmp/ and /config. Then /config:3, /srv/log.txt., /srv/app.ts:12, // and / alone'))
  expect(await hrefs(ui)).toEqual(['file:///tmp/app.ts', 'file:///work/app/x.md', 'file:///home/me/x.md', 'file:///srv/log.txt', 'file:///srv/app.ts'])
  expect([await pathTexts(ui, /^\/tmp\/$/), await pathTexts(ui, /^\/config\.$/), await pathTexts(ui, /^\/config$/)]).toEqual([1, 1, 1])
  await ui.unmount()
})

test('tool rows and file:// links still link a one-part absolute path', async ($, on) => {
  filesAt(on, '2.1.289')
  on('fs.stat', (_, e, next) => (unixPath(e.path) === '/etc' ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } } : next(e)))
  const clock = mock.clock(on)
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const first = await $.ui.mount(toolUse('Read', { file_path: '/etc' }))
  await clock.settle()
  await first.unmount()
  const row = await $.ui.mount(toolUse('Read', { file_path: '/etc' }))
  expect(await hrefs(row)).toEqual(['file:///etc'])
  await row.unmount()
  const ui = await $.ui.mount(reply('[/config.md](file:///config.md)'))
  expect(await hrefs(ui)).toEqual(['file:///config.md'])
  await ui.unmount()
})

const EDITOR_LINKS = '[note](vscode://file/C:/src/notes.md:12) [insiders](vscode-insiders://file/home/me/app.ts) [cursor](cursor://file/C:/src/app.ts:3:5) [windsurf](windsurf://file/home/me/run.py:7) [zed](zed://file/home/me/main.rs:9:2) [clone](vscode://vscode.git/clone?url=https://example.com/x.git) [zclone](zed://git/clone?repo=https://example.com/x.git) [settings](zed://settings)'

test('Cursor, Windsurf and Zed file links become terminal hyperlinks from Claude Code 2.1.294', async ($, on) => {
  claudeAt(on, '2.1.294')
  const ui = await $.ui.mount(reply(EDITOR_LINKS))
  expect(await hrefs(ui)).toEqual(['vscode://file/C:/src/notes.md:12', 'vscode-insiders://file/home/me/app.ts', 'cursor://file/C:/src/app.ts:3:5', 'windsurf://file/home/me/run.py:7', 'zed://file/home/me/main.rs:9:2'])
  expect(await ui.find({ type: 'Text', text: /^zclone \(zed:\/\/git\/clone\?repo=https:\/\/example\.com\/x\.git\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^settings \(zed:\/\/settings\)$/ })).toBeDefined()
  await ui.unmount()
})

const OBSIDIAN = '[note](obsidian://open?vault=notes&file=todo) [path](OBSIDIAN:///notes/todo.md) [add](obsidian://new?vault=notes&name=x) [append](obsidian://open?vault=notes&file=todo&append=x) [app](obsidian://open?vault=v&file=run.command) [hidden](obsidian://open?vault=v&file=x%3F.command)'

for (const [where, base, isFullscreen, linked] of [
  ['outside fullscreen from Claude Code 2.1.294', '2.1.294', false, true],
  ['in fullscreen, where Claude Code opens only allowlisted schemes', '2.1.294', true, false],
  ['when the screen mode is unknown', '2.1.294', undefined, false],
  ['on Claude Code 2.1.293', '2.1.293', false, false],
] as const) test(`Obsidian links that open a note link only ${linked ? '' : 'never '}${where}`, async ($, on) => {
  claudeAt(on, base)
  const ui = await $.ui.mount(reply(OBSIDIAN, 120, 'terminal', isFullscreen))
  expect(await hrefs(ui)).toEqual(linked ? ['obsidian://open?vault=notes&file=todo', 'OBSIDIAN:///notes/todo.md'] : [])
  expect(await ui.find({ type: 'Text', text: /^app \(obsidian:\/\/open\?vault=v&file=run\.command\)$/ })).toBeDefined()
  await ui.unmount()
})

test('in Orca paths link without FORCE_HYPERLINK', () => {
  expect(drawsHyperlinks({ TERM_PROGRAM: 'Orca' })).toBe(true)
})

const SPOOFS: [label: string, href: string][] = [
  ['https://good.example', 'https://evil.example/x'],
  ['www.good.example/login', 'https://evil.example'],
  ['paypal.com', 'https://evil.example'],
  ['pay\u200bpal.com', 'https://paypal.com'],
  ['**paypal.com**', 'https://evil.example/x'],
  ['example.com.', 'https://evil.example/x'],
  ['//paypal.com', 'https://evil.example/x'],
  ['paypal\u3002com', 'https://evil.example/x'],
  ['user@paypal.com', 'https://evil.example/x'],
  ...['\u00ad', '\u200e', '\u202e', '\u2066'].map((c): [string, string] => [`pay${c}pal.com`, 'https://paypal.com']),
]

const HONEST: [label: string, href: string][] = [
  ['docs', 'https://evil.example/x'],
  ['README.md', 'https://github.com/o/r/blob/main/README.md'],
  ['example.com', 'https://docs.example.com/x'],
  ['https://a.dev/one', 'https://a.dev/two'],
  ['GitHub.com', 'https://www.github.com/o'],
  ['read the docs', 'https://evil.example/x'],
]

test('a link whose label names another host or hides format characters draws as text with its target', async ($, on) => {
  claudeAt(on, '2.1.289')
  const ui = await $.ui.mount(reply([...SPOOFS, ...HONEST].map(([label, href]) => `[${label}](${href})`).join(' and '), 400))
  expect(await hrefs(ui)).toEqual(HONEST.map(([, href]) => href))
  const all = (await ui.findAll({ type: 'Text' })).map(n => n.text).join('\n')
  for (const [label, href] of SPOOFS) expect([label, all.includes(`(${href})`)]).toEqual([label, true])
  await ui.unmount()
})

const ON_DISK = ['/work/app/docs/guide', '/work/app/src/app.ts', '/work/app/notes.md', '/work/app/run.bat']

const onDisk = (on: On) => {
  const stats: string[] = []
  on('fs.stat', (_, e, next) => {
    const path = unixPath(e.path)
    if (!path.startsWith('/work/')) return next(e)
    stats.push(path)
    return ON_DISK.includes(path) ? { value: { kind: path.endsWith('guide') ? 'dir' as const : 'file' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: `no such file ${path}` }
  })
  return stats
}

const LOOSE = 'The guide is in docs/guide/ and the entry point is src/app.ts:42 (see `src/app.ts`).\n\nRelease notes: notes.md. Scripts: run.bat.\n\nNot paths: and/or, 1/2/3, docs/missing/file.md.'

test('paths without ./ link once a stat finds them, not before, and launchers are never stat-ed', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats = onDisk(on)
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const ui = await $.ui.mount(reply(LOOSE, 400))
  expect(await hrefs(ui)).toEqual([])
  await clock.settle()
  expect(await hrefs(ui)).toEqual(['file:///work/app/docs/guide/', 'file:///work/app/src/app.ts', 'file:///work/app/src/app.ts', 'file:///work/app/notes.md'])
  expect(stats).toContain('/work/app/and/or')
  expect(stats.filter(path => path.endsWith('.bat'))).toEqual([])
  await ui.unmount()
})

test('each path is stat-ed once a session however many times a streaming reply redraws', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats = onDisk(on)
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  for (let end = 8; end <= LOOSE.length; end += 8) {
    const ui = await $.ui.mount(reply(LOOSE.slice(0, end), 400))
    if (end % 64 === 0) await clock.settle()
    await ui.unmount()
  }
  await clock.settle()
  const counts = new Map<string, number>()
  for (const path of stats) counts.set(path, (counts.get(path) ?? 0) + 1)
  expect([...counts].filter(([, n]) => n > 1)).toEqual([])
})

test('an extensionless file never links and an extensionless folder links once a stat finds a folder', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  on('fs.stat', (_, e) => ({ value: { kind: /^\/(usr\/local|work\/app\/docs)$/.test(unixPath(e.path)) ? 'dir' as const : 'file' as const, size: 1, mtimeMs: 0, isLink: false } }))
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const ui = await $.ui.mount(reply('Run /bin/sh, /usr/bin/say or /usr/bin/python3.12, see [/bin/sh](file:///bin/sh), `bin/tool`, docs/ and /usr/local.'))
  await clock.settle()
  expect(await hrefs(ui)).toEqual(['file:///work/app/docs/', 'file:///usr/local'])
  await ui.unmount()
  for (const [tool, input, linked] of [['Read', { file_path: '/usr/bin/say' }, []], ['Grep', { pattern: 'x', path: '/usr/local' }, ['file:///usr/local']]] as const) {
    const row = await $.ui.mount(toolUse(tool, input))
    await clock.settle()
    const again = await $.ui.mount(toolUse(tool, input, `again-${tool}`))
    expect(await hrefs(again)).toEqual([...linked])
    await row.unmount()
    await again.unmount()
  }
})

test('a missing path is stat-ed again only after a tool call that could have made it', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats: string[] = []
  on('fs.stat', (_, e, next) => {
    if (!unixPath(e.path).includes('/work/app/')) return next(e)
    stats.push(unixPath(e.path))
    return { deny: 'no such file' }
  })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const draw = async () => {
    const ui = await $.ui.mount(reply('See src/gone.ts and docs/old.md.'))
    await clock.settle()
    await ui.unmount()
  }
  await draw()
  await $.tool.call({ tool: 'Read', file_path: '/work/app/README.md' })
  await $.tool.call({ tool: 'Write', file_path: '/work/app/other.ts', content: 'x' })
  await draw()
  expect(stats.filter(path => path === '/work/app/src/gone.ts')).toHaveLength(1)
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/gone.ts', content: 'x' })
  await draw()
  expect(stats.filter(path => path === '/work/app/src/gone.ts')).toHaveLength(2)
  expect(stats.filter(path => path === '/work/app/docs/old.md')).toHaveLength(1)
  await $.tool.call({ tool: 'Bash', command: 'make docs' })
  await draw()
  expect(stats.filter(path => path === '/work/app/docs/old.md')).toHaveLength(2)
})

test('one stat batch asks at most 200 paths', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  let stats = 0
  on('fs.stat', (_, e, next) => (unixPath(e.path).includes('/work/app/') ? (stats++, { deny: 'no such file' }) : next(e)))
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const ui = await $.ui.mount(reply(Array.from({ length: 300 }, (_, i) => `f${i}.md`).join(' ')))
  await clock.settle()
  expect(stats).toBe(200)
  await ui.unmount()
})

test('a folder links once its stat lands, even when the engine refuses the first write because a render was drawing', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  on('fs.stat', (_, e) => { const path = unixPath(e.path); return path === '/work/app/sub' ? { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } } : path === '/work/app/notes' ? { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: `no such file ${e.path}` } })
  let refused = 0
  on('state.set', (_, e, next) => (e.key === 'foundPaths' && refused++ === 0 ? { deny: 'state.set: denied: it was made while ui.render is being dispatched' } : next(e)))
  if (!(await linksFiles($.ui.mount(reply('[/x.md](file:///x.md)'))))) return
  const ui = await $.ui.mount(reply('Folder: /work/app/sub and ./sub, file /work/app/notes and ./notes'))
  await clock.advance(1000)
  expect(await hrefs(ui)).toEqual(['file:///work/app/sub', 'file:///work/app/sub'])
  await ui.unmount()
})

test('read-only calls are told from calls that may write', () => {
  for (const [tool, input, readOnly] of [
    ['Read', { file_path: '/a' }, true],
    ['Grep', { pattern: 'x' }, true],
    ['Bash', { command: 'git status && ls -la | head -3' }, true],
    ['Bash', { command: 'sed -n 1,20p a.ts' }, true],
    ['Bash', { command: 'sed -i s/a/b/ a.ts' }, false],
    ['Bash', { command: 'echo hi > out.txt' }, false],
    ['Bash', { command: 'make docs' }, false],
    ['Bash', { command: 'find . -delete' }, false],
    ['Write', { file_path: '/a' }, false],
  ] as const) expect([tool, input, isReadOnlyCall(tool, input)]).toEqual([tool, input, readOnly])
})
