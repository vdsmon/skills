import type { ElementTable, RenderElement } from 'claude-code'

import type { Fold, Segment } from './blocks'
import { codeLine, highlightRows, isShellLang } from './blocks'
import { toolHref, toolPath } from './links'
import { CONTROL } from './markdown'
import type { Style, Theme } from './theme'
import { CLAUDE_DIFF } from './theme'

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

const renderClaudeDiff = (el: ElementTable, style: Style, path: string | undefined, rows: DiffLine[], shown: DiffLine[], budget: Budget): RenderElement[] => {
  const { Box, Text } = el
  const t = style.theme
  const c = isDark(t.codeText) ? CLAUDE_DIFF.dark : CLAUDE_DIFF.light
  const gutter = String(Math.max(0, ...shown.map(r => r.num))).length
  const painted = paintRows(style, shown, diffLang(path))
  const ranges = changedRanges(rows).slice(0, shown.length)
  return shown.flatMap((r, i) => {
    const gap = i > 0 && r.hunk !== shown[i - 1]!.hunk ? [<Text key={`gap${i}`} dimColor>...</Text>] : []
    if (r.mark === '\\') return [...gap, <Box key={`d${i}`} flexDirection="row"><Text>{' '.repeat(gutter + 3)}</Text><Text color={t.codeText}>{r.text}</Text></Box>]
    const bg = r.mark === '+' ? c.addBg : r.mark === '-' ? c.delBg : undefined
    const word = r.mark === '+' ? c.addWord : c.delWord
    const mark = r.mark === '+' ? c.addMark : r.mark === '-' ? c.delMark : c.number
    const plain: Segment = { text: r.text, color: t.codeText, italic: false }
    const marked = markRange(painted[i] ?? [plain], ranges[i])
    const segs = marked.length > 1 && !spend(budget, 2 * marked.length) ? [{ ...plain, hit: false }] : marked
    const one = segs.length === 1 && !segs[0]!.hit ? segs[0]! : undefined
    return [
      ...gap,
      <Box key={`d${i}`} flexDirection="row" {...(bg ? { backgroundColor: bg } : {})}>
        <Text color={mark}>{`${String(r.num).padStart(gutter)} ${r.mark} `}</Text>
        {one || segs.length === 0 ? (
          <Text color={one?.color ?? t.codeText} italic={one?.italic}>{one?.text || ' '}</Text>
        ) : (
          <Text color={t.codeText}>
            {segs.map((s, k) => <Text key={`d${i}.${k}`} color={s.color ?? t.codeText} italic={s.italic} {...(s.hit ? { backgroundColor: word } : {})}>{s.text}</Text>)}
          </Text>
        )}
      </Box>,
    ]
  })
}

const diffBox = (el: ElementTable, style: Style, path: string | undefined, rows: DiffLine[], fold: Fold, id: string, key: string, budget: Budget, title?: string): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const c = isDark(t.codeText) ? CLAUDE_DIFF.dark : CLAUDE_DIFF.light
  const added = rows.filter(r => r.mark === '+').length
  const removed = rows.filter(r => r.mark === '-').length
  const n = realLines(rows)
  const toggle = n > DIFF_LINES ? fold?.(id, n - DIFF_LINES, `fold${key}`) : null
  const shown = firstLines(rows, toggle?.folded === false ? DIFF_MAX : DIFF_LINES)
  const hidden = n - realLines(shown)
  return (
    <Box key={`card${key}`} flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1} flexShrink={1}>
      <Text>
        {title === undefined ? null : <Text color={t.path}>{linkedPath(el, style, title, path)} </Text>}
        <Text color={c.addMark} dimColor={added === 0}>{`+${added}`}</Text>
        <Text> </Text>
        <Text color={c.delMark} dimColor={removed === 0}>{`−${removed}`}</Text>
      </Text>
      {renderClaudeDiff(el, style, path, rows, shown, budget)}
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
const wholeCard = (el: ElementTable, style: Style, file: WholeFile, fold: Fold, id: string, key: string, budget: Budget, marked: boolean): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const n = file.lines.length
  const created = file.kind === 'created'
  const toggle = created ? (n > PREVIEW_LINES ? fold?.(id, n - PREVIEW_LINES, `fold${key}`) : null) : n > 0 ? fold?.(id, n, `fold${key}`, `show ${lineCount(n)}`) : null
  const shown = Math.min(n, toggle?.folded === false ? DIFF_MAX : created ? PREVIEW_LINES : 0)
  const rest = n > shown && (toggle ? !toggle.folded : created)
  const head = (
    <Text key="head">
      {created ? 'Created ' : 'Deleted '}
      <Text color={t.path}>{linkedPath(el, style, shortPath(style, file.path), file.path)}</Text>
      <Text dimColor>{` (${lineCount(n)})`}</Text>
    </Text>
  )
  if (shown === 0) return <Box key={`file${key}`} flexDirection="column" alignItems="flex-start">{head}{toggle?.element ?? null}</Box>
  const mark = !marked ? ' ' : created ? '+' : '-'
  const rows = file.lines.slice(0, shown).map((text, i): DiffLine => ({ mark, num: i + 1, text, hunk: 0 }))
  return (
    <Box key={`file${key}`} flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1} flexShrink={1}>
      {head}
      {renderClaudeDiff(el, style, file.path, rows, rows, budget)}
      {rest ? <Text dimColor>{`… +${n - shown} lines`}</Text> : null}
      {toggle?.element ?? null}
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
export const renderDiffCard = (el: ElementTable, style: Style, output: unknown, fold: Fold, id: string): RenderElement | undefined => {
  if (output === null || typeof output !== 'object' || (output as { staged?: unknown }).staged === true) return undefined
  const budget = { left: DIFF_EXTRA }
  const write = written(output)
  if (write) return diffRow(el, [wholeCard(el, style, write, fold, id, '', budget, false)], false)
  const rows = diffLines(output)
  if (rows === undefined) return undefined
  const made = editedIntoBeing(output, rows)
  const path = (output as { filePath?: unknown }).filePath
  return diffRow(el, [made ? wholeCard(el, style, made, fold, id, '', budget, true) : diffBox(el, style, typeof path === 'string' ? path : undefined, rows, fold, id, '', budget)], false)
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

export const renderBashEdits = (el: ElementTable, style: Style, edits: BashEdits, fold: Fold, id: string, below = false, notes: readonly string[] = []): RenderElement => {
  const budget = { left: DIFF_EXTRA }
  const cards = edits.files.map((file, i) =>
    file.kind === 'modified' ? diffBox(el, style, file.path, file.rows, fold, `${id}:${i}`, String(i), budget, shortPath(style, file.path))
    : file.kind === 'renamed' ? renamedLine(el, style, file.path, file.to, String(i))
    : wholeCard(el, style, file, fold, `${id}:${i}`, String(i), budget, true))
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
