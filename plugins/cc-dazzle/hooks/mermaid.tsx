import type { ElementTable, RenderElement } from 'claude-code'

import type { ChartArt } from './charts'
import { ganttText, pieText } from './charts'
import { cells, graphemes, remember, width } from './text'
import type { Style, Theme } from './theme'
import { DIAGRAM_HUES } from './theme'
import { renderMermaidAscii, setChartSize } from './vendor/mermaid-text.js'

const MAX_LINES = 80
const PAD = '\uFDD0'
const textCache = new Map<string, string | null>()

export const chartSize = (columns: number, source = '') => {
  const labels = (/^\s*x-axis\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1] ?? '').split(',').map(s => s.trim().replace(/^"|"$/g, ''))
  const fit = labels.length * (Math.max(...labels.map(l => l.length)) + 2)
  const width = Math.max(24, Math.min(60, Math.max(Math.floor(columns / 6), fit), columns - 12))
  return { width, height: Math.max(8, Math.min(20, Math.round(width * 0.3))) }
}

const padWide = (source: string) => (/^[\x00-\x7F]*$/.test(source) ? source : graphemes(source).map(g => (g.length === 1 && width(g) === 2 ? g + PAD : g)).join(''))

const unquoteCategories = (source: string) =>
  source.replace(/^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m, (_, head: string, items: string) => `${head}${items.replace(/"([^"]*)"/g, (_q, s: string) => s.replaceAll(',', ' '))}]`)

const BLOCK = /[█▀▄]/

const labelBars = (art: string, source: string): string => {
  const series = source.match(/^\s*(bar|line)\b.*$/gm) ?? []
  const values = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1]?.split(',').map(v => v.trim())
  if (series.length !== 1 || !values || /^\s*xychart(-beta)?\s+horizontal/m.test(source)) return art
  const grid = ['', ...art.split('\n')].map(l => [...l])
  const gutter = (r: number) => /^\s*(-?[\d.]+)[┤┼]/.exec(grid[r]?.join('') ?? '')?.[1]
  const axis = grid.findLastIndex((_, r) => gutter(r) !== undefined)
  const ticks = [...(grid[axis]?.join('') ?? '').matchAll(/┬|▀+/g)].map(m => m.index + Math.floor(m[0].length / 2))
  if (ticks.length !== values.length) return art
  const zero = grid.findIndex((_, r) => gutter(r) === '0')
  const top = grid.findIndex((_, r) => gutter(r) !== undefined)
  const base = zero !== -1 ? zero : gutter(top)?.startsWith('-') ? top : axis
  ticks.forEach((x, k) => {
    const filled = grid.flatMap((row, r) => (BLOCK.test(row[x] ?? '') ? [r] : []))
    const y = Number(values[k]) < 0 ? (filled.at(-1) ?? base) + 1 : (filled[0] ?? base) - 1
    const text = [...values[k]!]
    const bar = grid[filled[0] ?? -1] ?? []
    let [left, right] = [x, x]
    while (BLOCK.test(bar[left - 1] ?? '')) left--
    while (BLOCK.test(bar[right + 1] ?? '')) right++
    const from = left + Math.ceil((right - left + 1 - text.length) / 2)
    const row = y < axis ? grid[y] : undefined
    if (!row) return
    while (row.length < from + text.length) row.push(' ')
    if (!text.every((_, i) => /[ ·]/.test(row[from + i] ?? ' '))) return
    text.forEach((ch, i) => (row[from + i] = ch))
  })
  return grid.map(row => row.join('').trimEnd()).join('\n').replace(/^\n/, '')
}

const SIDEWAYS = /^(\s*(?:flowchart|graph)[ \t]+)(LR|RL)\b/

const SUPPORTED = /^(flowchart|graph|statediagram(-v2)?|xychart(-beta)?|sequencediagram|classdiagram|erdiagram|pie|gantt)$/i

