import type { ElementTable, RenderElement } from 'claude-code'

import type { Fold, Segment } from './blocks'
import { codeLine, highlightRows, isShellLang } from './blocks'
import { toolHref, toolPath } from './links'
import { CONTROL } from './markdown'
import type { Style, Theme } from './theme'
import { CLAUDE_DIFF, PREVIEW_BAND } from './theme'
import { graphemes, width } from './text'

export type ToolRow = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

const VERBS: Record<string, string> = {
  Bash: 'Ran', PowerShell: 'Ran', Read: 'Read', Write: 'Wrote', Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited',
  Grep: 'Searched', Glob: 'Listed', WebFetch: 'Fetched', WebSearch: 'Searched the web for', Agent: 'Delegated', Task: 'Delegated',
}

const field = (input: unknown, ...keys: string[]): string | undefined => {
  if (input === null || typeof input !== 'object') return undefined
  for (const k of keys) {
    const v = (input as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

const TARGET_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description']

const statusColor = (t: Theme, row: ToolRow) =>
  row.isErrored ? t.error : row.isInterrupted ? t.codeComment : row.isRunning ? t.accent : t.success

const TREE_MARK = '└─'

const toolGutter = ({ Box, Text }: ElementTable, color: string | undefined) =>
  <Box width={TREE_MARK.length + 3} flexShrink={0}><Text color={color} bold>{`  ${TREE_MARK} `}</Text></Box>

const toolLayout = (el: ElementTable, color: string | undefined, text: RenderElement) => {
  const { Box } = el
  return <Box flexDirection="row">{toolGutter(el, color)}{text}</Box>
}

type Places = Pick<Style, 'cwd' | 'home'>

const slashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const folded = (path: string): string => (/^[a-z]:(\/|$)/i.test(path) ? path.toLowerCase() : path)

export const shortPath = (style: Places, path: string): string => {
  const target = folded(slashes(path))
  for (const [root, home] of [[style.cwd, false], [style.home, true]] as const) {
    const base = folded(slashes(root))
    if (base !== '' && target.startsWith(`${base}/`)) return home ? `~${path.slice(base.length)}` : path.slice(base.length + 1)
  }
  return path
}

const PATH_FIELDS = ['file_path', 'notebook_path', 'path']

const targetOf = (style: Style, input: unknown, fields: string[]): { target?: string; path?: string } => {
  const target = field(input, ...fields)
  const path = target !== undefined && PATH_FIELDS.some(k => field(input, k) === target) ? target : undefined
  return { target: path === undefined ? target : shortPath(style, path), path }
}

// The short text stays the label, so widths and truncation are unchanged; the href opens the whole path.
const linkedPath = (el: ElementTable, style: Style, text: string, path: string | undefined): string | RenderElement => {
  const href = path === undefined ? undefined : toolHref(style, path)
  return href === undefined ? text : <el.Link key="path" href={href} label={text} />
}

const DIFF_LINES = 20
const DIFF_MAX = 400
// Claude Code draws its own diff once a tool result's tree passes 20000 nodes, so highlighting and
// word marks spend at most this many nodes over the plain rows, shared by every card of one result.
const DIFF_EXTRA = 5000
const PREVIEW_LINES = 10

type DiffLine = { mark: '+' | '-' | ' ' | '\\'; num: number; text: string; hunk: number }

type Budget = { left: number }

const spend = (budget: Budget, cost: number): boolean => {
  if (budget.left < cost) return false
  budget.left -= cost
  return true
}

const HEX = /^#[0-9a-f]{6}$/i

const isDark = (hex: string | undefined): boolean => {
  if (!hex || !HEX.test(hex)) return true
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 128
}

const lines = (value: unknown): string[] => (typeof value === 'string' && value !== '' ? value.replace(/\n$/, '').split('\n') : [])

export const diffLines = (output: unknown): DiffLine[] | undefined => {
  if (output === null || typeof output !== 'object') return undefined
  const out = output as { structuredPatch?: unknown }
  if (!Array.isArray(out.structuredPatch) || out.structuredPatch.length === 0) return undefined
  const rows: DiffLine[] = []
  for (const [h, hunk] of (out.structuredPatch as { oldStart?: unknown; newStart?: unknown; lines?: unknown }[]).entries()) {
    if (typeof hunk?.oldStart !== 'number' || typeof hunk.newStart !== 'number' || !Array.isArray(hunk.lines)) return undefined
    rows.push(...hunkRows(hunk.lines, hunk.oldStart, hunk.newStart, h))
  }
  return rows
}

// A "\ No newline at end of file" marker keeps a row of its own, numbered 0 and counted as no line.
const hunkRows = (lines: unknown[], oldStart: number, newStart: number, hunk: number): DiffLine[] => {
  const rows: DiffLine[] = []
  let [o, n] = [oldStart, newStart]
  for (const l of lines) {
    if (typeof l !== 'string') continue
    const mark = (l[0] === '+' || l[0] === '-' || l[0] === '\\' ? l[0] : ' ') as DiffLine['mark']
    let num = 0
    if (mark === '-') num = o++
    else if (mark !== '\\') {
      if (mark === ' ') o++
      num = n++
    }
    rows.push({ mark, num, text: l.slice(1).replace(CONTROL, ''), hunk })
  }
  return rows
}

const realLines = (rows: DiffLine[]): number => rows.filter(r => r.mark !== '\\').length

const firstLines = (rows: DiffLine[], count: number): DiffLine[] => {
  let [end, seen] = [0, 0]
  while (end < rows.length && (rows[end]!.mark === '\\' || seen < count)) if (rows[end++]!.mark !== '\\') seen++
  return rows.slice(0, end)
}

const EXT_LANGS: Record<string, string> = {
  py: 'python', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', go: 'go', rs: 'rust', rb: 'ruby', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', css: 'css', html: 'html', xml: 'xml', svg: 'svg',
  sql: 'sql', tf: 'hcl', hcl: 'hcl', sh: 'bash', bash: 'bash', zsh: 'bash',
}

export const diffLang = (path: unknown): string | undefined => {
  if (typeof path !== 'string') return undefined
  const name = path.split(/[\\/]/).pop() ?? ''
  if (/^dockerfile$/i.test(name)) return 'docker'
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()
  return ext === undefined ? undefined : EXT_LANGS[ext]
}

// Removed and added runs pair up in order within a hunk, across a no-newline marker between them.
const runOf = (rows: readonly DiffLine[], from: number, mark: '+' | '-'): number[] => {
  const at: number[] = []
  const hunk = rows[from]?.hunk
  for (let i = from; i < rows.length && rows[i]!.hunk === hunk && (rows[i]!.mark === mark || rows[i]!.mark === '\\'); i++) if (rows[i]!.mark === mark) at.push(i)
  return at
}

export const changedRanges = (rows: readonly DiffLine[]): ([number, number] | undefined)[] => {
  const ranges: ([number, number] | undefined)[] = rows.map(() => undefined)
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.mark !== '-') {
      i++
      continue
    }
    const dels = runOf(rows, i, '-')
    i = dels.at(-1)! + 1
    while (rows[i]?.mark === '\\') i++
    const adds = rows[i]?.hunk === rows[dels[0]!]!.hunk ? runOf(rows, i, '+') : []
    if (adds.length) i = adds.at(-1)! + 1
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const a = rows[dels[k]!]!.text
      const b = rows[adds[k]!]!.text
      let head = 0
      while (head < a.length && head < b.length && a[head] === b[head]) head++
      let tail = 0
      while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
      if (head === 0 && tail === 0) continue
      if (a.length - tail > head) ranges[dels[k]!] = [head, a.length - tail]
      if (b.length - tail > head) ranges[adds[k]!] = [head, b.length - tail]
    }
  }
  return ranges
}

