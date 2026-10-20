import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { renderBlocks } from './blocks'
import type { TerminalEnv } from './links'
import { drawsHyperlinks } from './links'
import { parse } from './markdown'
import { THEME as t } from './theme'

// Clickable paths and file links (prismantis #238), the label rule and the launcher rule (#240), and
// the html check redraw, each with its upstream test. WSL's wsl.localhost links are left out.

const hl = { numbers: true, paths: true }

const reply = (text: string, columns = 100) => ({
  plugin: 'cc-dazzle',
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

// Claude Code 2.1.287 and 2.1.288 refuse a file: href and throw out the whole render.
const linksFiles = (mounting: Promise<{ unmount: () => Promise<void> }>): Promise<boolean> =>
  mounting.then(async ui => (await ui.unmount(), true), () => false)

const PATHS = 'Open /srv/app/main.ts, ~/notes/todo.md or ./docs/guide.md.\n\n- Line 12 of ~/notes/list.md:12\n\n| file | rows |\n|---|---|\n| /srv/data/table.csv | 4 |'

const PATH_TEXTS = ['/srv/app/main.ts', '~/notes/todo.md', './docs/guide.md.', '~/notes/list.md', '/srv/data/table.csv']

const pathColored = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ props: { color?: unknown } }[]> }) => {
  for (const text of PATH_TEXTS) {
    const found = await ui.findAll({ type: 'Text', text: new RegExp(`^${text.replace(/[.]/g, '\\.')}$`) })
    if (!found.some(n => n.props.color === t.path)) return false
  }
  return true
}

const filesAt = (on: On, base: string | undefined, env: Record<string, string> = {}) => {
  if (base) claudeAt(on, base)
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me', ...env })
  on('session.root', () => ({ value: '/work/app' }))
}

const withoutLinks = (node: unknown): unknown => {
  if (node === null || typeof node !== 'object') return node
  const { type, props, children } = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (type === 'Link') return props?.label
  const { key: _key, ...rest } = props ?? {}
  return { type, props: rest, children: children?.map(withoutLinks) }
}

const hrefs = async (ui: { findAll: (query: { type: 'Link' }) => Promise<{ props: { href?: unknown } }[]> }) => (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))

const SPECIAL = /[.*+?^${}()|[\]\\]/g

test('paths in a paragraph, a list and a table link to their files', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply(PATHS))
  expect(await hrefs(ui)).toEqual(['/srv/app/main.ts', '/home/me/notes/todo.md', '/work/app/docs/guide.md', '/home/me/notes/list.md', '/srv/data/table.csv'].map(path => `file://${path}`))
  expect(await pathColored(ui)).toBe(true)
  await ui.unmount()
})

test('file:// markdown links labelled with their path become hyperlinks', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply('[/home/me/notes.md](file:///home/me/notes.md) [/srv/x.log](file://localhost/srv/x.log) [C:\\Users\\me\\x.txt](file:///C:/Users/me/x.txt) [\\\\server\\share\\x.txt](file://server/share/x.txt)'))
  expect(await hrefs(ui)).toEqual(['file:///home/me/notes.md', 'file://localhost/srv/x.log', 'file:///C:/Users/me/x.txt', 'file://server/share/x.txt'])
  expect((await ui.find({ type: 'Text', text: /^\/home\/me\/notes\.md$/ }))?.props.color).toBe(t.link)
  await ui.unmount()
})