const kindOf = (source: string) => source.replace(/^(\s*%%[^\n]*\n)+/, '').trim().split(/\s/)[0] ?? ''

export const unsupportedKind = (source: string): string | undefined => {
  const kind = kindOf(source)
  return kind && !SUPPORTED.test(kind) ? kind : undefined
}

// Pies and gantts are drawn here, not by beautiful-mermaid. A pie is round while each slice can take
// its own diagram hue, and falls back to one bar per slice past that or in a narrow terminal.
const OWN: Record<string, (source: string, columns: number) => ChartArt | null> = {
  pie: (source, columns) => pieText(source, false, columns, DIAGRAM_HUES.length),
  gantt: (source, columns) => {
    const text = ganttText(source, false, columns)
    return text === null ? null : { text }
  },
}

const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|del|code|small|sub|sup|span|mark)\b[^<>\n]*>/gi

type Mark = { italic?: boolean; bold?: boolean; underline?: boolean; strikethrough?: boolean }
const TAG_MARK: Record<string, keyof Mark> = { i: 'italic', em: 'italic', b: 'bold', strong: 'bold', u: 'underline', s: 'strikethrough', del: 'strikethrough' }

export const inlineMarks = (source: string): [string[], Mark][] =>
  [...source.matchAll(/<(i|em|b|strong|u|s|del)\b[^<>\n]*>([^<\n]+)<\/\1\s*>/gi)]
    .map(m => [cells(m[2]!.trim()), { [TAG_MARK[m[1]!.toLowerCase()]!]: true }] as [string[], Mark])

const fitted = new Map<string, ChartArt | null>()

export const mermaidArt = (source: string, columns: number): ChartArt | null =>
  remember(fitted, `${columns}:${source}`, () => {
    source = source.replace(INLINE_TAG, '')
    if (source.length > 8000 || source.split('\n').length > MAX_LINES) return null
    const own = OWN[kindOf(source).toLowerCase()]
    if (own) return own(source, columns)
    const art = draw(source, columns)
    const fits = (a: string) => a.split('\n').every(l => width(l) <= columns - 2)
    const text = art === null || fits(art) || !SIDEWAYS.test(source) ? art : (draw(source.replace(SIDEWAYS, '$1TD'), columns) ?? art)
    return text === null ? null : { text }
  })

export const mermaidText = (source: string, columns: number): string | null => mermaidArt(source, columns)?.text ?? null

const prepared = (padded: string) => unquoteCategories(padded.replace(/^(\s*%%[^\n]*\n)+/, '')).replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, '$1|')