const markRange = (segs: readonly Segment[], range: [number, number] | undefined): (Segment & { hit: boolean })[] => {
  const out: (Segment & { hit: boolean })[] = []
  let at = 0
  for (const seg of segs) {
    const start = at
    at += seg.text.length
    if (!range || at <= range[0] || start >= range[1]) {
      out.push({ ...seg, hit: false })
      continue
    }
    const cuts = [start, Math.max(start, range[0]), Math.min(at, range[1]), at]
    for (let c = 0; c < 3; c++) {
      const piece = seg.text.slice(cuts[c]! - start, cuts[c + 1]! - start)
      if (piece) out.push({ ...seg, text: piece, hit: c === 1 })
    }
  }
  return out
}

// Each hunk's new side is highlighted as one text, so a comment or string spanning lines keeps its
// color and one hunk's open string cannot color the next. Removed lines stay plain, as in Claude Code.
const paintRows = (style: Style, rows: readonly DiffLine[], lang: string | undefined): (Segment[] | undefined)[] => {
  const out: (Segment[] | undefined)[] = rows.map(() => undefined)
  if (lang === undefined || isShellLang(lang)) return out
  for (const hunk of new Set(rows.map(r => r.hunk))) {
    const at = rows.flatMap((r, i) => (r.hunk === hunk && (r.mark === ' ' || r.mark === '+') ? [i] : []))
    const painted = highlightRows(style, at.map(i => rows[i]!.text), lang)
    if (painted) at.forEach((i, k) => (out[i] = painted[k]))
  }
  return out
}