const LABELS: [label: string, href: string, linked: boolean][] = [
  ['/tmp/notes.md', 'file:///tmp/notes.md', true],
  ['file:///tmp/notes.md', 'file:///tmp/notes.md', true],
  ['FILE://localhost/tmp/notes.md', 'file:///tmp/notes.md', true],
  ['/tmp/notes.md.', 'file:///tmp/notes.md', true],
  ['~/notes/todo.md', 'file:///home/me/notes/todo.md', true],
  ['./docs/guide.md', 'file:///work/app/docs/guide.md', true],
  ['../shared/a.txt', 'file:///work/shared/a.txt', true],
  ['/tmp/a b.md', 'file:///tmp/a%20b.md', true],
  ['/home/me/', 'file:///home/me', true],
  ['/tmp/a.html', 'file:///tmp/a.html#s', true],
  ['C:\\Users\\me\\x.txt', 'file:///C:/Users/me/x.txt', true],
  ['\\\\server\\share\\x.txt', 'file://server/share/x.txt', true],
  ['notes', 'file:///tmp/notes.md', false],
  ['notes.md', 'file:///tmp/notes.md', false],
  ['the docs', 'file:///tmp/setup.command', false],
  ['/tmp/notes.md', 'file:///tmp/setup.command', false],
  ['/tmp/notes.md', 'file:///tmp/notes.md/../setup.command', false],
  ['~/notes.md', 'file:///tmp/notes.md', false],
  ['/srv/share/x.txt', 'file://srv/share/x.txt', false],
  ['/tmp/a.html#s', 'file:///tmp/a.html#s', false],
  ['/tmp/a%20b.md', 'file:///tmp/a%20b.md', false],
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a file:// link stays a link only when its label shows its own path, on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...reply(LABELS.map(([label, href]) => `[${label}](${href})`).join(' and '), 400), surface })
    const linked = LABELS.filter(([, , links]) => links && surface === 'terminal')
    expect(await hrefs(ui)).toEqual(linked.map(([, href]) => href))
    const missing: string[] = []
    for (const [label, href] of LABELS.filter(row => !linked.includes(row))) {
      const text = label === href ? href : `${label} (${href})`
      if (!(await ui.find({ type: 'Text', text: new RegExp(`^${text.replace(SPECIAL, '\\$&')}$`) }))) missing.push(text)
    }
    expect(missing).toEqual([])
    await ui.unmount()
  })
}

test('a home folder with a space is percent-encoded in the file link', async ($, on) => {
  filesAt(on, '2.1.289', { HOME: '/home/Mara Schwartz' })
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply('Settings live in ~/.claude/settings.json and ../shared/a+b@2.txt'))
  expect(await hrefs(ui)).toEqual(['file:///home/Mara%20Schwartz/.claude/settings.json', 'file:///work/shared/a+b@2.txt'])
  await ui.unmount()
})

for (const [where, surface, base, env] of [
  ['on Claude Code 2.1.288, which refuses file hyperlinks', 'terminal', '2.1.288', {}],
  ['when the Claude Code version is unknown', 'terminal', undefined, {}],
  ['on desktop', 'desktop', '2.1.289', {}],
  ['in a terminal that draws no hyperlinks', 'terminal', '2.1.289', { FORCE_HYPERLINK: '0' }],
  ['in a session over SSH', 'terminal', '2.1.289', { SSH_CONNECTION: '10.0.0.2 52814 10.0.0.9 22' }],
] as const) {
  test(`paths stay plain colored text ${where}`, async ($, on) => {
    filesAt(on, base, env)
    const ui = await $.ui.mount({ ...reply(PATHS), surface })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect(await pathColored(ui)).toBe(true)
    await ui.unmount()
  })
}

test('a terminal that draws no hyperlinks still links file:// markdown links', async ($, on) => {
  filesAt(on, '2.1.289', { FORCE_HYPERLINK: '0', TERM_PROGRAM: 'Apple_Terminal' })
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply('[~/notes.md](file:///home/me/notes.md) and ~/notes/todo.md'))
  expect(await hrefs(ui)).toEqual(['file:///home/me/notes.md'])
  await ui.unmount()
})

