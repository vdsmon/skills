import type { Graph } from './graph'
import type { Direction, Fit, Layout, Narrowing } from './layout'
import { layout, UNNARROWED } from './layout'
import { narrower } from './narrow'
import { parseFlow } from './parse'
import type { Drawing } from './types'

export type { Drawing } from './types'

/**
 * A flowchart or state diagram drawn for `columns`: the first drawing that fits, else the narrowest
 * one with `fits` false. `too-large` is a source over a cap; `empty` one with nothing to draw.
 */
export type Flow = { kind: 'drawn'; drawing: Drawing; fits: boolean } | { kind: 'too-large' } | { kind: 'empty' }

// From the widest labels to the narrowest, each with the gap between boxes it was measured with.
export const FITS: Fit[] = [
  { wrap: 24, gap: 3, label: 28 },
  { wrap: 20, gap: 3, label: 22 },
  { wrap: 16, gap: 2, label: 18 },
  { wrap: 12, gap: 2, label: 14 },
  { wrap: 10, gap: 1, label: 12 },
]

/**
 * `null` when the source is neither a flowchart nor a state diagram. A diagram draws top-down, unless
 * its source runs sideways and its drawing left to right fits the columns in fewer rows.
 */
export function drawFlow(source: string, columns: number): Flow | null {
  const graph = parseFlow(source)
  if (graph === null) return null
  if (graph.overCap) return { kind: 'too-large' }
  if (graph.nodes.length === 0 && graph.groups.length === 0) return { kind: 'empty' }
  const down = chosen(graph, 'down', columns)
  if (!graph.sideways || down.kind !== 'drawn') return down
  const right = chosen(graph, 'right', columns)
  const shorter = right.kind === 'drawn' && right.fits && right.drawing.lines.length < down.drawing.lines.length
  return shorter ? right : down
}

/**
 * `drawnFor` over `drawings`, with rows widened only in the drawing it picks: widening keeps every
 * width, so the plain widths pick the same drawing, and the rest of the sequence is never widened.
 */
function chosen(graph: Graph, direction: Direction, columns: number): Flow {
  let narrowest: Step | undefined
  for (const step of steps(graph, direction)) {
    if (step.laid.drawing.width <= columns) return { kind: 'drawn', drawing: roomier(graph, step, direction), fits: true }
    if (narrowest === undefined || step.laid.drawing.width < narrowest.laid.drawing.width) narrowest = step
  }
  return narrowest === undefined ? { kind: 'too-large' } : { kind: 'drawn', drawing: roomier(graph, narrowest, direction), fits: false }
}

/** The first of `list` that fits `columns`, else the narrowest of them with `fits` false. */
export function drawnFor(list: Iterable<Drawing>, columns: number): Flow {
  let narrowest: Drawing | undefined
  for (const drawing of list) {
    if (drawing.width <= columns) return { kind: 'drawn', drawing, fits: true }
    if (narrowest === undefined || drawing.width < narrowest.width) narrowest = drawing
  }
  return narrowest === undefined ? { kind: 'too-large' } : { kind: 'drawn', drawing: narrowest, fits: false }
}

/**
 * The drawings the drawer tries, in an order that does not depend on the columns: each fit from wide
 * labels to narrow, then, top-down, on the narrowest fit, one more for each step that splits a row or
 * narrows a level of labels, until nothing is left to narrow. A split row reads worse than a wrapped
 * label, so splitting waits until wrapping has failed; left to right never splits, since top-down
 * draws what wrapping alone does not fit. The caller stops at the first drawing that fits.
 */
export function* drawings(graph: Graph, direction: Direction = 'down', widen = true): Generator<Drawing> {
  for (const step of steps(graph, direction)) yield widen ? roomier(graph, step, direction) : step.laid.drawing
}

/** One drawing of the sequence as laid out, before its rows widen, with the fit and narrowing it took. */
type Step = { laid: Layout; fit: Fit; narrowing: Narrowing }

function* steps(graph: Graph, direction: Direction): Generator<Step> {
  let last: Layout | null = null
  for (const fit of FITS) {
    last = layout(graph, fit, UNNARROWED, direction)
    if (last !== null) yield { laid: last, fit, narrowing: UNNARROWED }
  }
  if (direction === 'right') return
  const fit = FITS.at(-1)!
  // Narrowing ends: see `narrower`, whose every step moves a bounded measure one way.
  let narrowing = UNNARROWED
  while (last !== null) {
    const next = narrower(last, narrowing, fit.label)
    if (next === null) return
    narrowing = next
    last = layout(graph, fit, narrowing)
    if (last !== null) yield { laid: last, fit, narrowing }
  }
}

/**
 * A step's drawing, its rows of boxes each wrapped no narrower than it must be: the widest of the fits'
 * wraps at which the row is no wider than what sets the drawing's width (its frame's, inside a frame).
 * The drawing is kept only if that leaves its width the same and it no taller, so the widths of the
 * sequence, and with them every fit and width note, stay as they were; the steps go on unwidened.
 */
function roomier(graph: Graph, { laid, fit, narrowing }: Step, direction: Direction): Drawing {
  const { drawing } = laid
  // Left to right, a column is as wide as its widest box: there is no room to give the others.
  if (direction === 'right') return drawing
  const wraps = new Map<string, number>()
  for (const [scope, { width, levels }] of laid.scopes) {
    const room = scope === null ? drawing.width : width
    for (const level of levels) {
      const boxes = level.nodes.filter(n => n.across !== undefined)
      if (level.kind !== 'rank' || boxes.length === 0) continue
      const packed = level.nodes.at(-1)!.end
      const wrap = FITS.map(f => f.wrap).find(w => w > fit.wrap && packed + boxes.reduce((grow, n) => grow + n.across!(w) - (n.end - n.start), 0) <= room)
      if (wrap !== undefined) for (const n of boxes) wraps.set(n.item!, wrap)
    }
  }
  // Placement can shift a widened row past what its packed width promised: then every widened row
  // steps one wrap narrower, until the drawing holds or no row is left wider than the fit's.
  const narrower = (w: number) => FITS.map(f => f.wrap).find(n => n < w)!
  while (wraps.size > 0) {
    const wide = layout(graph, fit, { ...narrowing, wraps }, direction)
    if (wide !== null && wide.drawing.width === drawing.width && wide.drawing.lines.length <= drawing.lines.length) return wide.drawing
    for (const [key, w] of wraps) {
      if (narrower(w) > fit.wrap) wraps.set(key, narrower(w))
      else wraps.delete(key)
    }
  }
  return drawing
}