type Piece = Segment & { hit: boolean }

const TAB = 8

// Tabs draw as spaces to the next stop of 8, as Claude Code draws them, so row widths add up.
const tabbed = (pieces: Piece[]): Piece[] => {
  let col = 0
  return pieces.map(p => {
    if (!p.text.includes('\t')) {
      col += width(p.text)
      return p
    }
    let text = ''
    for (const g of graphemes(p.text)) {
      const step = g === '\t' ? TAB - (col % TAB) : width(g)
      text += g === '\t' ? ' '.repeat(step) : g
      col += step
    }
    return { ...p, text }
  })
}

// A row fills to its last cell and breaks after a space where it can, inside a word wider than the row where it must.
const rowStarts = (text: string, room: number): number[] => {
  const starts = [0]
  let [used, at, space, seen] = [0, 0, -1, false]
  for (const g of /^[ -~]*$/.test(text) ? text : graphemes(text)) {
    const step = width(g)
    const from = starts[starts.length - 1]!
    const blank = /\s/.test(g)
    if (used + step > room && at > from) {
      const cut = blank || space <= from ? at : space
      starts.push(cut)
      used = width(text.slice(cut, at))
      seen = /\S/.test(text.slice(cut, at))
      space = -1
    }
    at += g.length
    used += step
    if (!blank) seen = true
    else if (seen) space = at
  }
  return starts
}

const splitRows = (pieces: Piece[], starts: number[]): Piece[][] => {
  const rows: Piece[][] = starts.map(() => [])
  let [at, r] = [0, 0]
  for (const p of pieces) {
    for (let from = 0; from < p.text.length; ) {
      while (r + 1 < starts.length && starts[r + 1]! <= at + from) r++
      const end = Math.min(p.text.length, (starts[r + 1] ?? Infinity) - at)
      rows[r]!.push({ ...p, text: p.text.slice(from, end) })
      from = end
    }
    at += p.text.length
  }
  return rows
}

const DIFF_ROOM = 8

const visualRows = (pieces: Piece[], room: number | undefined): Piece[][] => {
  const text = pieces.map(p => p.text).join('')
  return room === undefined || room < DIFF_ROOM || width(text) <= room ? [pieces] : splitRows(pieces, rowStarts(text, room))
}

type Shaped = { r: DiffLine; i: number; parts: Piece[][]; gap: boolean }

type Shape = { gutter: number; room: number | undefined; lines: Shaped[] }

const isPlain = (part: Piece[]): boolean => part.length <= 1 && !part[0]?.hit

// A row's Box, its prefix Text and string, and its code Text and string.
const ROW_NODES = 5
// A row drawn as Text inside a press adds its newline and its padding.
const TEXT_ROW = 2

const partCost = (part: Piece[]): number => (isPlain(part) ? 0 : 2 * part.length)

// A line past the node allowance draws as one plain row, which the plain card already paid for.
const afforded = (line: Shaped, budget: Budget, row: number): Shaped => {
  if (line.r.mark === '\\' || spend(budget, line.parts.reduce((n, part, k) => n + (k ? ROW_NODES : 0) + row + partCost(part), 0))) return line
  return { ...line, parts: [[{ text: line.r.text, italic: false, hit: false }]] }
}

// The room left for code after the row prefix, the card frame and the line's number and mark.
const shapeRows = (style: Style, path: string | undefined, rows: DiffLine[], shown: DiffLine[], columns: number | undefined, budget: Budget, row: number): Shape => {
  const gutter = String(Math.max(0, ...shown.map(r => r.num))).length
  const room = columns === undefined ? undefined : columns - 5 - 4 - gutter - 3
  const painted = paintRows(style, shown, diffLang(path))
  const ranges = changedRanges(rows).slice(0, shown.length)
  const lines = shown.map((r, i) => {
    const plain: Segment = { text: r.text, italic: false }
    const parts = r.mark === '\\' ? [[{ ...plain, hit: false }]] : visualRows(tabbed(markRange(painted[i] ?? [plain], ranges[i])), room)
    return afforded({ r, i, parts, gap: i > 0 && r.hunk !== shown[i - 1]!.hunk }, budget, row)
  })
  return { gutter, room, lines }
}