for (const env of [{ SSH_CONNECTION: '10.0.0.2 52814 10.0.0.9 22' }, { SSH_TTY: '/dev/pts/3' }] as Record<string, string>[]) {
  test(`file:// links draw as plain text in a session over SSH (${Object.keys(env)[0]})`, async ($, on) => {
    filesAt(on, '2.1.289', env)
    const ui = await $.ui.mount(reply('[/home/me/notes.md](file:///home/me/notes.md) and [docs](https://example.com)'))
    expect(await hrefs(ui)).toEqual(['https://example.com'])
    expect(await ui.find({ type: 'Text', text: /^\/home\/me\/notes\.md \(file:\/\/\/home\/me\/notes\.md\)$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('file links on desktop draw as plain text, as before', async ($, on) => {
  filesAt(on, '2.1.289')
  const ui = await $.ui.mount({ ...reply('[/home/me/notes.md](file:///home/me/notes.md)'), surface: 'desktop' })
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^\/home\/me\/notes\.md \(file:\/\/\/home\/me\/notes\.md\)$/ })).toBeDefined()
  await ui.unmount()
})

for (const columns of [120, 34]) {
  test(`linked paths keep every width, wrap and table column at ${columns} columns`, async ($, on) => {
    const source = `${PATHS}\n\n| a long path column | n |\n|---|---|\n| /srv/very/long/folder/name/that/wraps/file.txt | 1 |`
    const plain = { theme: t, htmlCopy: null, httpLinks: true, home: '/home/me', cwd: '/work/app' }
    const blocks = parse(source, hl)
    let drawnPlain: unknown
    let drawnLinked: unknown
    on('ui.render', ($, e) => {
      const el = $.ui.resolve(e)
      drawnPlain = renderBlocks(el, plain, blocks, columns)
      drawnLinked = renderBlocks(el, { ...plain, fileLinks: true, pathLinks: true }, blocks, columns)
      return <el.Text>engine</el.Text>
    })
    const ui = await $.ui.mount(reply(''))
    await ui.unmount()
    const count = (node: unknown): number => (node === null || typeof node !== 'object' ? 0 : ((node as { type?: string }).type === 'Link' ? 1 : 0) + ((node as { children?: unknown[] }).children ?? []).reduce<number>((n, c) => n + count(c), 0))
    expect(count({ children: drawnPlain })).toBe(0)
    expect(count({ children: drawnLinked }) > PATH_TEXTS.length).toBe(true)
    expect(JSON.stringify(withoutLinks({ children: drawnLinked }))).toBe(JSON.stringify(withoutLinks({ children: drawnPlain })))
  })
}

test('a path or link longer than Claude Code draws stays text, and the reply still draws', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const long = `/${'a'.repeat(60)}`.repeat(35)
  const web = `https://example.com/${'b'.repeat(2050)}`
  const wide = `https://example.com/${'文'.repeat(700)}`
  const ui = await $.ui.mount(reply(`see ${long} here\n\n${web}\n\n[wide](${wide}) and ~/short.md`))
  expect(await hrefs(ui)).toEqual(['file:///home/me/short.md'])
  expect(await ui.find({ type: 'Text', text: /^wide \(https:\/\/example\.com\/文+\)$/ })).toBeDefined()
  await ui.unmount()
})

test('a line holding only a tag is never drawn as a path, so it never links', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply('<tldr>\n- First point, see /tmp/example.\n</tldr>'))
  expect(await hrefs(ui)).toEqual(['file:///tmp/example'])
  expect(await ui.find({ type: 'Text', text: /^<\/tldr>$/ })).toBeDefined()
  await ui.unmount()
})

