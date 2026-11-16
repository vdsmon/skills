// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

import { measured } from './labels'
import type { Cls, Drawing, DrawnBox, DrawnEdge, DrawnFrame, Run } from './types'

/** Sentinel on the second cell of a wide glyph. */
export const CONT = String.fromCharCode(0)

/** Connection direction bits, combined into a box-drawing glyph by `maskChar`. */
export const U = 1
export const D = 2
export const L = 4
export const R = 8

/** Line styles, tracked per cell so crossing edges keep their own stroke. */
export const STY_DOT = 1
export const STY_THICK = 2
export const STY_SOLID = 4

type Cell = [number, number]

/**
 * The part of one edge drawn on a canvas. An edge that crosses a frame is drawn in pieces, one per
 * frame it passes, which merge into one record as the frames are stamped into their parent.
 */
type Piece = { index: number; from: string; to: string; cells: Cell[]; start: Cell | null; head: Cell | null; label: Run[]; seen: Set<string> }

/**
 * A grid of cells. Edges accumulate as direction bits rather than glyphs so that crossings and
 * junctions resolve whatever order they are drawn in; `finalizeMask` turns the bits into glyphs.
 *
 * `occupied` marks cells claimed by a box, which edge bits must not overwrite. Alongside the cells
 * the canvas records where each box, frame, edge and label went, for the checks to read.
 */
export class Canvas {
  readonly w: number
  readonly h: number
  ch: string[]
  cls: Cls[]
  mask: Uint8Array
  style: Uint8Array
  occupied: Uint8Array
  curStyle: number = STY_SOLID
  boxes: DrawnBox[] = []
  frames: DrawnFrame[] = []
  private pieces = new Map<number, Piece>()
  private edge: Piece | null = null

  constructor(w: number, h: number) {
    const n = w * h
    this.w = w
    this.h = h
    this.ch = new Array(n).fill(' ')
    this.cls = new Array(n).fill('none')
    this.mask = new Uint8Array(n)
    this.style = new Uint8Array(n)
    this.occupied = new Uint8Array(n)
  }

  idx(x: number, y: number): number {
    return y * this.w + x
  }

  set(x: number, y: number, c: string, cls: Cls): void {
    if (x >= this.w || y >= this.h) return
    const i = this.idx(x, y)
    this.ch[i] = c
    this.cls[i] = cls
  }

  private piece(index: number, from: string, to: string): Piece {
    const known = this.pieces.get(index)
    if (known) return known
    const made: Piece = { index, from, to, cells: [], start: null, head: null, label: [], seen: new Set() }
    this.pieces.set(index, made)
    return made
  }

  /** Record the cells drawn from here to `endEdge` as part of the line of edge `index`. */
  beginEdge(index: number, from: string, to: string): void {
    this.edge = this.piece(index, from, to)
  }

  endEdge(): void {
    this.edge = null
  }

  private trace(x: number, y: number): void {
    if (!this.edge || this.edge.seen.has(`${x},${y}`)) return
    this.edge.seen.add(`${x},${y}`)
    this.edge.cells.push([x, y])
  }

  /** Mark the cell on its source's border where the current edge leaves. */
  start(x: number, y: number): void {
    this.trace(x, y)
    if (this.edge) this.edge.start = [x, y]
  }

  /** An edge's head glyph, drawn over whatever line bits reach that cell. */
  head(x: number, y: number, glyph: string): void {
    if (x >= this.w || y >= this.h) return
    this.set(x, y, glyph, 'edge')
    this.tip(x, y)
  }

  /** Mark the cell beside its target where the current edge ends. */
  tip(x: number, y: number): void {
    this.trace(x, y)
    if (this.edge) this.edge.head = [x, y]
  }

  /** A glyph of the current edge's line, drawn as is rather than from direction bits. */
  stroke(x: number, y: number, glyph: string): void {
    if (x >= this.w || y >= this.h) return
    this.set(x, y, glyph, 'edge')
    this.trace(x, y)
  }

  /** Text of the current edge's label, as drawn. */
  labelRun(run: Run): void {
    this.edge?.label.push(run)
  }

  /**
   * Accumulate direction bits on a free cell; `border` cells keep their class. A cell a box holds
   * takes no bits, but still counts as the edge's, so the checks see where its route went.
   */
  addBits(x: number, y: number, bits: number, cls: Cls = 'edge'): void {
    if (x >= this.w || y >= this.h) return
    if (cls === 'edge') this.trace(x, y)
    const i = this.idx(x, y)
    if (this.occupied[i]) return
    this.mask[i] = this.mask[i]! | bits
    this.style[i] = this.style[i]! | this.curStyle
    if (this.cls[i] !== 'border') this.cls[i] = cls
  }

