import type { ElementTable, RenderElement } from 'claude-code'

import type { Fold, Segment } from './blocks'
import { codeLine, highlightRows, isShellLang } from './blocks'
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
  row.isErrored ? t.codeFlag : row.isInterrupted ? t.codeComment : row.isRunning ? t.accent : t.number

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

const targetOf = (style: Style, input: unknown, fields: string[]): { target?: string; isPathField: boolean } => {
  const target = field(input, ...fields)
  const isPathField = target !== undefined && PATH_FIELDS.some(k => field(input, k) === target)
  return { target: isPathField ? shortPath(style, target!) : target, isPathField }
}

const DIFF_LINES = 20
const DIFF_MAX = 400

type DiffLine = { mark: '+' | '-' | ' '; num: number; text: string }

const HEX = /^#[0-9a-f]{6}$/i

const isDark = (hex: string | undefined): boolean => {
  if (!hex || !HEX.test(hex)) return true
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 128
}

const lines = (value: unknown): string[] => (typeof value === 'string' && value !== '' ? value.replace(/\n$/, '').split('\n') : [])

export const diffLines = (output: unknown): DiffLine[] | undefined => {
  if (output === null || typeof output !== 'object') return undefined
  const out = output as { type?: unknown; content?: unknown; structuredPatch?: unknown }
  if (out.type === 'create' && typeof out.content === 'string') return lines(out.content).map((text, i) => ({ mark: '+', num: i + 1, text }))
  if (!Array.isArray(out.structuredPatch) || out.structuredPatch.length === 0) return undefined
  const rows: DiffLine[] = []
  for (const hunk of out.structuredPatch as { oldStart?: unknown; newStart?: unknown; lines?: unknown }[]) {
    if (typeof hunk?.oldStart !== 'number' || typeof hunk.newStart !== 'number' || !Array.isArray(hunk.lines)) return undefined
    let [o, n] = [hunk.oldStart, hunk.newStart]
    for (const l of hunk.lines) {
      if (typeof l !== 'string' || l.startsWith('\\')) continue
      const mark = l[0] === '+' || l[0] === '-' ? l[0] : ' '
      let num: number
      if (mark === '-') num = o++
      else {
        if (mark === ' ') o++
        num = n++
      }
      rows.push({ mark, num, text: l.slice(1) })
    }
  }
  return rows
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

export const changedRanges = (rows: readonly DiffLine[]): ([number, number] | undefined)[] => {
  const ranges: ([number, number] | undefined)[] = rows.map(() => undefined)
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.mark !== '-') {
      i++
      continue
    }
    const dels: number[] = []
    while (i < rows.length && rows[i]!.mark === '-') dels.push(i++)
    const adds: number[] = []
    while (i < rows.length && rows[i]!.mark === '+') adds.push(i++)
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

const renderClaudeDiff = (el: ElementTable, style: Style, output: unknown, rows: DiffLine[], shown: DiffLine[], gutter: number): RenderElement[] => {
  const { Box, Text } = el
  const t = style.theme
  const c = isDark(t.codeText) ? CLAUDE_DIFF.dark : CLAUDE_DIFF.light
  const lang = diffLang((output as { filePath?: unknown } | null)?.filePath)
  const painted = lang === undefined || isShellLang(lang) ? null : highlightRows(style, shown.map(r => r.text), lang)
  const ranges = changedRanges(rows).slice(0, shown.length)
  return shown.map((r, i) => {
    const bg = r.mark === '+' ? c.addBg : r.mark === '-' ? c.delBg : undefined
    const word = r.mark === '+' ? c.addWord : c.delWord
    const mark = r.mark === '+' ? c.addMark : r.mark === '-' ? c.delMark : c.number
    const segs = markRange(painted?.[i] ?? [{ text: r.text, color: t.codeText, italic: false }], ranges[i])
    return (
      <Box key={`d${i}`} flexDirection="row" {...(bg ? { backgroundColor: bg } : {})}>
        <Text color={mark}>{`${String(r.num).padStart(gutter)} `}</Text>
        <Text color={mark}>{`${r.mark === ' ' ? ' ' : r.mark} `}</Text>
        <Text color={t.codeText}>
          {segs.length === 0 ? ' ' : segs.map((s, k) => <Text key={`d${i}.${k}`} color={s.color ?? t.codeText} italic={s.italic} {...(s.hit ? { backgroundColor: word } : {})}>{s.text}</Text>)}
        </Text>
      </Box>
    )
  })
}

export const renderDiffCard = (el: ElementTable, style: Style, output: unknown, fold: Fold, id: string): RenderElement | undefined => {
  const rows = diffLines(output)
  if (rows === undefined) return undefined
  const { Box, Text } = el
  const t = style.theme
  const added = rows.filter(r => r.mark === '+').length
  const removed = rows.filter(r => r.mark === '-').length
  const deleted = removed > 0 && removed === rows.length
  const toggle = !deleted && rows.length > DIFF_LINES ? fold?.(id, rows.length - DIFF_LINES, 'fold') : null
  const shown = rows.slice(0, toggle?.folded === false ? DIFF_MAX : DIFF_LINES)
  const gutter = String(Math.max(0, ...shown.map(r => r.num))).length
  return (
    <Box flexDirection="row">
      <Text dimColor bold>{`  ${TREE_MARK}`.padEnd(5)}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={t.rule} paddingX={1} flexShrink={1}>
        <Text>
          <Text color={t.number} dimColor={added === 0}>{`+${added}`}</Text>
          <Text> </Text>
          <Text color={t.codeFlag} dimColor={removed === 0}>{`−${removed}`}</Text>
        </Text>
        {deleted ? <Text dimColor>file deleted</Text> : renderClaudeDiff(el, style, output, rows, shown, gutter)}
        {!deleted && rows.length > shown.length && toggle?.folded !== true ? <Text dimColor>{`… +${rows.length - shown.length} lines`}</Text> : null}
        {toggle?.element ?? null}
      </Box>
    </Box>
  )
}

export const renderToolRow = (el: ElementTable, style: Style, row: ToolRow): RenderElement => {
  const { Text } = el
  const t = style.theme
  const isShell = row.tool === 'Bash' || row.tool === 'PowerShell'
  const verb = VERBS[row.tool] ?? row.tool.replace(/^mcp__([^_]+)__/, '$1 ')
  const found = isShell ? { target: field(row.input, 'command')?.split('\n')[0], isPathField: false } : targetOf(style, row.input, TARGET_FIELDS)
  const target = found.target
  const dot = statusColor(t, row)
  const isPath = target !== undefined && (found.isPathField || /^(~|\.{0,2}\/|[A-Za-z]:\\)/.test(target))
  return toolLayout(el, dot, (
      <Text wrap="truncate-end" dimColor>
        <Text bold={false} dimColor>{verb}</Text>
        {target === undefined ? null : <Text> </Text>}
        {target === undefined ? null : isShell ? codeLine(el, style, target, 'bash', 'cmd') : <Text color={isPath ? t.path : t.inlineCode} dimColor>{target}</Text>}
        {row.isInterrupted ? <Text dimColor> interrupted</Text> : row.isErrored ? <Text color={t.codeFlag}> failed</Text> : null}
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
  const shown = [...stdout.map(text => ({ text, color: undefined as string | undefined })), ...stderr.map(text => ({ text, color: t.codeFlag as string | undefined }))]
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
          <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={t.codeComment} paddingX={1}>
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
  const dot = failed ? t.codeFlag : running ? t.accent : t.number
  const last = calls[calls.length - 1]
  const lastTarget = last ? targetOf(style, last.input, ['command', ...TARGET_FIELDS]).target?.split('\n')[0] : undefined
  const summary = groupSummary(calls)
  return toolLayout(el, dot, (
      <Text wrap="truncate-end" dimColor>
        <Text bold={false} dimColor>{summary}</Text>
        {failed ? <Text color={t.codeFlag}>{` · ${failed} failed`}</Text> : null}
        {lastTarget ? <Text dimColor>{` · last: ${lastTarget}`}</Text> : null}
      </Text>
  ))
}
