import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { hrefAt, layout, widthOf } from './stretch/layout'
import { hideLongForms, newStreamState, paragraphsOf, parse, stretches } from './stretch/parse'

// Fixes and features ported from upstream cc-stretch 0.5.2 to 0.5.4, each with its upstream test.

const ON = { options: { stretch: true } }
const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'
const GUTTER = 2

const mountReply = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId: 'reply-1', viewport: FULLSCREEN })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
const rowsOf = async (ui: Mounted, key = FIRST): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf).map(row => row.slice(GUTTER))
}
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).join('\n')

/** Clicks `phrase` where the Client drew it, a modifier held or not, as a mouse does: down, then up. */
const clickOn = async (ui: Mounted, phrase: string, modifier: { ctrl?: true; alt?: true } = {}) => {
  const rows = await rowsOf(ui)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const x = GUTTER + widthOf(rows[y]!.slice(0, rows[y]!.indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', ...modifier, in: FIRST })
  await ui.pointer({ type: 'up', x, y, button: 'left', ...modifier, in: FIRST })
}

/** Answers each command the plugin runs, and keeps each but `uname -s`, which names `system`; with none, `uname` does not start. */
const commands = (on: On, { system = 'Darwin', exitCode = 0 }: { system?: string | null; exitCode?: number } = {}) => {
  const ran: string[][] = []
  const answer = (stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e, next) => {
    if (e.argv[0] === 'uname') return system === null ? next(e) : answer(`${system}\n`)
    ran.push([...e.argv])
    return answer('')
  })
  return ran
}
const toasts = (on: On) => {
  const said: string[] = []
  on('ui.toast', (_, e) => {
    said.push(e.text)
    return { value: undefined }
  })
  return said
}

describe('a long form ending in a code block', () => {
  const keys = (text: string) => stretches(parse(text)).map(s => [s.key, s.isClosed])

  test('closes at a closing fence followed by its braces, and what follows still parses', async () => {
    const text = ['{{Count first.|Count first.', '', '```bash', 'git push --force-with-lease', '```}}', '', '## Main risks', '', '{{Risks.|Risks, long.}}', '', '**Bottom line:** done.'].join('\n')
    const parts = parse(text)
    expect(keys(text)).toEqual([['Count first.', true], ['Risks.', true]])
    expect(parts[0]).toMatchObject({ long: ['Count first.\n\n```bash\ngit push --force-with-lease\n```'] })
    expect(parts.at(-1)).toBe('\n\n**Bottom line:** done.')
  })

  test('closes nested stretches at a fence followed by their braces, spaces allowed, with ~~~ fences too', async () => {
    expect(keys('{{a|{{b|x\n```\ncode\n```}}}}\nafter {{c|d}}')).toEqual([['a', true], ['a › b', true], ['c', true]])
    expect(keys('{{a|{{b|x\n~~~~\ncode\n~~~~ }} }}\nafter {{c|d}}')).toEqual([['a', true], ['a › b', true], ['c', true]])
  })

  test('does not close the block for a fence line with other text after it, or one outside every stretch', async () => {
    const [held] = parse('{{a|x\n```\n``` }} more\n```\n}} after')
    expect(held).toMatchObject({ isClosed: true, long: ['x\n```\n``` }} more\n```\n'] })
    expect(parse('```\ncode\n```}}\n{{a|b}}')).toEqual(['```\ncode\n```}}\n{{a|b}}'])
  })

  test('a closing fence that carries the braces of the stretches around it closes them while streaming, so what follows shows short', async () => {
    const lines = ['{{Count first.|Count first.', '```bash', 'git push', '```}}', '', '## Risks', '{{a|{{b|x', '~~~', 'code', '~~~ }}}}', '{{Risks.|long}}']
    expect(hideLongForms(lines.join('\n'), newStreamState())).toBe(['Count first.', '', '## Risks', 'a', 'Risks.'].join('\n'))
  })

  test('the stretch ends there, so the blank line after it cuts a paragraph', async () => {
    expect(paragraphsOf(['{{a|long', '```', 'code', '```}}', '', 'After {{b|c}}.'].join('\n'))).toEqual([
      { text: '{{a|long\n```\ncode\n```}}', hasStretch: true },
      { text: 'After {{b|c}}.', hasStretch: true },
    ])
  })

  test('a reply whose stretch closes on a code block\'s closing fence draws every section after it', ON, async $ => {
    const ui = await mountReply($, ['{{Count first.|Count first.', '', '```bash', 'git push', '```}}', '', 'After {{risks|the risks}}.'].join('\n'))
    expect(await textIn(ui, 'paragraph-0')).toBe('Count first.')
    expect(await textIn(ui, 'paragraph-1')).toBe('After risks.')
    await ui.unmount()
  })
})

describe('hyperlinks', () => {
  const DOCS = 'Docs at https://x.invalid/docs and {{a stretch|a long stretch}}.'

  test('finds the hyperlink drawn at a cell, and none beside it', async () => {
    const rows = layout('See [the docs](https://x.invalid/d) or https://x.invalid/u now', 80, { httpLinks: true })
    expect([hrefAt(rows, 4, 0), hrefAt(rows, 11, 0), hrefAt(rows, 16, 0), hrefAt(rows, 34, 0)]).toEqual(['https://x.invalid/d', 'https://x.invalid/d', 'https://x.invalid/u', 'https://x.invalid/u'])
    expect([hrefAt(rows, 3, 0), hrefAt(rows, 12, 0), hrefAt(rows, 35, 0), hrefAt(rows, 0, 1)]).toEqual([undefined, undefined, undefined, undefined])
  })

  test("a ctrl- or alt-click on a hyperlink opens it with the machine's own opener", ON, async ($, on) => {
    on('session.version', () => ({ value: { version: '2.1.306', base: '2.1.306' } }))
    const ran = commands(on)
    const ui = await mountReply($, DOCS)
    await clickOn(ui, 'x.invalid', { ctrl: true })
    await clickOn(ui, 'docs and', { alt: true })
    await ui.advance(100)
    expect(ran).toEqual([['open', 'https://x.invalid/docs'], ['open', 'https://x.invalid/docs']])
    await ui.unmount()
  })

  test('a plain click on a hyperlink opens nothing, and a modified click on a short form opens the stretch', ON, async ($, on) => {
    on('session.version', () => ({ value: { version: '2.1.306', base: '2.1.306' } }))
    const ran = commands(on)
    const ui = await mountReply($, DOCS)
    await clickOn(ui, 'x.invalid')
    await clickOn(ui, 'a stretch', { ctrl: true })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a long stretch «.')
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test("a ctrl-click on a file: link opens nothing: the terminal's own click is left to open it", ON, async ($, on) => {
    on('session.version', () => ({ value: { version: '2.1.306', base: '2.1.306' } }))
    const ran = commands(on)
    const ui = await mountReply($, 'See [the log](file:///tmp/x.log) and {{a stretch|a long stretch}}.')
    await clickOn(ui, 'the log', { ctrl: true })
    await ui.advance(100)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('a hyperlink that could not be opened is said so', ON, async ($, on) => {
    on('session.version', () => ({ value: { version: '2.1.306', base: '2.1.306' } }))
    commands(on, { exitCode: 1 })
    const said = toasts(on)
    const ui = await mountReply($, DOCS)
    await clickOn(ui, 'x.invalid', { ctrl: true })
    await ui.advance(100)
    expect(said).toEqual(['cc-dazzle: could not open https://x.invalid/docs'])
    await ui.unmount()
  })

  for (const [system, opener] of [
    ['Linux', ['sh', '-c', 'xdg-open "$1" </dev/null >/dev/null 2>&1', 'sh']],
    ['MINGW64_NT-10.0-26100', ['rundll32', 'url.dll,FileProtocolHandler']],
    [null, ['rundll32', 'url.dll,FileProtocolHandler']],
  ] as const) {
    test(`with uname naming ${system ?? 'nothing'}, a hyperlink opens with ${opener.at(-1) === 'sh' ? 'xdg-open' : opener[0]}`, ON, async ($, on) => {
      on('session.version', () => ({ value: { version: '2.1.306', base: '2.1.306' } }))
      const ran = commands(on, { system })
      const ui = await mountReply($, 'See https://x.invalid/a?b=1&c=2 and {{a stretch|a long stretch}}.')
      await clickOn(ui, 'x.invalid', { ctrl: true })
      await ui.advance(100)
      expect(ran).toEqual([[...opener, 'https://x.invalid/a?b=1&c=2']])
      await ui.unmount()
    })
  }
})