const lineLook = (style: Style, r: DiffLine) => {
  const c = isDark(style.theme.codeText) ? CLAUDE_DIFF.dark : CLAUDE_DIFF.light
  return {
    bg: r.mark === '+' ? c.addBg : r.mark === '-' ? c.delBg : undefined,
    word: r.mark === '+' ? c.addWord : c.delWord,
    mark: r.mark === '+' ? c.addMark : r.mark === '-' ? c.delMark : c.number,
  }
}

// Only a line's first row carries its number; every row repeats its mark and tint.
const prefixOf = (gutter: number, r: DiffLine, k: number): string =>
  r.mark === '\\' ? ' '.repeat(gutter + 3) : `${k ? ' '.repeat(gutter) : String(r.num).padStart(gutter)} ${r.mark} `

const codeOf = ({ Text }: ElementTable, style: Style, part: Piece[], word: string, key: string, on: { backgroundColor?: string }): RenderElement => {
  const code = style.theme.codeText
  if (isPlain(part)) return <Text key={key} color={part[0]?.color ?? code} italic={part[0]?.italic} {...on}>{part[0]?.text || ' '}</Text>
  return (
    <Text key={key} color={code} {...on}>
      {part.map((s, k) => <Text key={`${key}.${k}`} color={s.color ?? code} italic={s.italic} {...(s.hit ? { backgroundColor: word } : {})}>{s.text}</Text>)}
    </Text>
  )
}

const gapRow = ({ Text }: ElementTable, key: string): RenderElement => <Text key={key} dimColor>...</Text>

const boxRows = (el: ElementTable, style: Style, { gutter, lines }: Shape): RenderElement[] =>
  lines.flatMap(({ r, i, parts, gap }) => {
    const { bg, word, mark } = lineLook(style, r)
    return [
      ...(gap ? [gapRow(el, `gap${i}`)] : []),
      ...parts.map((part, k) => (
        <el.Box key={k ? `d${i}.${k}` : `d${i}`} flexDirection="row" {...(bg ? { backgroundColor: bg } : {})}>
          <el.Text color={mark}>{prefixOf(gutter, r, k)}</el.Text>
          {codeOf(el, style, part, word, `d${i}.${k}.c`, {})}
        </el.Box>
      )),
    ]
  })

// Inside a press the rows are one Text, so each tinted row is padded to the widest row to read as a band.
// With no known width, or too little room, no row is padded: padding to the longest line would wrap every row.
const textRows = (el: ElementTable, style: Style, { gutter, room, lines }: Shape): RenderElement => {
  const { Text } = el
  const lead = gutter + 3
  const used = (part: Piece[]) => lead + (part.length ? width(part.map(p => p.text).join('')) : 1)
  const span = room !== undefined && room >= DIFF_ROOM ? Math.max(0, ...lines.flatMap(l => l.parts.map(used))) : 0
  const rows = lines.flatMap(({ r, i, parts, gap }) => {
    const { bg, word, mark } = lineLook(style, r)
    const on = bg ? { backgroundColor: bg } : {}
    return [
      ...(gap ? [[gapRow(el, `t${i}.g`)]] : []),
      ...parts.map((part, k) => [
        <Text key={`t${i}.${k}.n`} color={mark} {...on}>{prefixOf(gutter, r, k)}</Text>,
        codeOf(el, style, part, word, `t${i}.${k}.c`, on),
        ...(bg && span > used(part) ? [<Text key={`t${i}.${k}.p`} {...on}>{' '.repeat(span - used(part))}</Text>] : []),
      ]),
    ]
  })
  return <Text key="rows">{rows.flatMap((row, n) => (n ? ['\n', ...row] : row))}</Text>
}

