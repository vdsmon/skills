// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

/** What a cell holds: box outlines and frames, label text, an edge's line or head, an edge's label. */
export type Cls = 'border' | 'text' | 'edge' | 'edgeLabel' | 'none'

/** Text drawn on one row, starting at column `x`. */
export type Run = { x: number; y: number; text: string }

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * Keys tie a drawn thing to the parsed source: `n:<node index>` for a box, `g:<group index>` for a
 * frame. An edge into a node that names a group ends on that group's frame.
 */
export type DrawnBox = Rect & { key: string; lines: Run[] }
export type DrawnFrame = Rect & { key: string; title: Run[] }
export type DrawnEdge = {
  /** The edge's index in the parsed source. */
  index: number
  from: string
  to: string
  /** Every cell the edge's line drew on, from the cell on its source's border to its head. */
  cells: [number, number][]
  /** The cell beside the target where the edge ends, holding its head when it has one. */
  head: [number, number] | null
  label: Run[]
}

/**
 * A finished diagram. `rows` holds one string per cell, '' on the second cell of a wide character,
 * so a column index is a terminal column; `lines` is the same text, right-trimmed.
 */
export type Drawing = {
  rows: string[][]
  lines: string[]
  width: number
  boxes: DrawnBox[]
  frames: DrawnFrame[]
  edges: DrawnEdge[]
}