// A chart of two or more series is drawn a second time in truecolor with neutral role colors, so
// each cell's series hue tells which series owns it.
const NEUTRAL = '#808080'
const PROBE = { fg: NEUTRAL, border: NEUTRAL, line: NEUTRAL, arrow: NEUTRAL, corner: NEUTRAL, junction: NEUTRAL, accent: '#ff0000', bg: '#000000' }
const SGR = /\x1b\[([\d;]*)m/g

const seriesOf = (colored: string): number[][] => {
  const hues = colored.split('\n').map(line => {
    const row: (string | undefined)[] = []
    let hue: string | undefined
    let at = 0
    const take = (text: string) => graphemes(text).forEach(() => row.push(hue))
    for (const m of line.matchAll(SGR)) {
      take(line.slice(at, m.index))
      hue = m[1]!.startsWith('38;2;') && m[1] !== '38;2;128;128;128' ? m[1] : undefined
      at = m.index + m[0].length
    }
    take(line.slice(at))
    return row
  })
  const legend = hues.find(row => row.some(Boolean)) ?? []
  const order = [...new Set(legend.filter((h): h is string => h !== undefined))]
  return hues.map(row => row.map(h => (h === undefined ? -1 : order.indexOf(h))))
}

const seriesCache = new Map<string, number[][] | null>()

export const chartSeries = (source: string, columns: number): number[][] | undefined => {
  source = source.replace(INLINE_TAG, '')
  if (!/^\s*xychart/.test(source) || (source.match(/^\s*(bar|line)\b/gm) ?? []).length < 2) return undefined
  const padded = padWide(source)
  const size = chartSize(columns, padded)
  return remember(seriesCache, `${size.width}:${source}`, () => {
    try {
      setChartSize(size.width, size.height)
      return seriesOf(renderMermaidAscii(prepared(padded), { useAscii: false, colorMode: 'truecolor', theme: PROBE, paddingX: 3, paddingY: 1 }))
    } catch {
      return null
    }
  }) ?? undefined
}

const draw = (source: string, columns: number): string | null => {
  const isChart = /^\s*xychart/.test(source)
  const padded = padWide(source)
  const size = chartSize(columns, isChart ? padded : '')
  const key = `${isChart ? size.width : 0}:${source}`
  return remember(textCache, key, () => {
    try {
      if (isChart) setChartSize(size.width, size.height)
      const art = renderMermaidAscii(prepared(padded), { useAscii: false, colorMode: 'none', paddingX: 3, paddingY: 1 }).replace(/[ \t]+$/gm, '').trimEnd().replace(/▶/g, '►').replace(/◀/g, '◄')
      return (isChart ? labelBars(art, padded) : art.split('\n').filter(l => !/^[\s│|]*$/.test(l)).join('\n')).replaceAll(PAD, '')
    } catch {
      return null
    }
  })
}

const LINE = /[─-╿◇]/
const ARROW = /[►◄▲▼]/

const paint = (art: string, style: Style, series?: number[][]): (string | undefined)[][] => {
  const t = style.theme
  const grid = art.split('\n').map(cells)
  const cell = (r: number, c: number) => grid[r]?.[c] ?? ''
  const color: (string | undefined)[][] = grid.map(row => row.map(() => undefined))
  const palette = DIAGRAM_HUES
  const next = (i: number) => palette[i % palette.length]
  const labels = new Map<string, string | undefined>()

  const rects: { r: number; c: number; r2: number; c2: number }[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/[┌╭(]/.test(cell(r, c))) continue
      let c2 = c + 1
      while (/[─┬┴┼▲▼]/.test(cell(r, c2))) c2++
      if (!/[┐╮)]/.test(cell(r, c2)) || c2 === c + 1) continue
      let r2 = r + 1
      while (/[│├┤┼►◄]/.test(cell(r2, c))) r2++
      if (!/[└╰(]/.test(cell(r2, c)) || !/[┘╯)]/.test(cell(r2, c2))) continue
      rects.push({ r, c, r2, c2 })
    }
  }
  const inside = (a: (typeof rects)[number], b: (typeof rects)[number]) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2
  for (const box of rects.filter(a => !rects.some(b => inside(a, b)))) {
    const { r, c, r2, c2 } = box
    const label = grid.slice(r + 1, r2).map(row => row.slice(c + 1, c2).join('')).join(' ').trim()
    if (!labels.has(label)) labels.set(label, next(labels.size))
    const hue = labels.get(label)
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) color[y]![x] = hue
  }

  const bars = [...new Set(grid.flatMap(row => row.flatMap((ch, c) => (BLOCK.test(ch) && row[c - 1] !== ch ? [c] : []))))].sort((a, b) => a - b)
  const ends = bars.map(x => {
    const row = grid.find(row => BLOCK.test(row[x] ?? ''))!
    let end = x
    while (row[end + 1] === row[x]) end++
    return end
  })
  const tops = bars.map(x => {
    const r = grid.findIndex(row => BLOCK.test(row[x] ?? ''))
    return r * 2 + (grid[r]![x] === '▄' ? 1 : 0)
  })
  const single = bars.length > 1 && bars.every((x, i) => i === 0 || x - ends[i - 1]! > 2)
  const barColor = (i: number) => (single ? (tops[i] === Math.min(...tops) ? DIAGRAM_HUES[3] : t.quote) : next(i))
  series?.forEach((row, r) => row.forEach((owner, c) => owner >= 0 && grid[r]?.[c]?.trim() && (color[r]![c] = next(owner))))
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (color[r]![c] !== undefined) return
      if (BLOCK.test(ch)) {
        let start = c
        while (row[start - 1] === ch) start--
        color[r]![c] = barColor(bars.indexOf(start))
      } else if (ch === '·') color[r]![c] = t.rule
      else if (ARROW.test(ch)) color[r]![c] = t.accent
      else if (LINE.test(ch)) color[r]![c] = t.diagram
      else if (/^\d+[┤┼]/.test(row.slice(c).join(''))) color[r]![c] = t.number
      else color[r]![c] = t.diagramText
    }),
  )
  return color
}