// From Claude Code 2.1.295 on the terminal, a folded card opens and closes with a click anywhere on it.
const diffBox = (el: ElementTable, style: Style, path: string | undefined, rows: DiffLine[], fold: Fold, id: string, key: string, budget: Budget, columns: number | undefined, title?: string): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const c = isDark(t.codeText) ? CLAUDE_DIFF.dark : CLAUDE_DIFF.light
  const added = rows.filter(r => r.mark === '+').length
  const removed = rows.filter(r => r.mark === '-').length
  const n = realLines(rows)
  const toggle = n > DIFF_LINES ? fold?.(id, n - DIFF_LINES, `fold${key}`) : null
  const shown = firstLines(rows, toggle?.folded === false ? DIFF_MAX : DIFF_LINES)
  const hidden = n - realLines(shown)
  const press = toggle?.around
  const head = (
    <Text key="head">
      {title === undefined ? null : <Text color={t.path}>{press ? title : linkedPath(el, style, title, path)} </Text>}
      <Text color={c.addMark} dimColor={added === 0}>{`+${added}`}</Text>
      <Text> </Text>
      <Text color={c.delMark} dimColor={removed === 0}>{`−${removed}`}</Text>
    </Text>
  )
  return (
    <Box key={`card${key}`} flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1} flexShrink={1}>
      {press
        ? press(<Text key="all">{head}{'\n'}{textRows(el, style, shapeRows(style, path, rows, shown, columns, budget, TEXT_ROW))}</Text>)
        : [head, ...boxRows(el, style, shapeRows(style, path, rows, shown, columns, budget, 0))]}
      {hidden > 0 && toggle?.folded !== true ? <Text dimColor>{`… +${hidden} lines`}</Text> : null}
      {toggle?.element ?? null}
    </Box>
  )
}

type WholeFile = { kind: 'created' | 'deleted'; path: string; lines: string[] }

export type FileChange = { kind: 'modified'; path: string; rows: DiffLine[] } | WholeFile | { kind: 'renamed'; path: string; to: string }

const lineCount = (n: number): string => (n === 0 ? 'empty' : `${n} ${n === 1 ? 'line' : 'lines'}`)

// A new file shows its first 10 lines and a deleted one only its header; either opens to 400 lines.
// Unmarked rows are Write's preview: numbered code with no diff marks, as Claude Code draws it.
// With a press, a new file opens from a click anywhere on it, and a deleted file's header is its button.
const wholeCard = (el: ElementTable, style: Style, file: WholeFile, fold: Fold, id: string, key: string, budget: Budget, columns: number | undefined, marked: boolean): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const n = file.lines.length
  const created = file.kind === 'created'
  const head = (linked: boolean) => (
    <Text key="head">
      {created ? 'Created ' : 'Deleted '}
      <Text color={t.path}>{linked ? linkedPath(el, style, shortPath(style, file.path), file.path) : shortPath(style, file.path)}</Text>
      <Text dimColor>{` (${lineCount(n)})`}</Text>
    </Text>
  )
  const toggle = created ? (n > PREVIEW_LINES ? fold?.(id, n - PREVIEW_LINES, `fold${key}`) : null) : n > 0 ? fold?.(id, n, `fold${key}`, { label: `show ${lineCount(n)}`, face: () => head(false) }) : null
  const shown = Math.min(n, toggle?.folded === false ? DIFF_MAX : created ? PREVIEW_LINES : 0)
  const rest = n > shown && (toggle ? !toggle.folded : created)
  const top = toggle?.faced ? toggle.element : head(!toggle?.around)
  const tail = toggle && !toggle.faced ? toggle.element : null
  if (shown === 0) return <Box key={`file${key}`} flexDirection="column" alignItems="flex-start">{top}{tail}</Box>
  const mark = !marked ? ' ' : created ? '+' : '-'
  const lines = file.lines.slice(0, shown).map((text, i): DiffLine => ({ mark, num: i + 1, text, hunk: 0 }))
  const press = toggle?.around
  const band = marked ? undefined : PREVIEW_BAND
  const body = press
    ? created
      ? press(<Text key="all">{head(false)}{'\n'}{textRows(el, style, shapeRows(style, file.path, lines, lines, columns, budget, TEXT_ROW))}</Text>, band)
      : [top, press(textRows(el, style, shapeRows(style, file.path, lines, lines, columns, budget, TEXT_ROW)), band)]
    : [top, ...boxRows(el, style, shapeRows(style, file.path, lines, lines, columns, budget, 0))]
  return (
    <Box key={`file${key}`} flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1} flexShrink={1}>
      {body}
      {rest ? <Text dimColor>{`… +${n - shown} lines`}</Text> : null}
      {tail}
    </Box>
  )
}

