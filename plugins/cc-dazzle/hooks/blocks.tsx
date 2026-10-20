import type { ElementTable, RenderElement } from 'claude-code'

import { tableHtml, tableText } from './html'
import type { Block, Inline } from './markdown'
import { displayText, inlineText } from './markdown'
import { graphemes, hasLink, longestWord, mostLines, remember, sliceInline, width, wrapInline, wrapRanges } from './text'
import type { Style, Theme } from './theme'
import { ALERT_COLOR } from './theme'
import type { PrismToken } from './vendor/prism.js'
import { languages, tokenize } from './vendor/prism.js'

const isHyperlink = (href: string, http: boolean, editor: boolean): boolean =>
  (http ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href) || (editor && /^vscode(-insiders)?:\/\/file\//i.test(href))

const plainLink = (text: string, href: string): string => {
  const target = href.replace(/^mailto:/i, '')
  return text === target || `http://${text}` === target ? target : `${text} (${target})`
}

const unlink = (nodes: Inline[], http: boolean, editor: boolean): Inline[] =>
  nodes.map(n => (n.kind === 'link' && !isHyperlink(n.href, http, editor) ? { kind: 'text', text: plainLink(n.text, n.href) } : 'children' in n ? { ...n, children: unlink(n.children, http, editor) } : n))

const unlinkBlock = (block: Block, http: boolean, editor: boolean): Block => {
  const plain = (nodes: Inline[]) => unlink(nodes, http, editor)
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return { ...block, inline: plain(block.inline) }
    case 'list':
      return { ...block, items: block.items.map(item => ({ ...item, inline: plain(item.inline) })) }
    case 'table':
      return { ...block, header: block.header.map(plain), rows: block.rows.map(r => r.map(plain)) }
    case 'notes':
      return { ...block, notes: block.notes.map(note => ({ ...note, inline: plain(note.inline) })) }
    default:
      return block
  }
}

const unlinked = new WeakMap<Block, Block[]>()

// A link Claude Code cannot open draws as its text and target, so nothing looks clickable that is not.
const drawable = (block: Block, http: boolean, editor: boolean): Block => {
  const cached = unlinked.get(block) ?? []
  unlinked.set(block, cached)
  return (cached[+http + 2 * +editor] ??= unlinkBlock(block, http, editor))
}

const noteHover = (style: Style, note: number | undefined) =>
  note === undefined || style.noteKey === undefined ? {} : { hover: { scope: `fn:${style.noteKey}:${note}`, inverse: true } }