test('paths link in the terminals Claude Code draws hyperlinks in, and only those', () => {
  const cases: [TerminalEnv, boolean][] = [
    [{}, false],
    [{ FORCE_HYPERLINK: '1' }, true],
    [{ FORCE_HYPERLINK: '0', WT_SESSION: 'x' }, false],
    [{ WT_SESSION: '' }, true],
    [{ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.3a' }, false],
    [{ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.4' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.71.2' }, false],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.72.0' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.5.0' }, false],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '0.4.1' }, false],
    [{ TERM_PROGRAM: 'vscode' }, false],
    [{ TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20240203-110809-5046fc22' }, true],
    [{ TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20200101-000000-0' }, false],
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.0.0' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, true],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
    [{ VTE_VERSION: '7600' }, true],
    [{ VTE_VERSION: '4600' }, false],
    [{ VTE_VERSION: '0.50.0' }, false],
    [{ LC_TERMINAL: 'iTerm2' }, true],
    [{ LC_TERMINAL: 'Konsole' }, false],
    [{ TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, true],
    [{ TERM: 'xterm-kitty' }, true],
    [{ TERM: 'alacritty' }, true],
    [{ TERM: 'xterm-256color' }, false],
  ]
  for (const [env, linked] of cases) expect([env, drawsHyperlinks(env)]).toEqual([env, linked])
})

for (const [version, linked] of [['1.5.0', false], ['1.95.3', true]] as const) {
  test(`a VS Code terminal at ${version} ${linked ? 'links' : 'does not link'} paths, as Claude Code decides`, async ($, on) => {
    filesAt(on, '2.1.289', { FORCE_HYPERLINK: '', TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: version })
    if (linked && !(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(reply('Open ~/notes/todo.md'))
    expect(await hrefs(ui)).toEqual(linked ? ['file:///home/me/notes/todo.md'] : [])
    await ui.unmount()
  })
}

test('the link check reads the environment once, however many replies draw', async ($, on) => {
  claudeAt(on, '2.1.289')
  const reads: string[] = []
  const env: Record<string, string> = { FORCE_HYPERLINK: '1', HOME: '/home/me' }
  on('env.get', (_, e) => {
    reads.push(e.name)
    return { value: env[e.name] }
  })
  for (const text of ['one', 'two', 'three']) {
    const ui = await $.ui.mount(reply(text))
    await ui.unmount()
  }
  for (const name of ['FORCE_HYPERLINK', 'TERM_PROGRAM_VERSION', 'LC_TERMINAL', 'TERMINAL_EMULATOR', 'SSH_TTY']) expect([name, reads.filter(n => n === name).length]).toEqual([name, 1])
})

const PROGRAMS = [
  '/Applications/Calculator.app', '/tmp/run/x.command', '/tmp/run/x.exe', '/tmp/run/x.bat', '/tmp/run/x.cmd', '/tmp/run/x.ps1', '/tmp/run/x.vbs', '/tmp/run/x.js',
  '/tmp/run/x.hta', '/tmp/run/x.lnk', '/tmp/run/x.desktop', '/tmp/run/x.sh', '/tmp/run/x.msi', '/tmp/run/x.scr', '/tmp/run/x.jar', '/tmp/run/x.py', '/tmp/run/x.url',
  '/tmp/run/x.AppImage', '/tmp/run/X.EXE', '/tmp/run/Setup.Command', '/tmp/run/x.Sh', '/tmp/run/x.pdf.exe', '/Applications/Calculator.app/', '/Applications/Calculator.app/Contents/MacOS/Calculator',
]

const DOCUMENTS = ['/tmp/doc/a.ts', '/tmp/doc/a.md', '/tmp/doc/a.json', '/tmp/doc/a.png', '/tmp/doc/a.txt', '/tmp/doc/a.html', '/tmp/doc/a.exe.txt', '/tmp/doc/scripts/', '/tmp/chart.js/README.md']

const toolCall = (tool: string, input: unknown, id: string) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

const linkPairs = async (ui: { findAll: (query: { type: 'Link' }) => Promise<{ props: { label?: unknown; href?: unknown } }[]> }) =>
  (await ui.findAll({ type: 'Link' })).map(l => [l.props.label, l.props.href])

for (const surface of ['terminal', 'desktop'] as const) {
  test(`paths to programs and launchers stay plain colored text on ${surface}, while documents link`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...reply([...PROGRAMS, ...DOCUMENTS].join(' and '), 1000), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.label)).toEqual(surface === 'terminal' ? DOCUMENTS : [])
    for (const path of PROGRAMS) expect([path, (await ui.find({ type: 'Text', text: new RegExp(`^${path.replace(/[.]/g, '\\$&')}$`) }))?.props.color]).toEqual([path, t.path])
    await ui.unmount()
  })

  test(`file:// links to programs and launchers draw as text on ${surface}, whatever their case, slash, query, fragment or encoding`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
    const programs = ['file:///tmp/x.exe?y=1', 'file:///tmp/x.EXE#top', 'file:///Applications/Calculator.app/', 'file:///tmp/x%2Ecommand', 'file:///C:/x.exe.', 'file:///C:/x.exe::$DATA', 'file:///tmp/x.exe%00.txt', 'file://server/share/setup.msi']
    const documents = ['file:///tmp/a.html#x.exe', 'file:///tmp/report.md?open=x.exe', 'file:///tmp/x.exe.txt']
    const ui = await $.ui.mount({ ...reply([...programs, ...documents].map(href => `[${href}](${href})`).join(' and '), 1000), surface })
    expect(await hrefs(ui)).toEqual(surface === 'terminal' ? documents : [])
    for (const href of programs) expect([href, await ui.find({ type: 'Text', text: new RegExp(`^${href.replace(/[.?$]/g, '\\$&')}$`) }) !== undefined]).toEqual([href, true])
    await ui.unmount()
  })
}

const TARGETS: [href: string, linkedWithFileLinks: boolean][] = [
  ['https://a.dev', true],
  ['file:///Applications/Calculator.app', false],
  ['FILE:///C:/Windows/System32/cmd.exe', false],
  ['file://evil.example/share/x.exe', false],
  ['file:///tmp/notes.md', true],
  ['smb://host/share', false],
  ['ms-msdt:/id', false],
  ['javascript:alert(1)', false],
]

const everyBlock = (links: string) => `${links}\n\n> ${links}\n\n> [!NOTE]\n> ${links}\n\n- x\n  - ${links}\n\n| a |\n|---|\n| ${links} |\n\nn[^a]\n\n[^a]: ${links}`

const targetLinks = TARGETS.map(([href]) => `[${href}](${href})`).join(' ')

test('only web links in a reply are clickable, in every block, while file links are off', async $ => {
  const ui = await $.ui.mount(reply(everyBlock(targetLinks)))
  const found = await hrefs(ui)
  expect(found.length).toBe(6)
  expect(found.filter(h => h !== 'https://a.dev')).toEqual([])
  await ui.unmount()
})

test('with file links on, only web links and file links labelled with their own address are clickable, as written, in every block', async ($, on) => {
  claudeAt(on, '2.1.289')
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me' })
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply(everyBlock(targetLinks)))
  const allowed = TARGETS.filter(([, linked]) => linked).map(([href]) => href)
  expect(await hrefs(ui)).toEqual(Array.from({ length: 6 }, () => allowed).flat())
  await ui.unmount()
})