const renamedLine = ({ Text }: ElementTable, style: Style, from: string, to: string, key: string): RenderElement => (
  <Text key={`file${key}`}>
    {'Renamed '}
    <Text color={style.theme.path}>{shortPath(style, from)}</Text>
    {' → '}
    <Text color={style.theme.path}>{shortPath(style, to)}</Text>
  </Text>
)

const diffRow = ({ Box, Text }: ElementTable, cards: RenderElement[], below: boolean): RenderElement => (
  <Box flexDirection="row">
    <Text dimColor bold>{below ? '     ' : `  ${TREE_MARK}`.padEnd(5)}</Text>
    <Box flexDirection="column" flexShrink={1} alignItems="flex-start">{cards}</Box>
  </Box>
)

// An Edit with an empty old_string on a new or empty file is how Claude Code creates a file with Edit.
const editedIntoBeing = (output: unknown, rows: DiffLine[]): WholeFile | undefined => {
  const out = output as { filePath?: unknown; oldString?: unknown; originalFile?: unknown }
  const fresh = out.oldString === '' && (out.originalFile === null || out.originalFile === '') && rows.every(r => r.mark === '+' || r.mark === '\\')
  return fresh && typeof out.filePath === 'string' ? { kind: 'created', path: out.filePath, lines: rows.filter(r => r.mark === '+').map(r => r.text) } : undefined
}

const written = (output: unknown): WholeFile | undefined => {
  const out = output as { type?: unknown; filePath?: unknown; content?: unknown }
  return out.type === 'create' && typeof out.filePath === 'string' && typeof out.content === 'string' ? { kind: 'created', path: out.filePath, lines: lines(out.content.replace(CONTROL, '')) } : undefined
}

// A write held for review goes to Claude Code, so its "Staged for your review" line stays.
export const renderDiffCard = (el: ElementTable, style: Style, output: unknown, fold: Fold, id: string, columns?: number): RenderElement | undefined => {
  if (output === null || typeof output !== 'object' || (output as { staged?: unknown }).staged === true) return undefined
  const budget = { left: DIFF_EXTRA }
  const write = written(output)
  if (write) return diffRow(el, [wholeCard(el, style, write, fold, id, '', budget, columns, false)], false)
  const rows = diffLines(output)
  if (rows === undefined) return undefined
  const made = editedIntoBeing(output, rows)
  const path = (output as { filePath?: unknown }).filePath
  return diffRow(el, [made ? wholeCard(el, style, made, fold, id, '', budget, columns, true) : diffBox(el, style, typeof path === 'string' ? path : undefined, rows, fold, id, '', budget, columns)], false)
}

export type BashEdits = { files: FileChange[]; more: number; shared: boolean }

export const EDIT_NOTES = {
  first: 'every file that changed while this ran, by this command or anything else: a view of the changes, not an audit of the command',
  shared: 'another command ran in this repository at the same time, so changes by either may show under either one',
  tree: 'a git step in this command can move the working tree, so these may be its changes rather than edits',
} as const

// A Bash result carries the per-file hunks Claude Code draws a shell edit from, in Edit's structuredPatch shape.
export const bashEdits = (output: unknown): BashEdits | undefined => {
  if (output === null || typeof output !== 'object') return undefined
  const diff = (output as { bashEditDiff?: unknown }).bashEditDiff
  if (diff === null || typeof diff !== 'object') return undefined
  const { files, moreFiles, shared } = diff as { files?: unknown; moreFiles?: unknown; shared?: unknown }
  if (!Array.isArray(files) || files.length === 0) return undefined
  const changed = files.map(fileChange)
  if (!changed.every((f): f is FileChange => f !== undefined)) return undefined
  return { files: renamed(changed), more: typeof moreFiles === 'number' && moreFiles > 0 ? moreFiles : 0, shared: shared === true }
}

// Claude Code flags the files a command created and deleted, and sends an empty file with no hunks.
const fileChange = (entry: unknown): FileChange | undefined => {
  const file = entry as { filePath?: unknown; hunks?: unknown; created?: unknown; deleted?: unknown } | null
  const kind = file?.created === true ? 'created' : file?.deleted === true ? 'deleted' : 'modified'
  const rows = kind !== 'modified' && Array.isArray(file?.hunks) && file.hunks.length === 0 ? [] : diffLines({ structuredPatch: file?.hunks })
  if (typeof file?.filePath !== 'string' || rows === undefined) return undefined
  if (kind === 'modified') return { kind, path: file.filePath, rows }
  const mark = kind === 'created' ? '+' : '-'
  return { kind, path: file.filePath, lines: rows.filter(r => r.mark === mark).map(r => r.text) }
}