// Each cell of a round pie takes the hue of the slice it draws, or of the legend line it sits on.
const paintPie = (art: string, slices: number[][], style: Style): (string | undefined)[][] =>
  art.split('\n').map((row, r) => cells(row).map((_, c) => {
    const slice = slices[r]?.[c] ?? -1
    return slice < 0 ? style.theme.diagramText : DIAGRAM_HUES[slice % DIAGRAM_HUES.length]
  }))

type Painted = { grid: string[][]; colors: (string | undefined)[][] }
const painted = new WeakMap<Theme, Map<string, Painted>>()
// Two pies can draw the same art and split it differently, so a pie is painted by its slices.
const piePainted = new WeakMap<Theme, WeakMap<number[][], Painted>>()

const painting = (style: Style, art: string, slices?: number[][], series?: number[][]): Painted => {
  if (!slices) {
    const cache = painted.get(style.theme) ?? new Map<string, Painted>()
    painted.set(style.theme, cache)
    return remember(cache, art, () => ({ grid: art.split('\n').map(cells), colors: paint(art, style, series) }))
  }
  const cache = piePainted.get(style.theme) ?? new WeakMap<number[][], Painted>()
  piePainted.set(style.theme, cache)
  const done = cache.get(slices) ?? { grid: art.split('\n').map(cells), colors: paintPie(art, slices, style) }
  cache.set(slices, done)
  return done
}

export const boxArt = ({ Box, Text }: ElementTable, style: Style, art: string, key: string, marks: [string[], Mark][] = [], slices?: number[][], series?: number[][]): RenderElement => {
  const { grid, colors } = painting(style, art, slices, series)
  return (
    <Box key={key} flexDirection="column" paddingLeft={2}>
      {grid.map((chars, i) => {
        const marked: (Mark | undefined)[] = chars.map(() => undefined)
        for (const [phrase, mark] of marks)
          for (let c = 0; c + phrase.length <= chars.length; c++)
            if (phrase.every((ch, k) => chars[c + k] === ch)) for (let k = 0; k < phrase.length; k++) marked[c + k] = mark
        const parts: RenderElement[] = []
        let at = 0
        while (at < chars.length) {
          const hue = colors[i]?.[at]
          const mark = marked[at]
          let end = at + 1
          while (end < chars.length && colors[i]?.[end] === hue && marked[end] === mark) end++
          parts.push(<Text key={`t${parts.length}`} color={hue} {...mark}>{chars.slice(at, end).join('')}</Text>)
          at = end
        }
        return <Text key={`${key}.${i}`}>{parts.length ? parts : ' '}</Text>
      })}
    </Box>
  )
}

const EDGE_LABEL = /(-[-.=]+\s*)"([^"\n]+)"(\s*[-.=]+>)|\|([^|\n]+)\|/g

const cap = (label: string, max: number) => {
  const flat = label.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
  const chars = graphemes(flat)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat
}

export const shortenEdgeLabels = (source: string, max: number): string =>
  source.replace(EDGE_LABEL, (m, open, quoted, close, piped) =>
    quoted !== undefined ? `${open}"${cap(quoted, max)}"${close}` : `|${cap(piped, max)}|`)