  /** Stamp a finished sub-canvas (a frame's contents) at an offset, with its records. */
  blit(sub: Canvas, ox: number, oy: number): void {
    for (let sy = 0; sy < sub.h; sy++) {
      for (let sx = 0; sx < sub.w; sx++) {
        const x = ox + sx
        const y = oy + sy
        if (x >= this.w || y >= this.h) continue
        const si = sub.idx(sx, sy)
        const di = this.idx(x, y)
        this.ch[di] = sub.ch[si]!
        this.cls[di] = sub.cls[si]!
        this.style[di] = sub.style[si]!
        this.occupied[di] = 1
      }
    }
    const run = (r: Run): Run => ({ ...r, x: r.x + ox, y: r.y + oy })
    const at = (c: Cell | null): Cell | null => c && [c[0] + ox, c[1] + oy]
    for (const b of sub.boxes) this.boxes.push({ ...b, x: b.x + ox, y: b.y + oy, lines: b.lines.map(run) })
    for (const f of sub.frames) this.frames.push({ ...f, x: f.x + ox, y: f.y + oy, title: f.title.map(run) })
    for (const p of sub.pieces.values()) {
      this.edge = this.piece(p.index, p.from, p.to)
      for (const [x, y] of p.cells) this.trace(x + ox, y + oy)
      this.edge.start ??= at(p.start)
      this.edge.head ??= at(p.head)
      this.edge.label.push(...p.label.map(run))
    }
    this.edge = null
  }

  /** Add direction bits even to an occupied cell, so an edge can meet a border. */
  junction(x: number, y: number, bits: number): void {
    if (x >= this.w || y >= this.h) return
    const i = this.idx(x, y)
    this.mask[i] = this.mask[i]! | bits
    if (this.cls[i] !== 'border') this.cls[i] = 'edge'
    this.trace(x, y)
  }

  segV(x: number, y0: number, y1: number): void {
    const a = Math.min(y0, y1)
    const b = Math.max(y0, y1)
    for (let y = a; y <= b; y++) {
      let bits = 0
      if (y > a) bits |= U
      if (y < b) bits |= D
      this.addBits(x, y, bits)
    }
  }

  segH(y: number, x0: number, x1: number): void {
    const a = Math.min(x0, x1)
    const b = Math.max(x0, x1)
    for (let x = a; x <= b; x++) {
      let bits = 0
      if (x > a) bits |= L
      if (x < b) bits |= R
      this.addBits(x, y, bits)
    }
  }

  /** Resolve accumulated direction bits into glyphs, honouring line style. */
  finalizeMask(): void {
    for (let i = 0; i < this.ch.length; i++) {
      if (this.mask[i] !== 0 && this.ch[i] === ' ') {
        const c = maskChar(this.mask[i]!)
        this.ch[i] = this.style[i] === STY_DOT ? dottedChar(c) : this.style[i] === STY_THICK ? thickChar(c) : c
      }
    }
  }

  /** The finished drawing: trailing blank rows dropped, coordinates kept. */
  toDrawing(): Drawing {
    const rows: string[][] = []
    let width = 0
    for (let y = 0; y < this.h; y++) {
      const row = this.ch.slice(y * this.w, (y + 1) * this.w).map(c => (c === CONT ? '' : c))
      let last = row.length
      while (last > 0 && row[last - 1] === ' ') last--
      // A row ending on a wide glyph ends on its '' continuation cell.
      width = Math.max(width, last)
      rows.push(row.slice(0, last))
    }
    while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop()
    const edges: DrawnEdge[] = [...this.pieces.values()].map(({ index, from, to, cells, start, head, label }) => ({
      index,
      from,
      to,
      cells: start ? [start, ...cells.filter(c => c[0] !== start[0] || c[1] !== start[1])] : cells,
      head,
      label,
    }))
    return { rows, lines: rows.map(r => r.join('')), width, boxes: this.boxes, frames: this.frames, edges }
  }
}