test('with file links on, a file link named anything but its own path draws as text with its target, in every block', async ($, on) => {
  claudeAt(on, '2.1.289')
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me' })
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(reply(everyBlock(TARGETS.map(([href], i) => `[t${i}](${href})`).join(' '))))
  expect(await hrefs(ui)).toEqual(Array.from({ length: 6 }, () => 'https://a.dev'))
  expect(await ui.find({ type: 'Text', text: /^t1 \(file:\/\/\/Applications\/Calculator\.app\)$/ })).toBeDefined()
  await ui.unmount()
})

const toolLinks = async ($: Engine, tool: string, input: unknown, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'cc-dazzle', surface, component: 'ToolUse', props: toolCall(tool, input, `t-${tool}-${surface}`) })
  const links = await linkPairs(ui)
  await ui.unmount()
  return links
}

test('file paths in tool rows link to the whole file', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Read', { file_path: '/work/app/src/main.ts' })).toEqual([['src/main.ts', 'file:///work/app/src/main.ts']])
  expect(await toolLinks($, 'Edit', { file_path: '/home/me/notes/todo.md' })).toEqual([['~/notes/todo.md', 'file:///home/me/notes/todo.md']])
  expect(await toolLinks($, 'Grep', { pattern: 'TODO', path: 'src' })).toEqual([['src', 'file:///work/app/src']])
  expect(await toolLinks($, 'Glob', { pattern: '*.ts' })).toEqual([])
  expect(await toolLinks($, 'Bash', { command: 'cat /srv/app/main.ts' })).toEqual([])
  expect(await toolLinks($, 'mcp__github__get_file_contents', { owner: 'o', repo: 'r', path: 'README.md' })).toEqual([])
})

test('a tool group links the path of its last call', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const calls = [toolCall('Read', { file_path: '/work/app/a.ts' }, 'g-1'), toolCall('Read', { file_path: '/work/app/b.ts' }, 'g-2')]
  const ui = await $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
  expect(await linkPairs(ui)).toEqual([['b.ts', 'file:///work/app/b.ts']])
  await ui.unmount()
})

