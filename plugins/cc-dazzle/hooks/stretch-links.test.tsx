import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { THEME as t } from './theme'
import { layout } from './stretch/layout'

// Paths and file:// links in a paragraph that holds a stretch follow the rules of cc-dazzle's other
// replies (prismantis #238, #240): the same tests as file-links.test.tsx, with stretchtext on.

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'
const ON = { options: { stretch: true } }

const mountReply = ($: Engine, text: string, surface: 'terminal' | 'desktop' = 'terminal', columns = 100) =>
  $.ui.mount({ plugin: 'cc-dazzle', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId: 'reply-1', viewport: { ...FULLSCREEN, columns } })

const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

const filesAt = (on: On, base: string | undefined, env: Record<string, string> = {}) => {
  if (base) claudeAt(on, base)
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me', ...env })
  on('session.root', () => ({ value: '/work/app' }))
}

// Claude Code 2.1.287 and 2.1.288 refuse a file: href and throw out the whole render.
const linksFiles = ($: Engine): Promise<boolean> =>
  $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'AssistantMessage', props: { text: '[/x](file:///x)', isFirstOfReply: true }, viewport: FULLSCREEN }).then(async ui => (await ui.unmount(), true), () => false)

type Found = { findAll: (query: { type: 'Link' | 'Text'; in?: string }) => Promise<{ text?: string; props: Record<string, unknown> }[]> }
const hrefs = async (ui: Found) => (await ui.findAll({ type: 'Link', in: FIRST })).map(l => String(l.props.href))
const colorOf = async (ui: Found, text: string) => (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === text)?.props.color

const STRETCH = ' and {{a stretch|a longer stretch}}.'
const PATHS = `Open /srv/app/main.ts, ~/notes/todo.md or ./docs/guide.md${STRETCH}`

const PROGRAMS = ['/Applications/Calculator.app', '/tmp/run/x.command', '/tmp/run/x.exe', '/tmp/run/x.sh', '/tmp/run/Setup.Command', '/tmp/run/x.pdf.exe', '/Applications/Calculator.app/Contents/MacOS/Calculator']
const DOCUMENTS = ['/tmp/doc/a.ts', '/tmp/doc/a.md', '/tmp/doc/a.exe.txt', '/tmp/chart.js/README.md']

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

describe('file links in a paragraph that holds a stretch', () => {
  test('paths link to their files and keep the path color', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const ui = await mountReply($, PATHS)
    expect(await hrefs(ui)).toEqual(['/srv/app/main.ts', '/home/me/notes/todo.md', '/work/app/docs/guide.md'].map(path => `file://${path}`))
    expect(await colorOf(ui, '/srv/app/main.ts')).toBe(t.path)
    await ui.unmount()
  })

  for (const [where, base, env] of [
    ['on Claude Code 2.1.288, which refuses file hyperlinks', '2.1.288', {}],
    ['when the Claude Code version is unknown', undefined, {}],
    ['in a terminal that draws no hyperlinks', '2.1.289', { FORCE_HYPERLINK: '0' }],
    ['in a session over SSH', '2.1.289', { SSH_CONNECTION: '10.0.0.2 52814 10.0.0.9 22' }],
  ] as const) {
    test(`paths stay plain colored text ${where}`, ON, async ($, on) => {
      filesAt(on, base, env)
      const ui = await mountReply($, PATHS)
      expect(await hrefs(ui)).toEqual([])
      expect(await colorOf(ui, '/srv/app/main.ts')).toBe(t.path)
      await ui.unmount()
    })
  }

  test('a path inside a short form stays a press that opens the stretch, never a file link', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const ui = await mountReply($, 'See {{/srv/app/main.ts|/srv/app/main.ts, the entry point}} and ~/notes/todo.md.')
    expect(await hrefs(ui)).toEqual(['file:///home/me/notes/todo.md'])
    await ui.unmount()
  })

  test('paths to programs and launchers stay plain colored text, while documents link', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const ui = await mountReply($, `${[...PROGRAMS, ...DOCUMENTS].join(' and ')}${STRETCH}`, 'terminal', 1000)
    expect(await hrefs(ui)).toEqual(DOCUMENTS.map(path => `file://${path}`))
    for (const path of PROGRAMS) expect([path, await colorOf(ui, path)]).toEqual([path, t.path])
    await ui.unmount()
  })

  test('with file links on, only web links and file links labelled with their own address are clickable', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const ui = await mountReply($, `${TARGETS.map(([href]) => `[${href}](${href})`).join(' ')}${STRETCH}`, 'terminal', 1000)
    expect(await hrefs(ui)).toEqual(TARGETS.filter(([, linked]) => linked).map(([href]) => href))
    await ui.unmount()
  })

  test('a file link named anything but its own path draws as its label with its target beside it', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const ui = await mountReply($, `[the docs](file:///tmp/setup.command) and [notes](file:///tmp/notes.md) and [/tmp/notes.md](file:///tmp/notes.md)${STRETCH}`)
    expect(await hrefs(ui)).toEqual(['file:///tmp/notes.md'])
    const rows = (await ui.findAll({ type: 'Text', in: FIRST })).map(piece => piece.text).join('')
    expect(rows).toContain('the docs (file:///tmp/setup.command)')
    expect(rows).toContain('notes (file:///tmp/notes.md)')
    await ui.unmount()
  })

  test('with file links off, only web links are clickable', ON, async $ => {
    const ui = await mountReply($, `${TARGETS.map(([href]) => `[${href}](${href})`).join(' ')} and ~/notes.md${STRETCH}`, 'terminal', 1000)
    expect(await hrefs(ui)).toEqual(['https://a.dev'])
    await ui.unmount()
  })

  test('a path or link longer than Claude Code draws stays text', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksFiles($))) return
    const long = `/${'a'.repeat(60)}`.repeat(35)
    const web = `https://example.com/${'b'.repeat(2050)}`
    const ui = await mountReply($, `see ${long} here, ${web} and ~/short.md${STRETCH}`)
    expect(await hrefs(ui)).toEqual(['file:///home/me/short.md'])
    await ui.unmount()
  })

  test('on desktop, a file link in a reply with stretches draws as its label and target, and code keeps its text', ON, async ($, on) => {
    filesAt(on, '2.1.289')
    const ui = await mountReply($, `[/tmp/notes.md](file:///tmp/notes.md) and \`[a](file:///b)\`${STRETCH}`, 'desktop')
    const text = String((await ui.find({ type: 'Markdown' }))?.props.text)
    expect(text).toContain('/tmp/notes.md (file:///tmp/notes.md)')
    expect(text).toContain('`[a](file:///b)`')
    await ui.unmount()
  })

  test('layout links a path only with file and path links on, and never in a pressable phrase', () => {
    const reach = { httpLinks: true, fileLinks: true, pathLinks: true, home: '/home/me', cwd: '/work/app' }
    const linked = (text: string, given = {}) => (layout(text, 200, given)[0] ?? []).filter(run => run.href).map(run => [run.text, run.href])
    expect(linked('Open ~/a.md now', reach)).toEqual([['~/a.md', 'file:///home/me/a.md']])
    expect(linked('Open ~/a.md now', { ...reach, pathLinks: false })).toEqual([])
    expect(linked('Open ~/a.md now')).toEqual([])
    expect(linked('Open \ufdd0open\ufdd1k\ufdd1~/a.md\ufdd2 now', reach)).toEqual([])
  })
})