// Empty files never pair, so `rm a/__init__.py; touch b/__init__.py` does not read as a rename.
const pairable = (file: FileChange): file is WholeFile => (file.kind === 'created' || file.kind === 'deleted') && file.lines.length > 0

const sameLines = (a: string[], b: string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i])

// A move reaches bashEditDiff as a deleted file and a created file with the same lines.
const renamed = (files: FileChange[]): FileChange[] => {
  const paired = new Set<FileChange>()
  const out: FileChange[] = []
  for (const file of files) {
    if (paired.has(file)) continue
    const twin = pairable(file) ? files.find((other): other is WholeFile => !paired.has(other) && pairable(other) && other.kind !== file.kind && sameLines(other.lines, file.lines)) : undefined
    if (!twin) {
      out.push(file)
      continue
    }
    paired.add(file).add(twin)
    const [from, to] = file.kind === 'deleted' ? [file, twin] : [twin, file]
    out.push({ kind: 'renamed', path: from.path, to: to.path })
  }
  return out
}

export const withoutBashEdits = (output: unknown): unknown => {
  if (output === null || typeof output !== 'object') return output
  const { bashEditDiff: _, ...rest } = output as Record<string, unknown>
  return rest
}

export const hasShellOutput = (output: unknown): boolean => {
  const out = output !== null && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  return lines(out.stdout).length + lines(out.stderr).length > 0
}

export const renderBashEdits = (el: ElementTable, style: Style, edits: BashEdits, fold: Fold, id: string, below = false, notes: readonly string[] = [], columns?: number): RenderElement => {
  const budget = { left: DIFF_EXTRA }
  const cards = edits.files.map((file, i) =>
    file.kind === 'modified' ? diffBox(el, style, file.path, file.rows, fold, `${id}:${i}`, String(i), budget, columns, shortPath(style, file.path))
    : file.kind === 'renamed' ? renamedLine(el, style, file.path, file.to, String(i))
    : wholeCard(el, style, file, fold, `${id}:${i}`, String(i), budget, columns, true))
  const more = edits.more ? [<el.Text key="more" dimColor>{`… +${edits.more} more ${edits.more === 1 ? 'file' : 'files'}`}</el.Text>] : []
  const said = notes.map((note, i) => <el.Text key={`note${i}`} dimColor>{`(${note})`}</el.Text>)
  return diffRow(el, [...cards, ...more, ...said], below)
}