test('Windows paths in tool rows link with forward slashes, and UNC paths name their server', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Grep', { pattern: 'x', path: 'src\\hooks' })).toEqual([['src\\hooks', 'file:///work/app/src/hooks']])
  expect(await toolLinks($, 'Read', { file_path: 'C:\\Users\\me\\x.ts' })).toEqual([['C:\\Users\\me\\x.ts', 'file:///C:/Users/me/x.ts']])
  expect(await toolLinks($, 'Read', { file_path: '\\\\server\\share\\x.txt' })).toEqual([['\\\\server\\share\\x.txt', 'file://server/share/x.txt']])
})

test('a tool path whose link would pass 2048 characters stays text, and the row still draws', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Read', { file_path: `/work/app/${'文档/'.repeat(110)}说明.md` })).toEqual([])
  expect(await toolLinks($, 'Read', { file_path: '/work/app/a b#c?d%e é.ts' })).toEqual([['a b#c?d%e é.ts', 'file:///work/app/a%20b%23c%3Fd%25e%20%C3%A9.ts']])
})

for (const [where, surface, base, env] of [
  ['on desktop', 'desktop', '2.1.289', {}],
  ['on Claude Code 2.1.288', 'terminal', '2.1.288', {}],
  ['in a terminal that draws no hyperlinks', 'terminal', '2.1.289', { FORCE_HYPERLINK: '0' }],
  ['in a session over SSH', 'terminal', '2.1.289', { SSH_TTY: '/dev/pts/3' }],
] as const) {
  test(`tool rows keep plain paths ${where}`, async ($, on) => {
    filesAt(on, base, env)
    const ui = await $.ui.mount({ plugin: 'cc-dazzle', surface, component: 'ToolUse', props: toolCall('Read', { file_path: '/work/app/src/main.ts' }, 'p-1') })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect((await ui.find({ type: 'Text', text: /^src\/main\.ts$/ }))?.props.color).toBe(t.path)
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`tool rows keep programs and launchers as plain colored text on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
    expect(await toolLinks($, 'Read', { file_path: '/work/app/install.sh' }, surface)).toEqual([])
    expect(await toolLinks($, 'Edit', { file_path: 'C:\\Users\\me\\run.PS1' }, surface)).toEqual([])
    expect(await toolLinks($, 'Read', { file_path: '\\\\server\\share\\setup.exe' }, surface)).toEqual([])
    expect(await toolLinks($, 'Grep', { pattern: 'x', path: '/Applications/Calculator.app/' }, surface)).toEqual([])
    expect(await toolLinks($, 'Read', { file_path: '/work/app/src/app.ts' }, surface)).toEqual(surface === 'terminal' ? [['src/app.ts', 'file:///work/app/src/app.ts']] : [])
  })
}

test('shell edit cards link their file headers, and never a program', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksFiles($.ui.mount(reply('[/x](file:///x)'))))) return
  const edit = (path: string) => ({ stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: path, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-one', '+two'] }] }], moreFiles: 0 } })
  const card = (id: string, path: string) => $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: id, tool: 'Bash', output: edit(path), isErrored: false } })
  const ui = await card('be-1', '/work/app/src/app.ts')
  expect(await linkPairs(ui)).toEqual([['src/app.ts', 'file:///work/app/src/app.ts']])
  expect((await ui.find({ type: 'Text', text: /^src\/app\.ts $/ }))?.props.color).toBe(t.path)
  await ui.unmount()
  const script = await card('be-2', '/work/app/build.sh')
  expect(await script.findAll({ type: 'Link' })).toHaveLength(0)
  expect((await script.find({ type: 'Text', text: /^build\.sh $/ }))?.props.color).toBe(t.path)
  await script.unmount()
})

test('a table drawn before the html check lands gains ⧉ html when it lands', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  mock.env(on, {})
  on('fs.stat', async (_, e, next) => {
    if (!e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')) return next(e)
    await held
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  const ui = await $.ui.mount(reply('| Name | Value |\n|--|--:|\n| api | 2 |'))
  const labels = async () => (await ui.findAll({ type: 'Button' })).map(button => button.props.label)
  const started = $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await labels()).toEqual(['⧉ md', '⧉ art'])
  release()
  await started
  expect(await labels()).toEqual(['⧉ md', '⧉ art', '⧉ html'])
  await ui.unmount()
})
