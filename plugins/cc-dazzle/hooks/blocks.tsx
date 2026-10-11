import type { ElementTable, RenderElement } from 'claude-code'

import { tableHtml, tableText } from './html'
import type { Block, Inline } from './markdown'
import { displayText, inlineText } from './markdown'
import { hasLink, longestWord, mostLines, remember, width, wrapInline, wrapRanges } from './text'
import type { Style, Theme } from './theme'
import type { PrismToken } from './vendor/prism.js'
import { languages, tokenize } from './vendor/prism.js'

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
        return /^(https:|http:\/\/localhost\b)/i.test(n.href)
          ? n.text === n.href ? <el.Link key={key} href={n.href} /> : <el.Link key={key} href={n.href}><Text color={t.link} underline>{n.text}</Text></el.Link>
          : <Text key={key} color={t.link} underline>{n.text}</Text>
      case 'number':
        return <Text key={key} color={t.number}>{n.text}</Text>
      case 'path':
        return <Text key={key} color={t.path}>{n.text}</Text>
      case 'dim':
        return <Text key={key} dimColor>{n.text}</Text>
      case 'footnote':
        return <Text key={key} color={t.accent}>{n.text}</Text>
    }
  })
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
      <Text color={t.accent} bold>{`${command[1]} `}</Text>
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

export const tableArt = (block: Extract<Block, { kind: 'table' }>): string => {
  const cells = [block.header, ...block.rows].map(r => block.header.map((_, c) => displayText(r[c] ?? [])))
  const widths = columnWidths(
    block.header.map((_, c) => Math.max(...cells.map(r => width(r[c]!)))),
    ART_WIDTH - 4,
    3,
    block.header.map((_, c) => Math.max(...cells.map(r => longestWord(r[c]!)))),
  )
  const pad = (text: string, c: number, align: 'left' | 'right' | 'center') => {
    const room = widths[c]! - width(text)
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

const renderTable = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'table' }>, columns: number, key: string) => {
  const { Box, Text } = el
  const t = style.theme
  const natural = block.header.map((h, c) =>
    Math.max(width(displayText(h)), ...block.rows.map(r => width(displayText(r[c] ?? [])))),
  )
  const words = block.header.map((h, c) =>
    Math.max(longestWord(displayText(h)), ...block.rows.map(r => longestWord(displayText(r[c] ?? [])))),
  )
  const widths = columnWidths(natural, columns - 4, 3, words)
  const justify = (c: number) =>
    block.align[c] === 'right' ? 'flex-end' : block.align[c] === 'center' ? 'center' : 'flex-start'

  const bar = (k: string, text: string, lines = 1) => (
    <Text key={k} color={t.tableRule} dimColor={!t.tableRule}>{Array.from({ length: lines }, () => text).join('\n')}</Text>
  )
  const clipped = (lines: number) => (k: string, text: string) => (
    <Box key={k} minWidth={width(text)}>
      <Box position="absolute" top={0} bottom={0} left={0} minWidth={width(text)} overflow="hidden">
        {bar(`${k}.b`, text, lines)}
      </Box>
    </Box>
  )
  const edge = (k: string, [left, fill, mid, right]: string) =>
    bar(k, left + widths.map(w => fill!.repeat(w + 2)).join(mid) + right)

  const row = (cells: Inline[][], k: string, isHeader: boolean, border: (k: string, text: string) => RenderElement = bar) => (
    <Box key={k} flexDirection="row" columnGap={0} alignItems="stretch">
      {border(`${k}.l`, '│ ')}
      {widths.map((w, c) => {
        const content = cells[c] ?? []
        const cellBox = (
          <Box key={`${k}.${c}`} width={w} flexShrink={0} justifyContent={justify(c)}>
            {isHeader
              ? <Text bold color={t.tableHeader}>{inlineText(content)}</Text>
              : <Text>{renderInline(el, style, content, `${k}.${c}`)}</Text>}
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
      return wrapInline(isHeader ? [{ kind: 'text', text: inlineText(content) }] : content, w)
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
  const color = block.level <= 2 ? t.heading : t.accent ?? t.heading
  const inline = block.inline
  const label = inlineText(inline)
  if (block.level === 1) return <Box key={key} alignSelf="flex-start" borderStyle="bold" borderColor={color} paddingX={1}><Text bold color={color}>{renderInline(el, style, inline, key)}</Text></Box>
  return block.level === 2
    ? <Box key={key} flexDirection="column" alignSelf="flex-start"><Text bold color={color}>{renderInline(el, style, inline, key)}</Text><Text color={color}>{'━'.repeat(width(label))}</Text></Box>
    : <Text key={key} bold color={block.level === 3 ? color : t.strong}>{renderInline(el, style, inline, key)}</Text>
}

const ALERT_COLOR = { note: 'blue', tip: 'green', important: 'magenta', warning: 'yellow', caution: 'red' } as const

const renderParagraph = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'paragraph' }>, key: string) => {
  const { Text } = el
  return <Text key={key}>{renderInline(el, style, block.inline, key)}</Text>
}

const renderQuote = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'quote' }>, key: string) => {
  const { Box, Text } = el
  const t = style.theme
  return (
    <Box key={key} flexDirection="row">
      <Text color={t.accent}>│ </Text>
      <Text italic color={t.quote}>{renderInline(el, style, block.inline, key)}</Text>
    </Box>
  )
}

const renderAlert = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'alert' }>, key: string) => {
  const { Box, Text } = el
  const color = ALERT_COLOR[block.level]
  const title = <Text bold color={color}>{block.level[0]!.toUpperCase() + block.level.slice(1)}</Text>
  return (
    <Box key={key} flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={color} paddingX={1}>
      {title}
      {block.inline.length ? <Text>{renderInline(el, style, block.inline, key)}</Text> : null}
    </Box>
  )
}

