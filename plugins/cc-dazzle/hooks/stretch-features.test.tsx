import type { On, PromptChangeInput, PromptEditInput, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { THEME as t } from './theme'
import { layout, leadInOf, link, linkAt, namesOf, widthOf, withLeadIns } from './stretch/layout'
import { parse } from './stretch/parse'

// Features ported from upstream cc-stretch 0.4.0 to 0.5.2: links, selecting text, keyboard letters
// and lead-in words in a paragraph that holds a stretch, each with its upstream test. Pointer cells here are
// the text's; `at` adds the paragraph's two-cell gutter.

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key:',
  '```yaml',
  'key: {{hash}}',
  '```',
  '}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const NARROW = { columns: 32, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'
const GUTTER = 2
const ON = { options: { stretch: true } }

const mountReply = ($: Engine, viewport: typeof FULLSCREEN, text = REPLY, requestId = 'reply-1') =>
  $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId, viewport })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
/** The rows a paragraph's Client draws, as plain text, without the gutter. */
const rowsOf = async (ui: Mounted, key = FIRST): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf).map(row => row.slice(GUTTER))
}
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).join('\n')
const at = ({ x, y }: { x: number; y: number }) => ({ x: x + GUTTER, y })

const pressOn = async (ui: Mounted, phrase: string, { key = FIRST, last = false } = {}) => {
  const rows = await rowsOf(ui, key)
  const y = last ? rows.findLastIndex(row => row.includes(phrase)) : rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  const x = widthOf(row.slice(0, last ? row.lastIndexOf(phrase) : row.indexOf(phrase)))
  await ui.pointer({ type: 'down', ...at({ x, y }), button: 'left', in: key })
  await ui.pointer({ type: 'up', ...at({ x, y }), button: 'left', in: key })
}
const drag = async (ui: Mounted, from: { x: number; y: number }, to: { x: number; y: number }, key = FIRST) => {
  await ui.pointer({ type: 'down', ...at(from), button: 'left', in: key })
  await ui.pointer({ type: 'move', ...at(to), button: 'left', in: key })
  await ui.pointer({ type: 'up', ...at(to), button: 'left', in: key })
}
const doubleClick = async (ui: Mounted, cell: { x: number; y: number }, key = FIRST) => {
  for (let i = 0; i < 2; i += 1) {
    await ui.pointer({ type: 'down', ...at(cell), button: 'left', in: key })
    await ui.pointer({ type: 'up', ...at(cell), button: 'left', in: key })
  }
}
const clipboard = (on: On) => {
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  return copies
}
const inverse = async (ui: Mounted) => (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
const firstRowOf = async (ui: Mounted) => (await rowsOf(ui))[0] ?? ''

describe('links', () => {
  test('a bare URL is a hyperlink, without the punctuation that ends its sentence or a bracket it did not open', ON, async () => {
    const hrefs = (text: string) => (layout(text, 200)[0] ?? []).filter(run => run.href).map(run => [run.text, run.href])
    expect(hrefs('See https://x.invalid/a/b?c=1. Then go.')).toEqual([['https://x.invalid/a/b?c=1', 'https://x.invalid/a/b?c=1']])
    expect(hrefs('(see https://x.invalid/wiki/A_(b))')).toEqual([['https://x.invalid/wiki/A_(b)', 'https://x.invalid/wiki/A_(b)']])
    expect(hrefs('no https:// host, nor xhttps://x.invalid')).toEqual([])
    expect(hrefs('`https://x.invalid/code`')).toEqual([])
  })

  test('a markdown link to a target other than http:, https: or file: keeps it beside its label', ON, async () => {
    const runs = layout('Open [the file](ci/cache.ts) here', 80)[0] ?? []
    expect(runs.map(run => run.text).join('')).toBe('Open the file (ci/cache.ts) here')
    expect(runs.some(run => run.href)).toBe(false)
  })

  test('a URL in a paragraph that holds a stretch is drawn as a hyperlink, in the link color', ON, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'Docs at https://x.invalid/docs and {{a stretch|a long stretch}}.')
    const link = await ui.find({ type: 'Link', in: FIRST })
    expect(link?.props).toMatchObject({ href: 'https://x.invalid/docs' })
    expect((await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === 'https://x.invalid/docs')?.props.color).toBe(t.link)
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a stretch.')
    await ui.unmount()
  })
})

