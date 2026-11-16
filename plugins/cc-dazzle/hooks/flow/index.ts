import type { Graph } from './graph'
import type { Fit, Layout } from './layout'
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
 * The most narrowing steps times boxes and edges a diagram gets, since each step lays it out again and
 * a reply draws on every streamed prefix. The diagrams the tests run over take at most a fifth of it;
 * 78 labelled edges among 40 boxes, never narrow enough, stop after 17 steps instead of 124.
 */
const NARROWING_WORK = 2048

/** `null` when the source is neither a flowchart nor a state diagram. */
export function drawFlow(source: string, columns: number): Flow | null {
  const graph = parseFlow(source)
  if (graph === null) return null
  if (graph.overCap) return { kind: 'too-large' }
  if (graph.nodes.length === 0) return { kind: 'empty' }
  let narrowest: Drawing | undefined
  for (const drawing of drawings(graph)) {
    if (drawing.width <= columns) return { kind: 'drawn', drawing, fits: true }
    if (narrowest === undefined || drawing.width < narrowest.width) narrowest = drawing
  }
  return narrowest === undefined ? { kind: 'too-large' } : { kind: 'drawn', drawing: narrowest, fits: false }
}

/**
 * The drawings the drawer tries, in an order that does not depend on the columns: each fit from wide
 * labels to narrow, then, on the narrowest fit, one more for each step that splits a row or narrows a
 * level of labels, until nothing is left to narrow. A split row reads worse than a wrapped label, so
 * splitting waits until wrapping has failed. The caller stops at the first drawing that fits.
 */
export function* drawings(graph: Graph): Generator<Drawing> {
  let last: Layout | null = null
  for (const fit of FITS) {
    last = layout(graph, fit)
    if (last !== null) yield last.drawing
  }
  const fit = FITS.at(-1)!
  let narrowing = UNNARROWED
  const steps = Math.floor(NARROWING_WORK / (graph.nodes.length + graph.edges.length))
  for (let step = 0; last !== null && step < steps; step++) {
    const next = narrower(last, narrowing, fit.label)
    if (next === null) return
    narrowing = next
    last = layout(graph, fit, narrowing)
    if (last !== null) yield last.drawing
  }
}