const TREE_MOVER = /(^|[;&|(]\s*|\bsudo\s+)(?:\w+=\S*\s+)*git\s+(?:(?:-C|-c)\s+\S+\s+|--?[\w-]+(?:=\S+)?\s+)*(checkout|switch|stash|pull|merge|rebase|reset|restore|clean|cherry-pick|revert)\b/

export const movesTree = (command: string): boolean => TREE_MOVER.test(command)

export const editNotes = (edits: BashEdits, first: boolean, command?: string): string[] => [
  ...(first ? [EDIT_NOTES.first] : []),
  ...(edits.shared ? [EDIT_NOTES.shared] : []),
  ...(command !== undefined && movesTree(command) ? [EDIT_NOTES.tree] : []),
]

export const renderToolRow = (el: ElementTable, style: Style, row: ToolRow): RenderElement => {
  const { Text } = el
  const t = style.theme
  const isShell = row.tool === 'Bash' || row.tool === 'PowerShell'
  const verb = VERBS[row.tool] ?? row.tool.replace(/^mcp__([^_]+)__/, '$1 ')
  const found: { target?: string; path?: string } = isShell ? { target: field(row.input, 'command')?.split('\n')[0] } : targetOf(style, row.input, TARGET_FIELDS)
  const target = found.target
  const dot = statusColor(t, row)
  const isPath = target !== undefined && (found.path !== undefined || /^(~|\.{0,2}\/|[A-Za-z]:\\)/.test(target))
  return toolLayout(el, dot, (
      <Text wrap="truncate-end" dimColor>
        <Text bold={false} dimColor>{verb}</Text>
        {target === undefined ? null : <Text> </Text>}
        {target === undefined ? null : isShell ? codeLine(el, style, target, 'bash', 'cmd') : <Text color={isPath ? t.path : t.inlineCode} dimColor>{linkedPath(el, style, target, toolPath(row.tool, found.path))}</Text>}
        {row.isInterrupted ? <Text dimColor> interrupted</Text> : row.isErrored ? <Text color={t.error}> failed</Text> : null}
      </Text>
  ))
}

const OUTPUT_LINES = 120

export const renderExpandedShell = (el: ElementTable, style: Style, row: ToolRow & { output?: unknown }): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const command = (field(row.input, 'command') ?? '').split('\n')
  const out = row.output !== null && typeof row.output === 'object' ? (row.output as Record<string, unknown>) : {}
  const stdout = lines(out.stdout)
  const stderr = lines(out.stderr)
  const shown = [...stdout.map(text => ({ text, color: undefined as string | undefined })), ...stderr.map(text => ({ text, color: t.error as string | undefined }))]
  const visible = shown.slice(0, OUTPUT_LINES)
  const dot = statusColor(t, row)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={dot}>{row.isRunning ? '◌' : '●'}</Text>
        </Box>
        <Box flexDirection="column">
          {command.map((line, i) => (
            <Text key={`c${i}`}>
              {i === 0 ? <Text bold>{`${row.tool}(`}</Text> : null}
              {codeLine(el, style, line, 'bash', `cmd${i}`)}
              {i === command.length - 1 ? <Text bold>)</Text> : null}
            </Text>
          ))}
        </Box>
      </Box>
      {row.isRunning ? null : (
        <Box paddingLeft={2}>
          <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={t.rule} paddingX={1}>
            {visible.length === 0 ? <Text dimColor>(No output)</Text> : visible.map((l, i) => <Text key={`o${i}`} color={l.color}>{l.text === '' ? ' ' : l.text}</Text>)}
            {shown.length > visible.length ? <Text dimColor>{`… +${shown.length - visible.length} lines`}</Text> : null}
          </Box>
        </Box>
      )}
    </Box>
  )
}

const GROUPS: [RegExp, string, string][] = [
  [/^(Bash|PowerShell)$/, 'ran', 'command'],
  [/^Read$/, 'read', 'file'],
  [/^(Write|Edit|MultiEdit|NotebookEdit)$/, 'edited', 'file'],
  [/^(Grep|Glob)$/, 'searched', 'pattern'],
  [/^(WebFetch|WebSearch)$/, 'fetched', 'page'],
  [/^(Agent|Task)$/, 'delegated', 'task'],
]

export const groupSummary = (calls: readonly { tool: string }[]): string => {
  const counts = new Map<string, number>()
  for (const call of calls) {
    const [, verb, noun] = GROUPS.find(([re]) => re.test(call.tool)) ?? [, 'used', call.tool.replace(/^mcp__([^_]+)__/, '$1 ')]
    const label = `${verb} ${noun}`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const parts = [...counts].map(([label, n]) => {
    const [verb, ...noun] = label.split(' ')
    const name = noun.join(' ')
    return `${verb} ${n} ${n === 1 ? name : name.endsWith('h') ? `${name}es` : `${name}s`}`
  })
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const renderToolGroup = (el: ElementTable, style: Style, calls: readonly (ToolRow & { output?: unknown })[], isActive: boolean): RenderElement => {
  const { Text } = el
  const t = style.theme
  const failed = calls.filter(c => c.isErrored).length
  const running = isActive && calls.some(c => c.isRunning)
  const dot = failed ? t.error : running ? t.accent : t.success
  const last = calls[calls.length - 1]
  const lastFound = last ? targetOf(style, last.input, ['command', ...TARGET_FIELDS]) : {}
  const lastTarget = lastFound.target?.split('\n')[0]
  const lastLink = lastTarget ? linkedPath(el, style, lastTarget, toolPath(last?.tool, lastFound.path)) : undefined
  const summary = groupSummary(calls)
  return toolLayout(el, dot, (
      <Text wrap="truncate-end" dimColor>
        <Text bold={false} dimColor>{summary}</Text>
        {failed ? <Text color={t.error}>{` · ${failed} failed`}</Text> : null}
        {lastLink === undefined ? null : <Text dimColor>{typeof lastLink === 'string' ? ` · last: ${lastLink}` : [' · last: ', lastLink]}</Text>}
      </Text>
  ))
}