describe('selecting text', () => {
  test('a drag across a paragraph that holds a stretch copies the text it crossed, drawn inverse', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 4, y: 0 }, { x: 5, y: 1 })
    expect(copies).toEqual(['build fails on a stale cache.\nBraces'])
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'build fails ')?.props).toMatchObject({ inverse: true })
    expect(pieces.find(piece => piece.text === 'The ')?.props).not.toHaveProperty('inverse')
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a drag backwards selects from where it came up to where it went down', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 14, y: 0 }, { x: 4, y: 0 })
    expect(copies).toEqual(['build fails'])
    await ui.unmount()
  })

  test('a line wrapped over several rows is copied as one line', ON, async ($, on) => {
    const copies = clipboard(on)
    const text = '- A list item {{long enough|long enough}} that it wraps onto a second row here.'
    const ui = await mountReply($, NARROW, text)
    const rows = await rowsOf(ui)
    expect(rows.length).toBeGreaterThan(1)
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: rows.length - 1 })
    expect(copies).toEqual(['• A list item long enough that it wraps onto a second row here.'])
    await ui.unmount()
  })

  test('a click copies nothing, takes the highlight down, and on a short form still opens it', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 4, y: 0 }, { x: 9, y: 0 })
    await drag(ui, { x: 1, y: 1 }, { x: 1, y: 1 })
    expect(copies).toEqual(['build'])
    expect(await inverse(ui)).toEqual([])
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    expect(copies).toEqual(['build'])
    await ui.unmount()
  })

  test('a double-click copies the word under it, drawn inverse', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await doubleClick(ui, { x: 6, y: 0 })
    expect(copies).toEqual(['build'])
    expect(await inverse(ui)).toEqual(['build'])
    expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a double-click takes an id, a path, a dotfile or a flag whole, without the punctuation after it', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'See #12806, NMC-2628 and hooks/reply.tsx. Pass --plugin-dir to ~/.claude and .gitignore. Then {{a stretch|a long stretch}}.')
    const row = await firstRowOf(ui)
    const words = ['#12806', 'NMC-2628', 'hooks/reply.tsx', '--plugin-dir', '~/.claude', '.gitignore']
    for (const word of words) await doubleClick(ui, { x: row.indexOf(word) + 2, y: 0 })
    expect(copies).toEqual(words)
    await ui.unmount()
  })

  test('a double-click takes a URL whole, and a word of a link label alone', ON, async ($, on) => {
    const copies = clipboard(on)
    const text = 'See https://github.com/pro-vi/cc-stretch/pull/16. Then read [the docs](https://x.invalid/docs) and {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    await doubleClick(ui, { x: row.indexOf('github'), y: 0 })
    await doubleClick(ui, { x: row.indexOf('docs'), y: 0 })
    expect(copies).toEqual(['https://github.com/pro-vi/cc-stretch/pull/16', 'docs'])
    await ui.unmount()
  })

  test('a double-click takes a URL a line wrapped inside whole, from either of its rows', ON, async ($, on) => {
    const copies = clipboard(on)
    const url = 'https://github.com/pro-vi/cc-stretch/pull/16'
    const ui = await mountReply($, NARROW, `See ${url} and {{a stretch|a long stretch}}.`)
    const rows = await rowsOf(ui)
    const top = rows.findIndex(row => row.includes('https'))
    const bottom = rows.findIndex(row => row.includes('/16'))
    expect(bottom).toBeGreaterThan(top)
    await doubleClick(ui, { x: (rows[top] ?? '').indexOf('https') + 2, y: top })
    await doubleClick(ui, { x: (rows[bottom] ?? '').indexOf('/16'), y: bottom })
    expect(copies).toEqual([url, url])
    await ui.unmount()
  })

  test('a double-click on a space picks nothing, and two clicks more than a cell apart are two clicks', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await doubleClick(ui, { x: 3, y: 0 })
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await drag(ui, { x: 7, y: 0 }, { x: 7, y: 0 })
    expect(copies).toEqual([])
    expect(await inverse(ui)).toEqual([])
    await ui.unmount()
  })

  test('a press that opens a stretch between two clicks keeps them from making a double-click', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await pressOn(ui, 'on a stale cache')
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    expect(copies).toEqual([])
    await ui.unmount()
  })

  test('a drag released off the paragraph, past any edge, still copies and leaves no highlight behind', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const off of [{ x: 4, y: 30 }, { x: 4, y: -2 }, { x: -3, y: 1 }, { x: 150, y: 1 }]) {
      await drag(ui, { x: 4, y: 0 }, off)
      expect(await inverse(ui)).toEqual([])
    }
    expect(copies).toEqual([
      'build fails on a stale cache.\nBraces in code stay: {{a|b}}.',
      'The b',
      'build fails on a stale cache.\nB',
      'build fails on a stale cache.\nBraces in code stay: {{a|b}}.',
    ])
    await ui.unmount()
  })

  test('a drag that starts on a short form or on lead-in words selects and opens nothing', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'It {{merged|merged 3 days ago}} and shipped 2 days ago{{.|, after review.}}')
    await drag(ui, { x: 3, y: 0 }, { x: 8, y: 0 })
    await drag(ui, { x: 14, y: 0 }, { x: 22, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['merged', 'shipped 2'])
    expect(await textIn(ui)).toBe('It merged and shipped 2 days ago.')
    await ui.unmount()
  })

  test('a double-click on lead-in words copies the word and opens nothing', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'Edit hooks/reply.tsx first{{.|, then rerun the tests.}}')
    await doubleClick(ui, { x: 8, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['hooks/reply.tsx'])
    expect(await textIn(ui)).toBe('Edit hooks/reply.tsx first.')
    await ui.unmount()
  })
})