const renderInline = (el: ElementTable, style: Style, nodes: Inline[], keyBase: string): RenderElement[] => {
  const { Text } = el
  const t = style.theme
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`
    switch (n.kind) {
      case 'text':
        return <Text key={key}>{n.text}</Text>
      case 'strong':
        return <Text key={key} bold color={t.strong}>{renderInline(el, style, n.children, key)}</Text>
      case 'emphasis':
        return <Text key={key} italic color={t.emphasis}>{renderInline(el, style, n.children, key)}</Text>
      case 'strike':
        return <Text key={key} strikethrough dimColor>{renderInline(el, style, n.children, key)}</Text>
      case 'code':
        return <Text key={key} color={t.inlineCode}>{n.text}</Text>
      case 'math':
        return <Text key={key} italic color={t.emphasis}>{n.text}</Text>
      case 'link':
        return n.text === n.href ? <Text key={key} color={t.link}><el.Link href={n.href} /></Text> : <el.Link key={key} href={n.href}><Text color={t.link}>{n.text}</Text></el.Link>
      case 'number':
        return <Text key={key} color={t.number}>{n.text}</Text>
      case 'path':
        return <Text key={key} color={t.path}>{n.text}</Text>
      case 'dim':
        return <Text key={key} dimColor>{n.text}</Text>
      case 'footnote':
        return <Text key={key} color={t.accent} {...noteHover(style, n.note)}>{n.text}</Text>
    }
  })
}

type Mark = { start: number; end: number; text: string; note: number }
type TextLook = { italic?: boolean; color?: string; bold?: boolean; dimColor?: boolean; strikethrough?: boolean }

const marksIn = (nodes: Inline[], at = 0): Mark[] => {
  const out: Mark[] = []
  for (const n of nodes) {
    const length = inlineText([n]).length
    if (n.kind === 'footnote' && n.note !== undefined) out.push({ start: at, end: at + length, text: n.text, note: n.note })
    else if ('children' in n) out.push(...marksIn(n.children, at))
    at += length
  }
  return out
}

const piecesOf = (text: string, a: number, b: number, columns: number, marks: Mark[]): (readonly [number, number])[] => {
  if (width(text.slice(a, b)) <= columns) return [[a, b]]
  const out: [number, number][] = []
  let start = a
  let at = a
  let taken = 0
  for (const g of graphemes(text.slice(a, b))) {
    const step = width(g)
    if (at > start && taken + step > columns) {
      const cut = marks.find(m => m.start < at && at < m.end)?.start ?? at
      if (cut > start) {
        out.push([start, cut])
        taken = width(text.slice(cut, at))
        start = cut
      }
    }
    at += g.length
    taken += step
  }
  out.push([start, b])
  return out
}

// A Text holds only inline elements, so a line with clickable footnote marks draws as a wrapping row
// of word runs, each mark a plain Button.
const pressInline = (el: ElementTable, style: Style, nodes: Inline[], columns: number, key: string, tip: Tip | undefined, look: TextLook = {}, box: { justifyContent?: 'flex-start' | 'flex-end' | 'center' } = {}): RenderElement | null => {
  const marks = tip ? marksIn(nodes).flatMap(m => {
    const press = tip(m.note)
    return press ? [{ ...m, press }] : []
  }) : []
  if (!marks.length) return null
  const { Box, Text, Button } = el
  const run = (a: number, b: number) => <Text key={`${key}.t${a}`} {...look}>{renderInline(el, style, sliceInline(nodes, a, b), `${key}.t${a}`)}</Text>
  const text = inlineText(nodes)
  const words = [...text.matchAll(/\s*\S+\s*/g)].flatMap(m => piecesOf(text, m.index, m.index + m[0].length, Math.max(1, columns), marks))
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" {...box}>
      {words.map(([a, b]) => {
        const inside = marks.filter(m => m.start >= a && m.end <= b)
        if (!inside.length) return run(a, b)
        const parts: RenderElement[] = []
        let at = a
        for (const m of inside) {
          if (m.start > at) parts.push(run(at, m.start))
          parts.push(
            <Button key={`${key}.n${m.start}`} plain {...noteHover(style, m.note)} onPress={m.press}>
              <Text color={style.theme.accent} bold={look.bold}>{m.text}</Text>
            </Button>,
          )
          at = m.end
        }
        if (at < b) parts.push(run(at, b))
        return <Box key={`${key}.w${a}`} flexDirection="row" flexShrink={0}>{parts}</Box>
      })}
    </Box>
  )
}

const PRISM_COLORS: Record<string, keyof Theme> = {
  comment: 'codeComment', prolog: 'codeComment', doctype: 'codeComment', cdata: 'codeComment',
  string: 'codeString', char: 'codeString', 'template-string': 'codeString', 'attr-value': 'codeString', url: 'codeString',
  number: 'number', boolean: 'number', constant: 'number', symbol: 'number', inserted: 'number',
  keyword: 'codeFlag', important: 'codeFlag', atrule: 'codeFlag', rule: 'codeFlag', deleted: 'codeFlag',
  function: 'codeCommand', 'class-name': 'codeCommand', builtin: 'codeCommand', key: 'codeCommand', selector: 'codeCommand',
  property: 'link', tag: 'link', 'attr-name': 'emphasis', variable: 'emphasis', regex: 'path',
}

export type Segment = { text: string; color?: string; italic: boolean }

const flatten = (tokens: PrismToken[], style: Style, color?: string, italic = false): Segment[] =>
  tokens.flatMap(token => {
    if (typeof token === 'string') return [{ text: token, color, italic }]
    const names = [token.type, ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [])]
    const slot = names.map(n => PRISM_COLORS[n]).find(Boolean)
    const inner = Array.isArray(token.content) ? token.content : [token.content]
    return flatten(inner, style, slot ? style.theme[slot] : color, italic || token.type === 'comment')
  })

const highlighted = new WeakMap<Theme, Map<string, Segment[][]>>()

const grammarFor = (lang: string) => {
  const name = lang.toLowerCase()
  const grammar = Object.hasOwn(languages, name) ? languages[name] : undefined
  return grammar !== null && typeof grammar === 'object' ? grammar : undefined
}

export const highlightRows = (style: Style, lines: string[], lang: string): Segment[][] | null => {
  const grammar = grammarFor(lang)
  if (!grammar) return null
  const code = lines.join('\n')
  const cache = highlighted.get(style.theme) ?? new Map<string, Segment[][]>()
  highlighted.set(style.theme, cache)
  return remember(cache, `${lang}\0${code}`, () => {
    const out: Segment[][] = [[]]
    for (const seg of flatten(tokenize(code, grammar), style)) {
      seg.text.split('\n').forEach((piece, i) => {
        if (i > 0) out.push([])
        if (piece) out[out.length - 1]!.push({ ...seg, text: piece })
      })
    }
    return out
  })
}

export const highlightBlock = ({ Text }: ElementTable, style: Style, lines: string[], lang: string, key: string): RenderElement[] | null => {
  const rows = highlightRows(style, lines, lang)
  if (!rows) return null
  return rows.map((row, r) => (
    <Text key={`${key}.${r}`} color={style.theme.codeText}>
      {row.length ? row.map((s, i) => <Text key={`${key}.${r}.${i}`} color={s.color} italic={s.italic}>{s.text}</Text>) : ' '}
    </Text>
  ))
}

const isSessionLang = (lang: string) => /^(console|shell-session|shellsession|terminal|sh-session)$/i.test(lang)

const PROMPT = /^([$%]) (.*)$/

export const sessionCommands = (lines: readonly string[]): string => {
  const commands = lines.map(line => PROMPT.exec(line)?.[2]).filter((command): command is string => command !== undefined)
  return (commands.length ? commands : lines).join('\n')
}

const sessionLine = (el: ElementTable, style: Style, line: string, key: string): RenderElement => {
  const { Text } = el
  const t = style.theme
  const command = PROMPT.exec(line)
  if (!command) return <Text key={key} color={t.codeText} dimColor>{line === '' ? ' ' : line}</Text>
  return (
    <Text key={key} color={t.codeText}>
      <Text color={t.codeComment}>{`${command[1]} `}</Text>
      {codeLine(el, style, command[2]!, 'bash', `${key}.c`)}
    </Text>
  )
}

export const isShellLang = (lang: string) => lang === '' || /^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i.test(lang)

export const codeLine = (el: ElementTable, style: Style, line: string, lang: string, key: string): RenderElement => {
  const { Text } = el
  const t = style.theme
  const isShell = isShellLang(lang)
  if (/[─-╿]/.test(line)) return <Text key={key} color={t.codeText}>{line}</Text>
  if (!isShell) return <Text key={key} color={t.codeText}>{line || ' '}</Text>
  if (/^\s*#/.test(line)) return <Text key={key} color={t.codeComment}>{line}</Text>
  const parts = line.split(/("[^"]*"|'[^']*'|\s+)/).filter(p => p !== '')
  let seenCommand = false
  return (
    <Text key={key} color={t.codeText}>
      {parts.map((p, i) => {
        if (/^\s+$/.test(p)) return <Text key={`${key}.${i}`}>{p}</Text>
        if (/^["']/.test(p)) return <Text key={`${key}.${i}`} color={t.codeString}>{p}</Text>
        if (/^--?[\w-]/.test(p)) return <Text key={`${key}.${i}`} color={t.codeFlag}>{p}</Text>
        if (!seenCommand && !/^[$>|&;]+$/.test(p)) {
          seenCommand = true
          return <Text key={`${key}.${i}`} color={t.codeCommand}>{p}</Text>
        }
        if (/^(\||&&|;|\|\|)$/.test(p)) seenCommand = false
        return <Text key={`${key}.${i}`}>{p}</Text>
      })}
    </Text>
  )
}

export const columnWidths = (natural: number[], available: number, gap: number, words: number[] = []): number[] => {
  const room = Math.max(natural.length, available - gap * (natural.length - 1))
  const total = natural.reduce((a, b) => a + b, 0)
  if (total <= room) return natural
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)))
  const widths = natural.map(() => 0)
  let open = natural.map((_, c) => c)
  let left = room
  for (let fixed = [-1]; fixed.length; ) {
    const share = Math.floor(left / open.length)
    const claim = (c: number) => (natural[c]! <= share ? natural[c]! : minimum[c]!)
    const minimumsFit = open.reduce((a, c) => a + minimum[c]!, 0) <= left
    const needed = open.reduce((a, c) => a + claim(c), 0)
    fixed = open.filter(c => natural[c]! <= share)
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter(c => minimum[c]! > share)
    fixed.forEach(c => (widths[c] = claim(c), left -= widths[c]!))
    open = open.filter(c => !fixed.includes(c))
  }
  open.forEach((c, i) => (widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0))))
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest]! <= 1) break
    widths[widest]!--
  }
  return widths
}

const ART_WIDTH = 100

const textRows = (text: string, w: number): number => (width(text) <= w ? 1 : mostLines(text, Math.max(1, w)))

const heightOf = (blocks: Block[], w: number): number => blocks.reduce((sum, block, b) => sum + (b ? 1 : 0) + blockHeight(block, w), 0)

const tableSize = (block: Extract<Block, { kind: 'table' }>) => ({
  natural: block.header.map((h, c) => Math.max(width(displayText(h)), ...block.rows.map(r => width(displayText(r[c] ?? []))))),
  words: block.header.map((h, c) => Math.max(longestWord(displayText(h)), ...block.rows.map(r => longestWord(displayText(r[c] ?? []))))),
})

const blockHeight = (block: Block, w: number): number => {
  switch (block.kind) {
    case 'heading':
      return 2 * textRows(displayText(block.inline), w - 4) + 2
    case 'paragraph':
      return textRows(displayText(block.inline), w)
    case 'list':
      return block.items.reduce((sum, item) => {
        const pad = item.depth * 2 + item.marker.length + 4
        return sum + textRows(displayText(item.inline), w - pad) + (item.blocks ? heightOf(item.blocks, w - pad) + 1 : 0)
      }, 0)
    case 'code':
      return block.lines.reduce((sum, line) => sum + textRows(line, w - 8), 3)
    case 'table': {
      const { natural, words } = tableSize(block)
      const widths = columnWidths(natural, w - 4, 3, words)
      const tallest = (cells: Inline[][]) => Math.max(1, ...widths.map((cw, c) => textRows(displayText(cells[c] ?? []), cw)))
      return block.rows.reduce((sum, row) => sum + 1 + tallest(row), 4 + tallest(block.header))
    }
    case 'quote':
      return Math.max(1, heightOf(block.blocks, w - 2))
    case 'alert':
      return 3 + heightOf(block.blocks, w - 4)
    case 'rule':
      return 1
    case 'notes':
      return block.notes.reduce((sum, note) => sum + textRows(`${note.mark} ${displayText(note.inline)}`, w), 1)
  }
}

const clip = ({ Box }: ElementTable, w: number, drawn: RenderElement, key?: string) => (
  <Box key={key} flexDirection="column" minWidth={w}>
    <Box height={0} flexGrow={1} overflow="hidden">
      {drawn}
    </Box>
  </Box>
)

const headerRuns = (nodes: Inline[]): Inline[] =>
  nodes.flatMap(n => (n.kind === 'footnote' ? [n] : 'children' in n ? headerRuns(n.children) : [{ kind: 'text' as const, text: n.text }]))
    .reduce<Inline[]>((out, n) => {
      const last = out[out.length - 1]
      return n.kind === 'text' && last?.kind === 'text' ? [...out.slice(0, -1), { kind: 'text', text: last.text + n.text }] : [...out, n]
    }, [])

export const tableArt = (block: Extract<Block, { kind: 'table' }>): string => {
  const cells = [block.header, ...block.rows].map(r => block.header.map((_, c) => displayText(r[c] ?? [])))
  const widths = columnWidths(
    block.header.map((_, c) => Math.max(...cells.map(r => width(r[c]!)))),
    ART_WIDTH - 4,
    3,
    block.header.map((_, c) => Math.max(...cells.map(r => longestWord(r[c]!)))),
  )
  const pad = (text: string, c: number, align: 'left' | 'right' | 'center') => {
    const room = Math.max(0, widths[c]! - width(text))
    const left = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0
    return ' '.repeat(left) + text + ' '.repeat(room - left)
  }
  const line = (l: string, m: string, r: string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r
  const row = (r: string[], header: boolean) => {
    const lines = r.map((text, c) => wrapRanges(text, widths[c]!).map(([a, b]) => text.slice(a, b)))
    return Array.from({ length: Math.max(...lines.map(l => l.length)) }, (_, i) =>
      `│ ${lines.map((l, c) => pad(l[i] ?? '', c, header ? 'center' : block.align[c] ?? 'left')).join(' │ ')} │`)
  }
  const art = [line('┌', '┬', '┐'), ...row(cells[0]!, true), ...cells.slice(1).flatMap(r => [line('├', '┼', '┤'), ...row(r, false)]), line('└', '┴', '┘')]
  return ['```', ...art, '```'].join('\n')
}

const renderTable = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'table' }>, columns: number, key: string, tip?: Tip) => {
  const { Box, Text } = el
  const t = style.theme
  const { natural, words } = tableSize(block)
  const widths = columnWidths(natural, columns - 4, 3, words)
  const justify = (c: number) =>
    block.align[c] === 'right' ? 'flex-end' : block.align[c] === 'center' ? 'center' : 'flex-start'

  const bar = (k: string, text: string, lines = 1) => (
    <Text key={k} color={t.tableRule} dimColor={!t.tableRule}>{Array.from({ length: lines }, () => text).join('\n')}</Text>
  )
  const clipped = (lines: number) => (k: string, text: string) => clip(el, width(text), bar(`${k}.b`, text, lines), k)
  const edge = (k: string, [left, fill, mid, right]: string) =>
    bar(k, left + widths.map(w => fill!.repeat(w + 2)).join(mid) + right)

  const row = (cells: Inline[][], k: string, isHeader: boolean, border: (k: string, text: string) => RenderElement = bar) => (
    <Box key={k} flexDirection="row" columnGap={0} alignItems="stretch">
      {border(`${k}.l`, '│ ')}
      {widths.map((w, c) => {
        const content = cells[c] ?? []
        const runs = isHeader ? headerRuns(content) : content
        const cellBox = (
          <Box key={`${k}.${c}`} width={w} flexShrink={0} justifyContent={justify(c)}>
            {pressInline(el, style, runs, w, `${k}.${c}.p`, tip, isHeader ? { bold: true, color: t.tableHeader } : {}, { justifyContent: justify(c) })
              ?? (isHeader
                ? <Text bold color={t.tableHeader}>{runs.some(n => n.kind === 'footnote') ? renderInline(el, style, runs, `${k}.${c}`) : inlineText(runs)}</Text>
                : <Text>{renderInline(el, style, content, `${k}.${c}`)}</Text>)}
          </Box>
        )
        return c > 0 ? [border(`${k}.${c}s`, ' │ '), cellBox] : cellBox
      })}
      {border(`${k}.r`, ' │')}
    </Box>
  )

  const wrappedRow = (cells: Inline[][], k: string, isHeader: boolean) => {
    if (!isHeader && cells.some(hasLink)) return [row(cells, k, isHeader, clipped(Math.max(1, ...widths.map((w, c) => mostLines(displayText(cells[c] ?? []), w)))))]
    const wrapped = widths.map((w, c) => {
      const content = cells[c] ?? []
      if (natural[c]! <= w) return [content]
      return wrapInline(isHeader ? headerRuns(content) : content, w)
    })
    return Array.from({ length: Math.max(...wrapped.map(l => l.length)) }, (_, i) =>
      row(wrapped.map(l => l[i] ?? []), `${k}.${i}`, isHeader))
  }

  const lines: RenderElement[] = [edge(`${key}.t`, '┌─┬┐'), ...wrappedRow(block.header, `${key}.h`, true), edge(`${key}.hr`, '╞═╪╡')]
  block.rows.forEach((r, i) => {
    if (i > 0) lines.push(edge(`${key}.r${i}r`, '├─┼┤'))
    lines.push(...wrappedRow(r, `${key}.r${i}`, false))
  })
  lines.push(edge(`${key}.b`, '└─┴┘'))
  return <Box key={key} flexDirection="column">{lines}</Box>
}

const renderHeading = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'heading' }>, key: string) => {
  const { Box, Text } = el
  const t = style.theme
  const color = block.level <= 2 ? t.heading : t.strong
  const inline = block.inline
  return block.level === 1
    ? <Box key={key} flexDirection="column" alignSelf="flex-start"><Text bold color={color}>{renderInline(el, style, inline, key)}</Text><Text color={color}>{'━'.repeat(width(inlineText(inline)))}</Text></Box>
    : <Text key={key} bold color={color}>{renderInline(el, style, inline, key)}</Text>
}

const prose = (style: Style) => (style.inside === 'quote' ? { italic: true, color: style.theme.quote } : {})

const renderParagraph = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'paragraph' }>, columns: number, key: string, tip?: Tip) => {
  const { Text } = el
  return pressInline(el, style, block.inline, columns, key, tip, prose(style)) ?? <Text key={key} {...prose(style)}>{renderInline(el, style, block.inline, key)}</Text>
}

const renderNested = (el: ElementTable, style: Style, blocks: Block[], columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) =>
  renderBlocks(el, style, blocks, columns, new Map(), copy && ((text, id, label, html) => copy(text, `${key}.${id}`, label, html)), fold && ((id, hidden, k) => fold(id, hidden, `${key}.${k}`)), tip)

const quoteBar = (el: ElementTable, text: string, color: string | undefined, lines: number) =>
  lines <= 1 ? <el.Text color={color}>{text}</el.Text> : clip(el, width(text), <el.Text color={color}>{Array.from({ length: lines }, () => text).join('\n')}</el.Text>)

const renderQuote = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'quote' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box } = el
  const inner = columns - 2
  return (
    <Box key={key} flexDirection="row" alignItems="stretch">
      {quoteBar(el, '│ ', style.theme.codeComment, heightOf(block.blocks, inner))}
      <Box flexDirection="column" rowGap={1}>{renderNested(el, { ...style, inside: 'quote' }, block.blocks, inner, key, copy, fold, tip)}</Box>
    </Box>
  )
}

const renderAlert = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'alert' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box, Text } = el
  const color = ALERT_COLOR[block.level]
  return (
    <Box key={key} flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={color} paddingX={1}>
      <Text bold color={color}>{block.level[0]!.toUpperCase() + block.level.slice(1)}</Text>
      {block.blocks.length ? <Box flexDirection="column" rowGap={1}>{renderNested(el, { ...style, inside: 'alert' }, block.blocks, columns - 4, key, copy, fold, tip)}</Box> : null}
    </Box>
  )
}

const TASK_GLYPHS = ['[ ]', '[✓]'] as const

const renderList = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'list' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box, Text } = el
  const t = style.theme
  return (
    <Box key={key} flexDirection="column">
      {block.items.map((item, i) => {
        const k = `${key}.${i}`
        const glyph = item.task !== undefined ? TASK_GLYPHS[item.task ? 1 : 0] : /\d/.test(item.marker) ? item.marker : item.depth ? '◦' : '•'
        const pad = item.depth * 2 + glyph.length + 1
        const row = (
          <Box key={k} flexDirection="row" paddingLeft={item.depth * 2}>
            <Text color={t.bullet}>{`${glyph} `}</Text>
            {pressInline(el, style, item.inline, columns - pad, `${k}.i`, tip, { ...(item.task === true ? { dimColor: true, strikethrough: true } : {}), ...prose(style) }) ?? <Text dimColor={item.task === true} strikethrough={item.task === true} {...prose(style)}>{renderInline(el, style, item.inline, k)}</Text>}
          </Box>
        )
        if (!item.blocks) return row
        return (
          <Box key={k} flexDirection="column">
            {row}
            <Box flexDirection="column" paddingLeft={pad}>{renderNested(el, style, item.blocks, columns - pad, k, copy, fold, tip)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

export type CopyButton = (text: string | (() => string), key: string, label?: string, html?: () => string) => RenderElement | null
export type Drawn = Map<number, { element?: RenderElement; art?: string; note?: string }>
export type Fold = (id: string, hidden: number, key: string) => { folded: boolean; element: RenderElement } | null
export type Tip = (note: number) => (() => void) | undefined

export const instanceKey = (id: string): string => {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export const noteTip = (blocks: Block[], toast: (text: string) => void): Tip | undefined => {
  const notes = blocks.find(block => block.kind === 'notes')
  if (notes?.kind !== 'notes') return undefined
  const text = new Map(notes.notes.map(note => [note.note, `${note.mark} ${inlineText(note.inline)}`]))
  return note => {
    const line = text.get(note)
    return line === undefined ? undefined : () => toast(line)
  }
}

const NUMBER_AT = 10
const NUMBER_MAX = 400
const FOLD_AT = 30
const FOLD_SHOW = 20

const codeId = (lines: string[]): string => {
  let h = 5381
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) h = (h * 33 + line.charCodeAt(i)) | 0
    h = (h * 33 + 10) | 0
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`
}

