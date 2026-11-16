import type { Fit } from './layout'
import { layout } from './layout'
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

/** `null` when the source is neither a flowchart nor a state diagram. */
export function drawFlow(source: string, columns: number): Flow | null {
  const graph = parseFlow(source)
  if (graph === null) return null
  if (graph.overCap) return { kind: 'too-large' }
  if (graph.nodes.length === 0) return { kind: 'empty' }
  let narrowest: Drawing | undefined
  for (const fit of FITS) {
    const drawing = layout(graph, fit)
    if (drawing === null) continue
    if (drawing.width <= columns) return { kind: 'drawn', drawing, fits: true }
    if (narrowest === undefined || drawing.width < narrowest.width) narrowest = drawing
  }
  return narrowest === undefined ? { kind: 'too-large' } : { kind: 'drawn', drawing: narrowest, fits: false }
}