describe('lead-in words', () => {
  test('finds the words a link with none of its own is pressed on, back to the start of their sentence', ON, async () => {
    const leadIn = (text: string) => {
      const found = leadInOf(text)
      return found && text.slice(found.from, found.to)
    }
    expect(leadIn('It merged 3 days ago')).toBe('It merged 3 days ago')
    expect(leadIn('- **#212**: merged 3 days ago')).toBe('**#212**: merged 3 days ago')
    expect(leadIn('`npm test` exited 0')).toBe('`npm test` exited 0')
    expect(leadIn('3. **Stop the workers**')).toBe('**Stop the workers**')
    expect(leadIn('It failed. A test ')).toBe('A test')
    // A comma, a semicolon, a colon or a dash inside the sentence does not end the words.
    expect(leadIn('Retries wait 200, 400 and 800 ms')).toBe('Retries wait 200, 400 and 800 ms')
    expect(leadIn('It built; the tests: all passed')).toBe('It built; the tests: all passed')
    expect(leadIn('one, two — three four')).toBe('one, two — three four')
    expect(leadIn('测试通过，已合并')).toBe('测试通过，已合并')
    expect(leadIn('测试通过。已合并')).toBe('已合并')
    expect(leadIn('他说：“测试都通过了。”然后我们合并了')).toBe('然后我们合并了')
    expect(leadIn('测试通过了！）然后合并了')).toBe('然后合并了')
    // A bold phrase is taken whole, unless markup or a sentence's end is inside it.
    expect(leadIn('The **cache key** is stale')).toBe('The **cache key** is stale')
    expect(leadIn('See **[docs](https://x.y)** now')).toBe('now')
    expect(leadIn('So **it failed. Then it** passed')).toBe('passed')
    expect(leadIn('✅ Tests pass')).toBe('Tests pass')
    expect(leadIn('See [docs](https://x.y)')).toBeUndefined()
    expect(leadIn('Use `**` a b**')).toBeUndefined()
    expect(leadIn('- ')).toBeUndefined()
  })

  test('marks the lead-in words of a link with none of its own to open it, and leaves them where a mark would add a place to break', ON, async () => {
    const marked = (text: string, isParagraphEnd = true) =>
      withLeadIns(parse(text), () => true, isParagraphEnd)
        .filter(part => typeof part === 'string')
        .join('|')
    expect(marked('It merged{{.|, and passed.}}')).toBe(link('leadIn', '.', 'It merged'))
    expect(marked('Before {{|hidden}} after')).toBe(`${link('leadIn', '', 'Before')} | after`)
    // An empty short form glued to a period: the period is marked too, so the words and it stay one piece.
    expect(marked('exited 0{{|, so no errors}}. Tests')).toBe(`${link('leadIn', '', 'exited 0')}|${link('leadIn', '', '.')} Tests`)
    expect(marked('exited 0{{|, so no errors}}word')).toBe('exited 0|word')
    expect(marked('exited 0{{|, so no errors}}', false)).toBe('exited 0')
    expect(marked('- {{.|item}}')).toBe('- ')
    expect(marked('-\td{{.|, and more}}')).toBe('-\td')
    // A code span closed on this line but opened on the line before reads as unclosed to `layout`.
    expect(marked('x ``a\nb`` c{{.|d}}')).toBe('x ``a\nb`` c')
    // A sentence that starts in another stretch lends only the words after it, apart from it by a space,
    // so the two links never draw as one; words glued to that stretch's text lend nothing.
    expect(marked('Run {{the tests|the unit tests}} then ship{{.|, after review.}}')).toBe(`Run | ${link('leadIn', '.', 'then ship')}`)
    expect(marked('Run {{the tests|the unit tests}}-shipped{{.|, after review.}}')).toBe('Run |-shipped')
    // Punctuation glued to an empty short form that runs on into the next stretch is joined to what that stretch draws.
    expect(marked('So the suite passed{{|, all 84}}.{{|, twice}}” Then it shipped.')).toBe('So the suite passed|.|” Then it shipped.')
  })

  test('names each stretch drawn as a link by its short form, and a wordless one with its lead-in words as drawn', ON, async () => {
    const names = namesOf(parse('It shipped{{.|, and passed.}} It is approved{{.|, but blocked.}} The check exited 0{{|, so no errors}}. {{Done.|Done in `ci.ts`.}}'))
    expect([...names.values()]).toEqual(['It shipped.', 'It is approved.', 'The check exited 0.', 'Done.'])
    expect([...namesOf(parse('It shipped {{.|, and passed.}}')).values()]).toEqual(['It shipped .'])
  })

  test('draws the lead-in words of a link with none of its own as a run of their own, so rows break where they would without them', ON, async () => {
    const text = (leadIn: string) => `so then it shipped 3 days ${leadIn}${link('open', 'k', '.')} Then more words follow.`
    for (const width of [10, 13, 17, 21]) {
      const plain = layout(text('ago'), width)
      const pressed = layout(text(link('leadIn', 'k', 'ago')), width)
      expect(pressed.map(row => row.map(run => run.text).join(''))).toEqual(plain.map(row => row.map(run => run.text).join('')))
    }
    const rows = layout(`It ${link('leadIn', 'k', 'landed')}${link('open', 'k', '.')}`, 30)
    expect(linkAt(rows, 4, 0)).toEqual({ action: 'open', key: 'k', isLeadIn: true })
    expect(linkAt(rows, 9, 0)).toEqual({ action: 'open', key: 'k' })
  })

  test('never lets a code span or a markdown link run over a pressable phrase, as half of one drawn by a growing long form would', ON, async () => {
    const shown = (text: string) => layout(text, 80).map(row => row.map(run => run.text).join('')).join('\n')
    expect(shown(`Run \`npm then ${link('open', 'k', 'ship `main`')}.`)).toBe('Run `npm then ship main.')
    expect(shown(`See [the ${link('leadIn', 'k', 'docs')}${link('open', 'k', '.')} [x](https://x.y)`)).toBe('See [the docs. x')
  })
})