const copySource = (style: Style, block: Block): string | undefined =>
  block.kind === 'code' ? block.lines.join('\n')
  : block.kind === 'table' ? block.raw
  : style.inside ? undefined
  : block.kind === 'list' ? block.raw
  : block.kind === 'quote' || block.kind === 'alert' ? block.raw.split('\n').map(line => line.replace(/^\s*>\s?/, '')).join('\n')
  : undefined

const opensWithCopy = (block: Block): boolean =>
  block.kind === 'quote' && (block.blocks[0]?.kind === 'code' || block.blocks[0]?.kind === 'table' || (block.blocks[0] !== undefined && opensWithCopy(block.blocks[0])))

const holdsOnlyEmptyCode = (block: Block): boolean =>
  block.kind === 'quote' && block.blocks.length === 1 && ((block.blocks[0]!.kind === 'code' && block.blocks[0]!.lines.length === 0) || holdsOnlyEmptyCode(block.blocks[0]!))

export const renderBlocks = (el: ElementTable, style: Style, blocks: Block[], columns: number, drawn: Drawn = new Map(), copy?: CopyButton, fold?: Fold, tip?: Tip): RenderElement[] => {
  const { Box, Text } = el
  const t = style.theme
  const hover = style.copyButtonStyle === 'hover'
  // With hover, a block's buttons float over its top-right corner, out of the flow, and show only
  // while the pointer is over the block. They cover only their own cells: the block reserves their
  // width, so they never run off its left edge.
  const floating = (button: RenderElement | null, low = false) => (button ? <Box position="absolute" {...(low ? { bottom: 0 } : { top: 0 })} right={0} display="none" hover={{ display: 'flex' }}>{button}</Box> : null)
  const reserved = (button: RenderElement | null | undefined): number => (button?.type === 'Button' ? width(`[ ${button.props.label} ]`) : 0)
  const reservedAll = (row: (RenderElement | null | undefined)[]): number => row.reduce<number>((w, button) => (reserved(button) ? w + (w ? 1 : 0) + reserved(button) : w), 0)
  const buttons = blocks.map((block, b) => {
    const text = hover && holdsOnlyEmptyCode(block) ? undefined : copySource(style, block)
    const isPlainCode = block.kind === 'code' && !drawn.get(b)?.element
    const art = drawn.get(b)?.art ?? (block.kind === 'table' ? () => tableArt(block) : undefined)
    const first = text === undefined || isPlainCode ? null : copy?.(text, `copy${b}`, block.kind === 'table' ? '⧉ md' : art === undefined ? undefined : '⧉ source')
    const second = first && art !== undefined ? copy?.(art, `art${b}`, '⧉ art') : null
    const html = first && block.kind === 'table' ? copy?.(() => tableText(block), `html${b}`, '⧉ html', () => tableHtml(block)) : null
    return { first, second, html }
  })
  const beside = (b: number) => (hover || !buttons[b]!.first ? columns : columns - reserved(buttons[b]!.first) - 2)
  const shown = blocks.map(block => drawable(block, style.httpLinks === true, style.editorLinks === true))
  const rendered = shown.map((block, b) => {
    const key = `b${b}`
    switch (block.kind) {
      case 'heading':
        return renderHeading(el, style, block, key)
      case 'paragraph':
        return renderParagraph(el, style, block, columns, key, tip)
      case 'quote':
        return renderQuote(el, style, block, beside(b), key, copy, fold, tip)
      case 'alert':
        return renderAlert(el, style, block, beside(b), key, copy, fold, tip)
      case 'rule':
        return <Text key={key} color={t.rule} dimColor={!t.rule}>{'─'.repeat(Math.max(8, Math.min(columns, 80)))}</Text>
      case 'code': {
        const done = drawn.get(b)?.element
        if (done) return done
        const note = drawn.get(b)?.note
        const lines = block.lines
        const toggle = lines.length > FOLD_AT ? fold?.(codeId(lines), lines.length - FOLD_SHOW, `fold${b}`) : null
        const shown = toggle?.folded ? FOLD_SHOW : lines.length
        const session = isSessionLang(block.lang)
        const numbered = lines.length >= NUMBER_AT && lines.length <= NUMBER_MAX
        const rows = style.nativeCode
          ? [<el.Code key="code" source={lines.slice(0, shown).join('\n') || ' '} {...(block.lang ? { language: block.lang } : {})} {...(numbered ? { startLine: 1 } : {})} />]
          : session
          ? lines.slice(0, shown).map((line, i) => sessionLine(el, style, line, `${key}.${i}`))
          : (isShellLang(block.lang) ? null : highlightBlock(el, style, lines, block.lang, key))?.slice(0, shown) ?? lines.slice(0, shown).map((line, i) => codeLine(el, style, line, block.lang, `${key}.${i}`))
        const gutter = String(lines.length).length
        const source = session ? sessionCommands(lines) : lines.join('\n')
        const button = copy?.(source, `copy${b}`) ?? null
        const body = !numbered || style.nativeCode ? rows : rows.map((row, i) => row.type === 'Text' ? <Box key={`n${i}`} flexDirection="row"><Text color={t.codeComment} dimColor>{`${String(i + 1).padStart(gutter)}  `}</Text>{row}</Box> : row)
        return (
          <Box key={key} flexDirection="column" {...(hover ? { minWidth: reserved(button) } : {})}>
            {note ? <Text color={t.codeComment}>{note}</Text> : null}
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Text color={t.codeComment}>{` ${block.lang || 'code'}`}</Text>
              {hover ? null : button}
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1}>
              {hover ? floating(button) : null}
              <Box flexDirection="column">{body}</Box>
              {toggle?.element ?? null}
            </Box>
          </Box>
        )
      }
      case 'list':
        return renderList(el, style, block, columns, key, copy, fold, tip)
      case 'table':
        return renderTable(el, style, block, columns, key, tip)
      case 'notes':
        return (
          <Box key={key} flexDirection="column">
            <Text dimColor>{'─'.repeat(Math.min(columns, 12))}</Text>
            {block.notes.map((note, i) => <Text key={`${key}.${i}`} dimColor {...noteHover(style, note.note)}>{note.mark} {renderInline(el, style, note.inline, `${key}.${i}`)}</Text>)}
          </Box>
        )
    }
  })
  const copied = rendered.map((element, b) => {
    const block = blocks[b]
    const { first, second, html } = buttons[b]!
    const button = second ? (
      <el.Box key={`copies${b}`} flexDirection="row" columnGap={1}>
        {first}
        {second}
        {html}
      </el.Box>
    ) : first
    if (!button) return element
    if (block?.kind === 'code' && drawn.get(b)?.art !== undefined) {
      return (
        <Box key={`c${b}`} flexDirection="column" alignSelf="flex-start" {...(hover ? { minWidth: reservedAll([first, second, html]) } : {})}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <el.Text color={style.theme.codeComment}>{` ${block.lang || 'diagram'}`}</el.Text>
            {hover ? null : button}
          </Box>
          {hover ? floating(button) : null}
          <Box flexDirection="column" borderStyle="round" borderColor={style.theme.rule} paddingX={1}>
            {element}
          </Box>
        </Box>
      )
    }
    if (hover) {
      return (
        <Box key={`c${b}`} flexDirection="column" alignSelf="flex-start" minWidth={reservedAll([first, second, html])}>
          {element}
          {floating(button, block !== undefined && opensWithCopy(block))}
        </Box>
      )
    }
    return block?.kind === 'quote' || block?.kind === 'alert' || block?.kind === 'list' ? (
      <Box key={`c${b}`} flexDirection="row" columnGap={2}>
        {element}
        {block && opensWithCopy(block) ? <Box alignSelf="flex-end">{button}</Box> : button}
      </Box>
    ) : (
      <Box key={`c${b}`} flexDirection="column" alignSelf="flex-start">
        <Box justifyContent="flex-end">{button}</Box>
        {element}
      </Box>
    )
  })
  const isFigure = (b: number) => blocks[b]?.kind === 'table' || drawn.get(b)?.art !== undefined
  const out: RenderElement[] = []
  for (let b = 0; b < rendered.length; b++) {
    if (!isFigure(b) || !isFigure(b + 1)) {
      out.push(copied[b]!)
      continue
    }
    const start = b
    while (isFigure(b + 1)) b++
    out.push(
      <Box key={`row${start}`} flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={1}>
        {copied.slice(start, b + 1).map((figure, i) => <Box key={`f${start + i}`} flexShrink={0}>{figure}</Box>)}
      </Box>,
    )
  }
  return out
}