/** Each glyph of a line as it reads with the axes swapped: a line down turns into one to the right. */
const TURNED: Record<string, string> = {
  '─': '│', '│': '─', '┐': '└', '└': '┐', '━': '┃', '┃': '━', '┓': '┗', '┗': '┓', '╌': '╎', '╎': '╌',
  '▼': '►', '►': '▼', '▲': '◄', '◄': '▲',
}
const turnBits = (bits: number) => ((bits & U) && L) | ((bits & D) && R) | ((bits & L) && U) | ((bits & R) && D)

/**
 * The canvas as the layout sees it, which lays out every diagram top-down: `x` runs across the flow
 * and `y` along it. Turned, a drawing reads left to right: each point swaps its axes, and line bits and
 * glyphs turn with it. Text is not drawn through a view, since it stays level either way.
 */
export class View {
  readonly canvas: Canvas
  readonly turned: boolean

  constructor(canvas: Canvas, turned: boolean) {
    this.canvas = canvas
    this.turned = turned
  }

  private at(x: number, y: number): [number, number] {
    return this.turned ? [y, x] : [x, y]
  }
  private bits(bits: number): number {
    return this.turned ? turnBits(bits) : bits
  }
  private glyph(glyph: string): string {
    return this.turned ? TURNED[glyph] ?? glyph : glyph
  }

  addBits(x: number, y: number, bits: number): void {
    this.canvas.addBits(...this.at(x, y), this.bits(bits))
  }
  junction(x: number, y: number, bits: number): void {
    this.canvas.junction(...this.at(x, y), this.bits(bits))
  }
  start(x: number, y: number): void {
    this.canvas.start(...this.at(x, y))
  }
  tip(x: number, y: number): void {
    this.canvas.tip(...this.at(x, y))
  }
  head(x: number, y: number, glyph: string): void {
    this.canvas.head(...this.at(x, y), this.glyph(glyph))
  }
  set(x: number, y: number, glyph: string, cls: Cls): void {
    this.canvas.set(...this.at(x, y), this.glyph(glyph), cls)
  }
  stroke(x: number, y: number, glyph: string): void {
    this.canvas.stroke(...this.at(x, y), this.glyph(glyph))
  }
  /** A straight line from one point to another, across or along the flow. */
  line(ax: number, ay: number, bx: number, by: number): void {
    const [[x0, y0], [x1, y1]] = [this.at(ax, ay), this.at(bx, by)]
    if (x0 === x1) this.canvas.segV(x0, y0, y1)
    else this.canvas.segH(y0, x0, x1)
  }
}

/** Paint `text` at `x, y`, one grapheme cluster per cell; a wide cluster claims a second cell. */
export function drawText(canvas: Canvas, text: string, x: number, y: number, cls: Cls): void {
  let cur = x
  for (const [cluster, cw] of measured(text)) {
    if (cw === 0) continue
    canvas.set(cur, y, cluster, cls)
    for (let k = 1; k < cw; k++) canvas.set(cur + k, y, CONT, cls)
    cur += cw
  }
}

/** Paint `text` at `x, y`, clearing any edge bits underneath first, so the text wins over a line. */
export function drawTextOverEdges(canvas: Canvas, text: string, x: number, y: number, cls: Cls): void {
  let cur = x
  for (const [cluster, cw] of measured(text)) {
    if (cw === 0) continue
    for (let k = 0; k < cw; k++) {
      if (cur + k < canvas.w && y < canvas.h) canvas.mask[canvas.idx(cur + k, y)] = 0
      canvas.set(cur + k, y, k === 0 ? cluster : CONT, cls)
    }
    cur += cw
  }
}

export function maskChar(mask: number): string {
  switch (mask) {
    case 0:
      return ' '
    case U:
    case D:
    case U | D:
      return '│'
    case L:
    case R:
    case L | R:
      return '─'
    case D | R:
      return '┌'
    case D | L:
      return '┐'
    case U | R:
      return '└'
    case U | L:
      return '┘'
    case U | D | R:
      return '├'
    case U | D | L:
      return '┤'
    case D | L | R:
      return '┬'
    case U | L | R:
      return '┴'
    default:
      return '┼'
  }
}

const DOTTED: Record<string, string> = { '─': '╌', '│': '╎' }

const THICK: Record<string, string> = {
  '─': '━',
  '│': '┃',
  '┌': '┏',
  '┐': '┓',
  '└': '┗',
  '┘': '┛',
  '├': '┣',
  '┤': '┫',
  '┬': '┳',
  '┴': '┻',
  '┼': '╋',
}

export const dottedChar = (c: string): string => DOTTED[c] ?? c
export const thickChar = (c: string): string => THICK[c] ?? c