describe('keyboard', () => {
  const down = (ui: Mounted) => ui.press({ key: 'open-letters' })
  const up = (ui: Mounted) => ui.press({ key: 'close-letters' })
  // The test engine raises prompt.edit and prompt.change as the prompt box does, but has no editor
  // beneath them: each test stands one in, and the session's messages, in the order the replies were written.
  const engine = (on: On, replies = [REPLY]) => {
    on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.change', ($, e) => ({ text: e.text }))
    on('session.messages', () => ({ value: replies.map(text => ({ role: 'assistant', text, toolUses: [] }) satisfies SessionMessage) }))
  }
  const raise = async ($: Engine, name: 'edit' | 'change', input: PromptEditInput | PromptChangeInput): Promise<unknown> => {
    const hook: unknown = Reflect.get($.prompt, name)
    if (typeof hook !== 'function') throw new Error(`the test engine has no $.prompt.${name}`)
    return hook.call($.prompt, input)
  }
  const type = async ($: Engine, key: string) => {
    const box = await raise($, 'edit', { origin: { kind: 'composer' }, key: { key }, text: '', cursor: 0, start: 0, end: 0, inputText: key })
    if (typeof box !== 'object' || box === null || !('text' in box) || typeof box.text !== 'string') throw new Error('prompt.edit left no text')
    return box.text
  }
  const letters = async (ui: Mounted, key = FIRST) =>
    (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.backgroundColor === t.error).map(piece => piece.text)
  const both = async (ui: Mounted) => [...(await letters(ui)), ...(await letters(ui, 'paragraph-1'))]

  test('the open-letters Button draws a letter over each closed stretch, and typing it opens the stretch in place', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    expect(await textIn(ui)).toContain('The build fails an a stale cache.')
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only')
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    expect(await textIn(ui)).toContain('a set in one file')
    await ui.unmount()
  })

  test('the rest of a lettered short form sits on mauve and stays underlined', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    const lettered = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => [t.error, t.accent].includes(String(piece.props.backgroundColor)))
    expect(lettered.map(piece => piece.text)).toEqual(['a', 'n a stale cache'])
    for (const piece of lettered) expect(piece.props).toMatchObject({ underline: true })
    await ui.unmount()
  })

  test('the close-letters Button draws a letter over the « of each open stretch, and typing it closes the stretch', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await up(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    expect(await textIn(ui)).not.toContain('«')
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('The build fails on a stale cache.')
    await ui.unmount()
  })

  test('another key, or a letter no stretch has, puts the letters away and is typed as usual', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const key of ['1', 'z', 'A']) {
      await down(ui)
      expect(await type($, key)).toBe(key)
      expect(await both(ui)).toEqual([])
    }
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('each Button names the keybinding action whose chords press it, and the open one is the reply dot', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    expect((await ui.find({ key: 'open-letters' }))?.props.action).toBe('app:diffFileListDown')
    expect((await ui.find({ key: 'close-letters' }))?.props.action).toBe('app:diffFileListUp')
    expect((await ui.find({ key: 'open-letters' }))?.text).toBe('●')
    await ui.unmount()
  })

  test('the same chord again puts the letters away, and the other one swaps them', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await down(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    await ui.unmount()
  })

  test('a recalled prompt puts the letters away', ON, async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await raise($, 'change', { text: 'an earlier prompt', cursor: 17, origin: { kind: 'history' } })
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('past the 26th stretch none takes a letter, one keyed constructor among them', ON, async ($, on) => {
    const text = `${Array.from({ length: 26 }, (_, i) => `{{w${i}|more ${i}}}`).join(' ')} {{constructor|more}}`
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toHaveLength(26)
    expect(await textIn(ui)).toContain('constructor')
    await ui.unmount()
  })

  test('the three newest replies on screen holding a stretch take letters, newest first, whatever order they were drawn in', ON, async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2), reply(3), reply(4), 'Reply 5 has no stretch.'])
    const mounted = new Map<number, Mounted>()
    for (const n of [4, 2, 1, 3]) mounted.set(n, await mountReply($, FULLSCREEN, reply(n), `reply-${n}`))
    const of = (n: number) => mounted.get(n)!
    await down(of(4))
    expect(await letters(of(4))).toEqual(['a'])
    expect(await letters(of(3))).toEqual(['s'])
    expect(await letters(of(2))).toEqual(['d'])
    expect(await letters(of(1))).toEqual([])
    for (const ui of mounted.values()) await ui.unmount()
  })

  test('a reply scrolled off screen takes no letters', ON, async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2)])
    const older = await mountReply($, FULLSCREEN, reply(1), 'reply-1')
    const newer = await mountReply($, FULLSCREEN, reply(2), 'reply-2')
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: null })
    await down(older)
    expect(await letters(newer)).toEqual([])
    expect(await letters(older)).toEqual(['a'])
    await type($, '1')
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } })
    await down(older)
    expect(await letters(newer)).toEqual(['a'])
    expect(await letters(older)).toEqual(['s'])
    await older.unmount()
    await newer.unmount()
  })

  test('a stretch with an empty short form opens from the letter on the words before it', ON, async ($, on) => {
    const text = 'Before {{|hidden words}} after {{shown|more}}.'
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toEqual(['a', 's'])
    await type($, 'a')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('Before hidden words « after shown.')
    await ui.unmount()
  })

  test('a stretch with an empty short form and no words before it draws no link and opens from no letter', ON, async ($, on) => {
    const text = '{{|hidden words}} after {{shown|more}}.'
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toEqual(['s'])
    expect(await type($, 'a')).toBe('')
    await ui.unmount()
  })
})

