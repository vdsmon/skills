import { width } from '../text'
import type { Graph } from './graph'
import type { Flow } from './index'
import { drawFlow } from './index'
import { parseFlow } from './parse'
import type { Drawing, DrawnEdge, Rect, Run } from './types'

/**
 * The rules every drawing of a flowchart or state diagram keeps, checked against the source:
 * a  drawing never throws, and a source that parses always draws;
 * b  the drawing is no wider than the columns, or `fits` says it is not; its width is its widest row;
 * c  no label is cut: a box's, an edge's or a frame's text on the drawing, joined across its lines,
 *    is the source's label, with no "…" the source lacks;
 * d  no edge cell lies inside a box, or on a border other than at the edge's two ends, save where it
 *    crosses straight through the border of a frame that holds one of its ends and not the other;
 * e  two edges share cells only on a common run into or out of one box, or where they cross straight;
 * f  every edge label is whole and nothing else is drawn on its cells;
 * g  everything the parser read is on the drawing: every box with its label and its four corners,
 *    every frame with its title, every edge joined to its two boxes with its label and its heads, an
 *    arrow at the target pointing at it and one at the source pointing back along the line. An edge
 *    into the frame that holds its source ends just inside that frame's border.
 * g reads the list of what must be drawn from the parsed source, never from the drawer's records,
 * so a layout step that drops a thing cannot hide it.
 */
export type Check = 'a' | 'b' | 'c-box' | 'c-frame' | 'c-edge' | 'd' | 'e' | 'f' | 'g-box' | 'g-frame' | 'g-edge'

export type Failure = { check: Check; what: string }

export type Checked = { flow: Flow | null; failures: Failure[] }

type Cell = [number, number]

const LINE = /^[─-╿▲▼◄►o×]$/
const HEADS: Record<string, RegExp> = { arrow: /^[▲▼◄►]$/, circle: /^o$/, cross: /^×$/ }

const inside = (r: Rect, [x, y]: Cell) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
const onBorder = (r: Rect, cell: Cell) => inside(r, cell) && (cell[0] === r.x || cell[0] === r.x + r.w - 1 || cell[1] === r.y || cell[1] === r.y + r.h - 1)
/** A cell just outside a rect, beside one of its sides (not off a corner). */
const besideOf = (r: Rect, [x, y]: Cell) =>
  ((x === r.x - 1 || x === r.x + r.w) && y >= r.y && y < r.y + r.h) || ((y === r.y - 1 || y === r.y + r.h) && x >= r.x && x < r.x + r.w)
/** A cell just inside a rect, beside one of its sides. */
const besideIn = (r: Rect, [x, y]: Cell) => inside(r, [x, y]) && !onBorder(r, [x, y]) && (x === r.x + 1 || x === r.x + r.w - 2 || y === r.y + 1 || y === r.y + r.h - 2)
const holds = (outer: Rect, r: Rect) => outer !== r && r.x > outer.x && r.y > outer.y && r.x + r.w < outer.x + outer.w && r.y + r.h < outer.y + outer.h
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1]
const id = ([x, y]: Cell) => `${x},${y}`

/** The cells a run of text covers, wide characters taking two. */
const runCells = (run: Run): Cell[] => Array.from({ length: width(run.text) }, (_, k) => [run.x + k, run.y])

const readRun = (drawing: Drawing, run: Run): string => (drawing.rows[run.y] ?? []).slice(run.x, run.x + width(run.text)).join('')

/**
 * Whether `parts`, the lines a label was drawn on, join into `label`: each line break stands for a
 * space of the source or for nothing, where a long word broke.
 */
export const joinsInto = (label: string, parts: string[]): boolean => {
  const whole = label.replace(/\s+/g, ' ').trim()
  let at = 0
  for (const [i, part] of parts.map(p => p.trim()).entries()) {
    if (i > 0 && whole[at] === ' ') at++
    if (!whole.startsWith(part, at)) return false
    at += part.length
  }
  return at === whole.length
}

export function checkFlow(source: string, columns: number): Checked {
  const failures: Failure[] = []
  const fail = (check: Check, what: string) => failures.push({ check, what })
  let flow: Flow | null
  try {
    flow = drawFlow(source, columns)
  } catch (error) {
    fail('a', `throws: ${String(error)}`)
    return { flow: null, failures }
  }
  const graph = parseFlow(source)
  if (graph !== null && !graph.overCap && graph.nodes.length > 0 && flow?.kind !== 'drawn') fail('a', `parses but draws ${flow?.kind ?? 'nothing'}`)
  if (graph === null || flow?.kind !== 'drawn') return { flow, failures }
  const { drawing, fits } = flow
  const widest = Math.max(0, ...drawing.lines.map(width))
  if (widest !== drawing.width) fail('b', `says ${drawing.width} columns, its widest row is ${widest}`)
  if (fits !== drawing.width <= columns) fail('b', `${drawing.width} columns for ${columns} and fits is ${fits}`)
  checkDrawing(graph, drawing, fail)
  return { flow, failures }
}