const TASK_GLYPHS = ['[ ]', '[✓]'] as const

const renderList = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'list' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold) => {
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
            <Text dimColor={item.task === true} strikethrough={item.task === true}>{renderInline(el, style, item.inline, k)}</Text>
          </Box>
        )
        if (!item.blocks) return row
        const scoped: CopyButton | undefined = copy && ((text, id, label, html) => copy(text, `${k}.${id}`, label, html))
        const scopedFold: Fold | undefined = fold && ((id, hidden, key) => fold(id, hidden, `${k}.${key}`))
        return (
          <Box key={k} flexDirection="column">
            {row}
            <Box flexDirection="column" paddingLeft={pad}>{renderBlocks(el, style, item.blocks, columns - pad, new Map(), scoped, scopedFold)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

export type CopyButton = (text: string | (() => string), key: string, label?: string, html?: () => string) => RenderElement | null
export type Drawn = Map<number, { element?: RenderElement; art?: string; note?: string }>
export type Fold = (id: string, hidden: number, key: string) => { folded: boolean; element: RenderElement } | null

const NUMBER_AT = 10
const NUMBER_MAX = 400
const FOLD_AT = 30
const FOLD_SHOW = 20

const codeId = (lines: string[]): string => {
  let h = 5381
  for (const line of lines) for (let i = 0; i < line.length; i++) h = (h * 33 + line.charCodeAt(i)) | 0
  return `${lines.length}:${(h >>> 0).toString(36)}`
}

const copySource = (block: Block): string | undefined =>
  block.kind === 'code' ? block.lines.join('\n') : block.kind === 'table' || block.kind === 'list' ? block.raw : block.kind === 'quote' || block.kind === 'alert' ? block.raw.split('\n').map(line => line.replace(/^\s*>\s?/, '')).join('\n') : undefined

export const renderBlocks = (el: ElementTable, style: Style, blocks: Block[], columns: number, drawn: Drawn = new Map(), copy?: CopyButton, fold?: Fold): RenderElement[] => {
  const { Box, Text } = el
  const t = style.theme
  const rendered = blocks.map((block, b) => {
    const key = `b${b}`
    switch (block.kind) {
      case 'heading':
        return renderHeading(el, style, block, key)
      case 'paragraph':
        return renderParagraph(el, style, block, key)
      case 'quote':
        return renderQuote(el, style, block, key)
      case 'alert':
        return renderAlert(el, style, block, key)
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
        const rows = session
          ? lines.slice(0, shown).map((line, i) => sessionLine(el, style, line, `${key}.${i}`))
          : (isShellLang(block.lang) ? null : highlightBlock(el, style, lines, block.lang, key))?.slice(0, shown) ?? lines.slice(0, shown).map((line, i) => codeLine(el, style, line, block.lang, `${key}.${i}`))
        const gutter = String(lines.length).length
        const source = session ? sessionCommands(lines) : lines.join('\n')
        const body = lines.length < NUMBER_AT || lines.length > NUMBER_MAX ? rows : rows.map((row, i) => row.type === 'Text' ? <Box key={`n${i}`} flexDirection="row"><Text color={t.codeComment} dimColor>{`${String(i + 1).padStart(gutter)}  `}</Text>{row}</Box> : row)
        return (
          <Box key={key} flexDirection="column">
            {note ? <Text color={t.codeComment}>{note}</Text> : null}
            <Text color={t.codeComment}>{` ${block.lang || 'code'}`}</Text>
            <Box flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1}>
              <Box flexDirection="row" columnGap={2}>
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>{body}</Box>
                {copy?.(source, `copy${b}`) ?? null}
              </Box>
              {toggle?.element ?? null}
            </Box>
          </Box>
        )
      }
      case 'list':
        return renderList(el, style, block, columns, key, copy, fold)
      case 'table':
        return renderTable(el, style, block, columns, key)
      case 'notes':
        return (
          <Box key={key} flexDirection="column">
            <Text dimColor>{'─'.repeat(Math.min(columns, 12))}</Text>
            {block.notes.map((note, i) => <Text key={`${key}.${i}`} dimColor>{note.mark} {renderInline(el, style, note.inline, `${key}.${i}`)}</Text>)}
          </Box>
        )
    }
  })
  const copied = rendered.map((element, b) => {
    const block = blocks[b]
    const text = block ? copySource(block) : undefined
    const isPlainCode = block?.kind === 'code' && !drawn.get(b)?.element
    const art = drawn.get(b)?.art ?? (block?.kind === 'table' ? () => tableArt(block) : undefined)
    const first = text === undefined || isPlainCode ? null : copy?.(text, `copy${b}`, block?.kind === 'table' ? '⧉ md' : art === undefined ? undefined : '⧉ source')
    const second = first && art !== undefined ? copy?.(art, `art${b}`, '⧉ art') : null
    const html = first && block?.kind === 'table' ? copy?.(() => tableText(block), `html${b}`, '⧉ html', () => tableHtml(block)) : null
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
        <Box key={`c${b}`} flexDirection="column" alignSelf="flex-start">
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <el.Text color={style.theme.codeComment}>{` ${block.lang || 'diagram'}`}</el.Text>
            {button}
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor={style.theme.rule} paddingX={1}>
            {element}
          </Box>
        </Box>
      )
    }
    return block?.kind === 'quote' || block?.kind === 'alert' || block?.kind === 'list' ? (
      <Box key={`c${b}`} flexDirection="row" columnGap={2}>
        {element}
        {button}
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