describe('lead-in words on screen', () => {
  test('a link with no words of its own is pressed on the words before it, which stay where they are', ON, async $ => {
    const text = '- **#212 Move sessions to Redis**: merged 3 days ago{{.|, and the e2e run passed.}}'
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui)).toBe('• #212 Move sessions to Redis: merged 3 days ago.')
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.filter(piece => piece.props.bold === true).every(piece => piece.props.underline === true)).toBe(true)
    expect(pieces.find(piece => piece.text.startsWith(': merged'))?.props).toMatchObject({ underline: true })
    expect(pieces.find(piece => piece.text === '• ')?.props).not.toHaveProperty('underline')
    await pressOn(ui, 'merged')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('• #212 Move sessions to Redis: merged 3 days ago, and the e2e run passed. «')
    await ui.unmount()
  })

  test('an empty short form joined to the text after it opens from the words before it and that text', ON, async $ => {
    const text = 'The type check exited 0{{|, so it found no errors}}. Tests passed too.'
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui)).toBe('The type check exited 0. Tests passed too.')
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.filter(piece => piece.props.underline === true).map(piece => piece.text).join('')).toBe('The type check exited 0.')
    await pressOn(ui, 'exited')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('The type check exited 0, so it found no errors «. Tests passed too.')
    await ui.unmount()
  })

  test('a click on lead-in words opens their stretch once a second press can no longer make a double-click', ON, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and the e2e run passed.}}')
    await pressOn(ui, 'merged')
    await ui.advance(400)
    expect(await textIn(ui)).toBe('It merged 3 days ago.')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged 3 days ago, and the e2e run passed. «')
    await ui.unmount()
  })

  test('two quick clicks on the lead-in words of two links open both, also on the row below at the same column', ON, async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and passed.}} The second one is approved{{.|, but blocked.}}')
    await pressOn(ui, 'merged')
    await pressOn(ui, 'approved')
    await ui.advance(3000)
    expect(await textIn(ui)).toBe('It merged 3 days ago, and passed. « The second one is approved, but blocked. «')
    await ui.unmount()
    const rows = await mountReply($, FULLSCREEN, 'It merged 3 days ago{{.|, and passed.}}\nIt failed 2 days ago{{.|, and reran.}}', 'reply-2')
    expect(await textIn(rows)).toBe('It merged 3 days ago.\nIt failed 2 days ago.')
    await rows.pointer({ type: 'down', ...at({ x: 4, y: 0 }), button: 'left', in: FIRST })
    await rows.pointer({ type: 'up', ...at({ x: 4, y: 0 }), button: 'left', in: FIRST })
    await rows.pointer({ type: 'down', ...at({ x: 4, y: 1 }), button: 'left', in: FIRST })
    await rows.pointer({ type: 'up', ...at({ x: 4, y: 1 }), button: 'left', in: FIRST })
    await rows.advance(3000)
    expect(await textIn(rows)).toBe('It merged 3 days ago, and passed. «\nIt failed 2 days ago, and reran. «')
    expect(copies).toEqual([])
    await rows.unmount()
  })

  test('a short form opens as the button comes up, not as it goes down', ON, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'It {{merged|merged 3 days ago}}.')
    await ui.pointer({ type: 'down', ...at({ x: 4, y: 0 }), button: 'left', in: FIRST })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged.')
    await ui.pointer({ type: 'up', ...at({ x: 4, y: 0 }), button: 'left', in: FIRST })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged 3 days ago «.')
    await ui.unmount()
  })

  test('while another stretch grows, lead-in words stay drawn and a click on them opens their stretch', ON, async $ => {
    const text = 'The type check exited 0{{|, so it found no errors}}. {{The fix is one line.|The fix is one line in `ci/cache.ts`, where the key hashes the lockfile.}}'
    const ui = await mountReply($, FULLSCREEN, text)
    const underlined = async () =>
      (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.underline === true).map(piece => piece.text).join('')
    expect(await underlined()).toBe('The type check exited 0.The fix is one line.')
    await pressOn(ui, 'The fix')
    await ui.advance(100)
    expect(await underlined()).toContain('The type check exited 0.')
    await pressOn(ui, 'exited')
    await ui.advance(3000)
    expect(await textIn(ui)).toContain('The type check exited 0, so it found no errors «.')
    expect(await textIn(ui)).toContain('hashes the lockfile. «')
    await ui.unmount()
  })

  test('half a code span drawn by a growing long form never draws the marks of a link after it as text', ON, async $ => {
    const text = '{{Run it.|Run `npm run test:unit -- --watch` once.}} Then {{merge `main`|merge `main` into it}}{{.|, after review.}}'
    const ui = await mountReply($, FULLSCREEN, text)
    await pressOn(ui, 'Run it.')
    for (let frame = 0; frame < 120; frame += 1) {
      await ui.advance(16)
      expect(await textIn(ui)).not.toMatch(/[﷐-﷔]/)
    }
    expect(await textIn(ui)).toBe('Run npm run test:unit -- --watch once. « Then merge main.')
    await ui.unmount()
  })

  test('the note names a lone period by the words before it, and the one left closed as well', ON, async ($, on) => {
    const text = 'The PR merged 3 days ago{{.|, and the e2e run passed.}} The second one is approved{{.|, but a failing e2e test blocks it.}}'
    mock.clock(on, { now: 0 })
    mock.env(on, {})
    on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mountReply($, FULLSCREEN, text)
    await pressOn(ui, 'merged')
    await ui.advance(2000)
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual([
      'Stretchtext: since your last reply the reader opened "The PR merged 3 days ago.". They did not open "The second one is approved.".',
    ])
    await ui.unmount()
  })

  test('the note tells apart two stretches written alike after different sentences', ON, async ($, on) => {
    const text = 'It merged{{.|, and passed.}} It shipped{{.|, and passed.}}'
    mock.clock(on, { now: 0 })
    mock.env(on, {})
    on('session.messages', () => ({ value: [{ role: 'assistant', text, toolUses: [] }] }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mountReply($, FULLSCREEN, text)
    await pressOn(ui, 'merged')
    await ui.advance(2000)
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context).toEqual(['Stretchtext: since your last reply the reader opened "It merged.". They did not open "It shipped.".'])
    await ui.unmount()
  })
})