function checkDrawing(graph: Graph, drawing: Drawing, fail: (check: Check, what: string) => void): void {
  const glyph = ([x, y]: Cell) => drawing.rows[y]?.[x] ?? ' '
  const shows = (run: Run) => readRun(drawing, run) === run.text
  const proxies = new Map(graph.nodes.flatMap((_, n) => {
    const g = graph.proxyOf(n)
    return g === undefined ? [] : [[n, g] as const]
  }))
  const keyOf = (n: number) => (proxies.has(n) ? `g:${proxies.get(n)}` : `n:${n}`)
  const rects = new Map<string, Rect>([...drawing.boxes, ...drawing.frames].map(r => [r.key, r]))
  const drawn = (r: Rect) => ([[r.x, r.y, '┌╭'], [r.x + r.w - 1, r.y, '┐╮'], [r.x, r.y + r.h - 1, '└╰'], [r.x + r.w - 1, r.y + r.h - 1, '┘╯']] as const).every(([x, y, corner]) => corner.includes(glyph([x, y])))
  const cellsOf = new Map(drawing.edges.map(e => [e, new Set(e.cells.map(id))]))
  /** The arrow a head beside or just inside `r` shows to point at it. */
  const pointsAt = (r: Rect, [x, y]: Cell): string =>
    (y === r.y - 1 || y === r.y + r.h - 2 ? '▼' : '') + (y === r.y + r.h || y === r.y + 1 ? '▲' : '') + (x === r.x - 1 || x === r.x + r.w - 2 ? '►' : '') + (x === r.x + r.w || x === r.x + 1 ? '◄' : '')
  /** The arrow at the start of an edge points back the way its line comes from: away from its one next cell. */
  const pointsBack = (e: DrawnEdge, [x, y]: Cell): string =>
    ([[0, 1, '▲'], [0, -1, '▼'], [1, 0, '◄'], [-1, 0, '►']] as const).filter(([dx, dy]) => cellsOf.get(e)!.has(id([x + dx, y + dy]))).map(([, , a]) => a).join('')

  // g and c for boxes and frames
  graph.nodes.forEach((node, n) => {
    if (proxies.has(n)) return
    const boxes = drawing.boxes.filter(b => b.key === `n:${n}`)
    if (boxes.length !== 1) return fail('g-box', `node ${n} drawn ${boxes.length} times`)
    const box = boxes[0]!
    if (!drawn(box)) fail('g-box', `node ${n} has no outline at ${box.x},${box.y}`)
    if (!box.lines.every(shows)) fail('g-box', `node ${n}'s label is not where its box says`)
    if (!joinsInto(node.label, box.lines.map(l => l.text))) fail('c-box', `node ${n}: "${box.lines.map(l => l.text).join('|')}" for "${node.label}"`)
    if (!box.lines.every(l => runCells(l).every(c => inside(box, c) && !onBorder(box, c)))) fail('c-box', `node ${n}'s label runs past its box`)
  })
  graph.groups.forEach((group, g) => {
    const frames = drawing.frames.filter(f => f.key === `g:${g}`)
    if (frames.length !== 1) return fail('g-frame', `group ${g} drawn ${frames.length} times`)
    const frame = frames[0]!
    if (!drawn(frame)) fail('g-frame', `group ${g} has no outline at ${frame.x},${frame.y}`)
    if (!frame.title.every(shows)) fail('g-frame', `group ${g}'s title is not where its frame says`)
    if (!joinsInto(group.label, frame.title.map(l => l.text))) fail('c-frame', `group ${g}: "${frame.title.map(l => l.text).join('|')}" for "${group.label}"`)
  })

  // g, c and f for edges
  const byIndex = new Map(drawing.edges.map(e => [e.index, e]))
  const labelCells = new Map<string, number>()
  for (const e of drawing.edges) for (const run of e.label) for (const c of runCells(run)) labelCells.set(id(c), (labelCells.get(id(c)) ?? 0) + 1)
  const edgeCells = new Map<string, DrawnEdge[]>()
  for (const e of drawing.edges) for (const c of e.cells) edgeCells.get(id(c))?.push(e) ?? edgeCells.set(id(c), [e])
  const allRects = [...drawing.boxes, ...drawing.frames]

  graph.edges.forEach((edge, k) => {
    const e = byIndex.get(k)
    if (!e) return fail('g-edge', `edge ${k} is not drawn`)
    const from = keyOf(edge.from)
    const to = keyOf(edge.to)
    if (e.from !== from || e.to !== to) fail('g-edge', `edge ${k} joins ${e.from} to ${e.to}, not ${from} to ${to}`)
    const fromRect = rects.get(e.from)
    const toRect = rects.get(e.to)
    const start = e.cells[0]
    const end = e.head
    if (!fromRect || !toRect || !start || !end) return fail('g-edge', `edge ${k} has no line`)
    if (!onBorder(fromRect, start)) fail('g-edge', `edge ${k} does not leave from its box`)
    if (!(besideOf(toRect, end) || (holds(toRect, fromRect) && besideIn(toRect, end)))) fail('g-edge', `edge ${k} does not end beside its box`)
    if (!connected(e.cells)) fail('g-edge', `edge ${k}'s line has a gap`)
    if (!e.cells.every(c => LINE.test(glyph(c)))) fail('g-edge', `edge ${k}'s line is drawn over`)
    if (edge.headTo !== 'none' && !(e.head && HEADS[edge.headTo]!.test(glyph(e.head)))) fail('g-edge', `edge ${k} has no head`)
    if (edge.headTo === 'arrow' && !pointsAt(toRect, end).includes(glyph(end))) fail('g-edge', `edge ${k}'s head ${glyph(end)} does not point at its target`)
    if (edge.headFrom !== 'none' && !HEADS[edge.headFrom]!.test(glyph(start))) fail('g-edge', `edge ${k} has no head at its source`)
    if (edge.headFrom === 'arrow' && pointsBack(e, start) !== glyph(start)) fail('g-edge', `edge ${k}'s head ${glyph(start)} at its source does not point back along its line`)
    if (edge.label !== null && e.label.length === 0) fail('g-edge', `edge ${k} has no label`)
    if (edge.label === null) return
    const parts = e.label.map(l => l.text)
    if (!joinsInto(edge.label, parts)) {
      fail('c-edge', `edge ${k}: "${parts.join('|')}" for "${edge.label}"`)
      fail('f', `edge ${k}'s label is not whole`)
    }
    if (!e.label.every(shows)) fail('f', `edge ${k}'s label is not where it says`)
    const taken = e.label.flatMap(runCells).filter(c => (labelCells.get(id(c)) ?? 0) > 1 || edgeCells.has(id(c)) || allRects.some(r => inside(r, c) && !drawing.frames.some(f => f === r && !onBorder(f, c))))
    if (taken.length > 0) fail('f', `edge ${k}'s label shares ${taken.length} cells`)
  })

  // d and e
  for (const e of drawing.edges) {
    const ends = [e.cells[0], e.head ?? e.cells.at(-1)].filter((c): c is Cell => c !== undefined)
    const has = new Set(e.cells.map(id))
    // Through the border, not along it: down across a top or bottom side, sideways across the others.
    const through = (f: Rect, [x, y]: Cell) => {
      const across = y === f.y || y === f.y + f.h - 1
      const down = x === f.x || x === f.x + f.w - 1
      return across !== down && (across ? has.has(id([x, y - 1])) && has.has(id([x, y + 1])) : has.has(id([x - 1, y])) && has.has(id([x + 1, y])))
    }
    const [from, to] = [rects.get(e.from), rects.get(e.to)]
    const crosses = (f: Rect, c: Cell) => from !== undefined && to !== undefined && (holds(f, from) || f === from) !== (holds(f, to) || f === to) && through(f, c)
    const over = e.cells.filter(c => !ends.some(end => same(end, c)) && (drawing.boxes.some(b => inside(b, c)) || drawing.frames.some(f => onBorder(f, c) && !crosses(f, c))))
    if (over.length > 0) fail('d', `edge ${e.index} runs over a box or a border on ${over.length} cells`)
  }
  // Cells two edges share where neither crosses the other straight, by pair.
  const shared = new Map<string, { a: DrawnEdge; b: DrawnEdge; cells: Cell[] }>()
  for (const [key, edges] of edgeCells) {
    const cell = key.split(',').map(Number) as Cell
    const way = (e: DrawnEdge) => {
      const has = (dx: number, dy: number) => cellsOf.get(e)!.has(`${cell[0] + dx},${cell[1] + dy}`)
      return has(-1, 0) && has(1, 0) && !has(0, -1) && !has(0, 1) ? 'across' : has(0, -1) && has(0, 1) && !has(-1, 0) && !has(1, 0) ? 'down' : 'turn'
    }
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const [a, b] = [edges[i]!, edges[j]!]
        const crossing = new Set([way(a), way(b)])
        if (crossing.has('across') && crossing.has('down')) continue
        const pair = `${Math.min(a.index, b.index)}-${Math.max(a.index, b.index)}`
        ;(shared.get(pair) ?? shared.set(pair, { a, b, cells: [] }).get(pair)!).cells.push(cell)
      }
    }
  }
  // A common run is one piece that leaves the box both edges leave, or reaches the box both enter.
  for (const [pair, { a, b, cells }] of shared) {
    const leaves = a.from === b.from && cells.some(c => onBorder(rects.get(a.from)!, c))
    const enters = a.to === b.to && cells.some(c => besideOf(rects.get(a.to)!, c))
    if (!(connected(cells) && (leaves || enters))) fail('e', `edges ${pair} share ${cells.length} cells off a common run`)
  }
}

/** Whether the cells form one piece, each touching another on a side. */
function connected(cells: Cell[]): boolean {
  if (cells.length === 0) return false
  const left = new Set(cells.map(id))
  const queue = [cells[0]!]
  left.delete(id(cells[0]!))
  while (queue.length > 0) {
    const [x, y] = queue.pop()!
    for (const next of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Cell[]) {
      if (left.delete(id(next))) queue.push(next)
    }
  }
  return left.size === 0
}
