// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

/**
 * Graph layout, top-down: assign ranks, reorder within ranks to cut crossings, then relax positions
 * across so chains stay straight. Edges between adjacent ranks share "bus" rows; everything else is
 * routed beside the diagram through vertical "lanes".
 */

import { Canvas, D, drawText, drawTextOverEdges, L, R, STY_DOT, STY_SOLID, STY_THICK, U } from './canvas'
import type { Edge, Head, Node, Shape } from './graph'
import { Graph } from './graph'
import { fitLabel, measured, stringWidth, wrapLabel } from './labels'
import type { Drawing } from './types'

/**
 * How tightly one drawing is packed: box labels wrap at `wrap` columns, boxes of a rank keep `gap`
 * columns apart, and edge labels are cut to `label` columns.
 */
export type Fit = { wrap: number; gap: number; label: number }

/** Cells of padding between a box border and its text. */
const PAD = 1
const GAP_Y = 2
/** Refuse to allocate a canvas larger than this many cells. */
const MAX_CANVAS_CELLS = 1 << 21

const sat = (a: number, b: number): number => Math.max(0, a - b)
const half = (n: number): number => Math.floor(n / 2)

export interface Placed {
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  rank: number
}

/** Per-node dimensions. `lay*` include room for self-edge loops and labels. */
interface NodeSizes {
  boxW: number[]
  boxH: number[]
  layW: number[]
  extraH: number[]
  selfLabelW: number[]
}

/** What to draw for a node: a box, or a group's frame holding its laid-out contents. */
type NodeExtra = { kind: 'plain' } | { kind: 'frame'; sub: Canvas }

interface RoutePlan {
  canvasW: number
  canvasH: number
  /** Row just past each rank's boxes, where its bus rows begin. */
  bandEnd: number[]
  /** Bus track offset per edge. */
  edgeBus: number[]
  /** Column of the first lane track. */
  laneBase: number
  /** Lane track offset per edge. */
  edgeLane: number[]
}

/** Draw a parsed flowchart or state diagram, or `null` when it is empty or over the cell cap. */
export function layout(graph: Graph, fit: Fit): Drawing | null {
  const canvas = graph.groups.length === 0 ? layoutCanvas(graph, graph.nodes.map(() => ({ kind: 'plain' })), fit) : layoutGrouped(graph, fit)
  return canvas && canvas.toDrawing()
}

// ------------------------------------------------------------------ ranking

/**
 * Longest-path ranking over the graph's DAG. Back edges (those closing a cycle) are excluded by a
 * DFS colouring pass, so `A --> B --> C --> A` still ranks 0, 1, 2.
 */
export function computeRanks(graph: Graph): number[] {
  const n = graph.nodes.length
  const children: number[][] = Array.from({ length: n }, () => [])
  const indeg = new Array<number>(n).fill(0)
  for (const e of graph.edges) {
    if (e.from !== e.to) {
      children[e.from]!.push(e.to)
      indeg[e.to]!++
    }
  }

  const color = new Uint8Array(n)
  const dag: number[][] = Array.from({ length: n }, () => [])
  const order: number[] = []

  // Roots first so ranks grow from natural entry points, then any leftovers.
  const roots = [...Array(n).keys()].filter(i => indeg[i] === 0)
  for (const start of [...roots, ...Array(n).keys()]) {
    if (color[start] === 0) dfsDag(start, children, color, dag, order)
  }

  const rank = new Array<number>(n).fill(0)
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i]!
    for (const v of dag[u]!) rank[v] = Math.max(rank[v]!, rank[u]! + 1)
  }
  return rank
}

/** Iterative DFS recording postorder and skipping edges back into the stack. */
function dfsDag(start: number, children: number[][], color: Uint8Array, dag: number[][], order: number[]): void {
  const stack: { u: number; i: number }[] = [{ u: start, i: 0 }]
  color[start] = 1
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!
    const u = frame.u
    if (frame.i < children[u]!.length) {
      const v = children[u]![frame.i]!
      frame.i++
      if (color[v] === 1) continue // grey: a back edge, ignore it
      dag[u]!.push(v)
      if (color[v] === 0) {
        color[v] = 1
        stack.push({ u: v, i: 0 })
      }
    } else {
      color[u] = 2
      order.push(u)
      stack.pop()
    }
  }
}

/**
 * Reorder nodes within each rank to cut edge crossings (barycenter sweeps): alternate down and up
 * passes sort each rank by the mean position of its neighbours, keeping the ordering that crossed least.
 */
export function orderRanks(byRank: number[][], edges: Edge[], ranks: number[]): void {
  const n = ranks.length
  if (byRank.length < 2 || n < 3) return

  const parents: number[][] = Array.from({ length: n }, () => [])
  const children: number[][] = Array.from({ length: n }, () => [])
  for (const e of edges) {
    if (e.from !== e.to && ranks[e.to]! > ranks[e.from]!) {
      parents[e.to]!.push(e.from)
      children[e.from]!.push(e.to)
    }
  }

  const pos = new Array<number>(n).fill(0)
  const reindex = (row: number[]): void => {
    for (let i = 0; i < row.length; i++) pos[row[i]!] = i
  }
  for (const row of byRank) reindex(row)

  let best = byRank.map(row => [...row])
  let bestCrossings = countCrossings(edges, ranks, pos)
  if (bestCrossings === 0) return

  for (let it = 0; it < 8; it++) {
    const rows = it % 2 === 0 ? byRank.slice(1) : byRank.slice(0, -1).reverse()
    const neigh = it % 2 === 0 ? parents : children
    for (const row of rows) {
      sortByBarycenter(row, neigh, pos)
      reindex(row)
    }
    const crossings = countCrossings(edges, ranks, pos)
    if (crossings < bestCrossings) {
      bestCrossings = crossings
      best = byRank.map(row => [...row])
    }
    if (bestCrossings === 0) break
  }

  for (let i = 0; i < byRank.length; i++) byRank[i]!.splice(0, byRank[i]!.length, ...best[i]!)
}

function sortByBarycenter(row: number[], neigh: number[][], pos: number[]): void {
  const keyed = row.map(v => ({
    key: neigh[v]!.length === 0 ? pos[v]! : neigh[v]!.reduce((s, u) => s + pos[u]!, 0) / neigh[v]!.length,
    v,
  }))
  keyed.sort((a, b) => a.key - b.key)
  for (let i = 0; i < keyed.length; i++) row[i] = keyed[i]!.v
}

export function countCrossings(edges: Edge[], ranks: number[], pos: number[]): number {
  const adjacent = edges
    .filter(e => e.from !== e.to && ranks[e.to] === ranks[e.from]! + 1)
    .map(e => [ranks[e.from]!, pos[e.from]!, pos[e.to]!] as const)
  let crossings = 0
  for (let i = 0; i < adjacent.length; i++) {
    const a = adjacent[i]!
    for (let j = i + 1; j < adjacent.length; j++) {
      const b = adjacent[j]!
      if (a[0] === b[0] && ((a[1] < b[1] && a[2] > b[2]) || (a[1] > b[1] && a[2] < b[2]))) crossings++
    }
  }
  return crossings
}

/**
 * Assign a horizontal centre to every node so nodes line up under their neighbours: each node
 * drifts toward the average of its neighbours while ranks keep their order and boxes keep `sep` apart.
 */
export function assignPositions(byRank: number[][], size: number[], sep: number, edges: Edge[], ranks: number[]): number[] {
  const n = size.length
  const parents: number[][] = Array.from({ length: n }, () => [])
  const children: number[][] = Array.from({ length: n }, () => [])
  for (const e of edges) {
    if (e.from !== e.to && ranks[e.to]! > ranks[e.from]!) {
      parents[e.to]!.push(e.from)
      children[e.from]!.push(e.to)
    }
  }

  const pos = new Array<number>(n).fill(0)
  for (const row of byRank) {
    let x = 0
    for (const v of row) {
      const h = size[v]! / 2
      x += h
      pos[v] = x
      x += h + sep
    }
  }

  for (let it = 0; it < 10; it++) {
    const rows = it % 2 === 0 ? byRank : [...byRank].reverse()
    const neigh = it % 2 === 0 ? parents : children
    for (const row of rows) relaxRank(row, neigh, pos, size, sep)
  }

  let minLeft = Number.POSITIVE_INFINITY
  for (let v = 0; v < n; v++) minLeft = Math.min(minLeft, pos[v]! - size[v]! / 2)
  if (!Number.isFinite(minLeft)) minLeft = 0
  return Array.from({ length: n }, (_, v) => Math.max(0, Math.round(pos[v]! - minLeft)))
}

function relaxRank(nodes: number[], neigh: number[][], pos: number[], size: number[], sep: number): void {
  const n = nodes.length
  if (n === 0) return

  const desired = nodes.map(v => (neigh[v]!.length === 0 ? pos[v]! : neigh[v]!.reduce((s, u) => s + pos[u]!, 0) / neigh[v]!.length))
  const halfOf = (i: number): number => size[nodes[i]!]! / 2

  // Sweep right then left and take the midpoint: this centres a node between the tightest packing
  // that respects order from either side.
  const left = new Array<number>(n)
  for (let i = 0; i < n; i++) left[i] = i === 0 ? desired[i]! : Math.max(desired[i]!, left[i - 1]! + halfOf(i - 1) + sep + halfOf(i))
  const right = new Array<number>(n)
  for (let i = n - 1; i >= 0; i--) right[i] = i === n - 1 ? desired[i]! : Math.min(desired[i]!, right[i + 1]! - halfOf(i + 1) - sep - halfOf(i))
  for (let i = 0; i < n; i++) pos[nodes[i]!] = (left[i]! + right[i]!) / 2
  for (let i = 1; i < n; i++) {
    const minP = pos[nodes[i - 1]!]! + halfOf(i - 1) + sep + halfOf(i)
    if (pos[nodes[i]!]! < minP) pos[nodes[i]!] = minP
  }
}

// ------------------------------------------------------------------- tracks

/** A span competing for a track: `[start, end, from, to, edgeIndex]`. */
type Span5 = [number, number, number, number, number]

/**
 * Pack spans into as few parallel tracks as possible. Two spans share a track when they are two
 * cells apart, or when they share an endpoint, so edges fanning out of one node reuse a single row.
 */
export function assignTracks(spans: Span5[]): { assigned: [number, number][]; count: number } {
  const sorted = [...spans].sort((a, b) => {
    for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
    return 0
  })
  const tracks: [number, number, number, number][][] = []
  const assigned: [number, number][] = []
  for (const [s, e, f, t, idx] of sorted) {
    let slot = tracks.findIndex(members => members.every(([s2, e2, f2, t2]) => e2 + 2 <= s || e + 2 <= s2 || f2 === f || t2 === t))
    if (slot === -1) {
      tracks.push([])
      slot = tracks.length - 1
    }
    tracks[slot]!.push([s, e, f, t])
    assigned.push([idx, slot])
  }
  return { assigned, count: tracks.length }
}

/** Edges from rank `r` to `r + 1` that must jog sideways, so need a bus row. */
function busSpans(graph: Graph, ranks: number[], centers: number[], r: number): Span5[] {
  const out: Span5[] = []
  graph.edges.forEach((e, i) => {
    const jogs = Math.abs(centers[e.from]! - centers[e.to]!) > 1
    if (e.from !== e.to && ranks[e.from] === r && ranks[e.to] === r + 1 && jogs) {
      out.push([Math.min(centers[e.from]!, centers[e.to]!), Math.max(centers[e.from]!, centers[e.to]!), e.from, e.to, i])
    }
  })
  return out
}

/** Edges skipping a rank or running backwards; these go around in a lane. */
function laneSpans(graph: Graph, ranks: number[], placed: Placed[]): Span5[] {
  const out: Span5[] = []
  graph.edges.forEach((e, i) => {
    if (e.from === e.to || ranks[e.to] === ranks[e.from]! + 1) return
    const pf = placed[e.from]!
    const pt = placed[e.to]!
    out.push([Math.min(pf.cy, pt.cy), Math.max(pf.cy, pt.cy), e.from, e.to, i])
  })
  return out
}

/** An edge label as drawn in this item: on one line, cut to the fit's label width. */
const edgeText = (label: string, fit: Fit): string => fitLabel(label.replace(/\s+/g, ' ').trim(), fit.label)

// ----------------------------------------------------------------- placement

function placeTd(ranks: number[], maxRank: number, byRank: number[][], sizes: NodeSizes, graph: Graph, placed: Placed[], fit: Fit): RoutePlan {
  // Positions are rounded centres, which can leave every box a column off the left edge.
  const centers = assignPositions(byRank, sizes.layW, fit.gap, graph.edges, ranks)
  const left = Math.min(...centers.map((cx, i) => cx - half(sizes.boxW[i]!)))
  if (left > 0) centers.forEach((cx, i) => (centers[i] = cx - left))

  const edgeBus = new Array<number>(graph.edges.length).fill(0)
  const busTracks = new Array<number>(maxRank + 1).fill(0)
  for (let r = 0; r < maxRank; r++) {
    const spans = busSpans(graph, ranks, centers, r)
    if (spans.length === 0) continue
    const { assigned, count } = assignTracks(spans)
    for (const [idx, slot] of assigned) edgeBus[idx] = slot
    busTracks[r] = count
  }

  const rankH = byRank.map(row => (row.length === 0 ? 3 : Math.max(...row.map(i => sizes.boxH[i]! + sizes.extraH[i]!))))
  const rankY = new Array<number>(maxRank + 1).fill(0)
  for (let r = 1; r <= maxRank; r++) rankY[r] = rankY[r - 1]! + rankH[r - 1]! + Math.max(GAP_Y, busTracks[r - 1]! + 1)
  const canvasH = rankY[maxRank]! + rankH[maxRank]!
  const bandEnd = Array.from({ length: maxRank + 1 }, (_, r) => rankY[r]! + rankH[r]!)

  let diagramW = 1
  byRank.forEach((row, r) => {
    for (const idx of row) {
      const w = sizes.boxW[idx]!
      const h = sizes.boxH[idx]!
      const cx = centers[idx]!
      const x = sat(cx, half(w))
      const y = rankY[r]! + half(rankH[r]! - h - sizes.extraH[idx]!)
      placed[idx] = { x, y, w, h, cx, cy: y + half(h), rank: r }
      diagramW = Math.max(diagramW, x + w)
      if (sizes.extraH[idx]! > 0 && sizes.selfLabelW[idx]! > 0) diagramW = Math.max(diagramW, x + w + 2 + sizes.selfLabelW[idx]!)
    }
  })

  let contentW = diagramW
  for (const e of graph.edges) {
    if (e.from === e.to || e.label === null) continue
    const lw = stringWidth(edgeText(e.label, fit))
    contentW = ranks[e.to] === ranks[e.from]! + 1 ? Math.max(contentW, placed[e.to]!.cx + 2 + lw) : Math.max(contentW, diagramW + lw + 1)
  }

  const edgeLane = new Array<number>(graph.edges.length).fill(0)
  const lanes = laneSpans(graph, ranks, placed)
  let canvasW = contentW
  let laneBase = 0
  if (lanes.length > 0) {
    const { assigned, count } = assignTracks(lanes)
    for (const [idx, slot] of assigned) edgeLane[idx] = slot
    canvasW = contentW + 1 + count
    laneBase = contentW + 1
  }

  return { canvasW, canvasH, bandEnd, edgeBus, laneBase, edgeLane }
}

// -------------------------------------------------------------------- canvas

/** A frame's title wraps to the frame's width when that is wider than the fit's. */
const frameTitle = (label: string, sub: Canvas, fit: Fit): string[] => wrapLabel(label, Math.max(fit.wrap, sub.w - 2))

const widest = (lines: string[]): number => Math.max(1, ...lines.map(stringWidth))

/** Rank, place, draw and route a graph onto a fresh canvas. */
function layoutCanvas(graph: Graph, extras: NodeExtra[], fit: Fit): Canvas | null {
  const n = graph.nodes.length
  if (n === 0) return null

  const ranks = computeRanks(graph)
  const maxRank = Math.max(...ranks, 0)

  const byRank: number[][] = Array.from({ length: maxRank + 1 }, () => [])
  for (let idx = 0; idx < ranks.length; idx++) byRank[ranks[idx]!]!.push(idx)
  orderRanks(byRank, graph.edges, ranks)

  const texts = extras.map((extra, i) => (extra.kind === 'frame' ? frameTitle(graph.nodes[i]!.label, extra.sub, fit) : wrapLabel(graph.nodes[i]!.label, fit.wrap)))
  const boxW = extras.map((extra, i) => (extra.kind === 'frame' ? Math.max(extra.sub.w + 2, widest(texts[i]!) + 4) : widest(texts[i]!) + 2 * PAD + 2))
  const boxH = extras.map((extra, i) => (extra.kind === 'frame' ? extra.sub.h + 1 + texts[i]!.length : texts[i]!.length + 2))

  // A self-edge needs two rows below its box, and room beside it for a label.
  const extraH = new Array<number>(n).fill(0)
  const selfLabelW = new Array<number>(n).fill(0)
  for (const e of graph.edges) {
    if (e.from !== e.to) continue
    extraH[e.from] = 2
    if (e.label !== null) selfLabelW[e.from] = Math.max(selfLabelW[e.from]!, stringWidth(edgeText(e.label, fit)))
  }
  for (let i = 0; i < n; i++) if (extraH[i]! > 0) boxW[i] = Math.max(boxW[i]!, 7)

  const sizes: NodeSizes = {
    boxW,
    boxH,
    layW: boxW.map((w, i) => w + (selfLabelW[i]! > 0 ? 2 * (selfLabelW[i]! + 3) : 0)),
    extraH,
    selfLabelW,
  }

  const placed: Placed[] = Array.from({ length: n }, () => ({ x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0, rank: 0 }))
  const plan = placeTd(ranks, maxRank, byRank, sizes, graph, placed, fit)
  if (plan.canvasW * plan.canvasH > MAX_CANVAS_CELLS) return null

  const canvas = new Canvas(plan.canvasW, plan.canvasH)
  for (let idx = 0; idx < n; idx++) {
    const extra = extras[idx]!
    const node = graph.nodes[idx]!
    if (extra.kind === 'frame') drawFrame(canvas, placed[idx]!, node, texts[idx]!, extra.sub)
    else drawBox(canvas, placed[idx]!, node, texts[idx]!)
  }

  graph.edges.forEach((edge, i) => {
    canvas.curStyle = edge.line === 'dotted' ? STY_DOT : edge.line === 'thick' ? STY_THICK : STY_SOLID
    canvas.beginEdge({ index: edge.index, from: graph.nodes[edge.from]!.key, to: graph.nodes[edge.to]!.key, cells: [], head: null, label: [] })
    const label = edge.label === null ? null : edgeText(edge.label, fit)
    const from = placed[edge.from]!
    const to = placed[edge.to]!
    if (edge.from === edge.to) routeSelf(canvas, from, edge, label)
    else if (to.rank === from.rank + 1) routeForward(canvas, from, to, edge, label, plan.bandEnd[from.rank]! + plan.edgeBus[i]!)
    else routeBack(canvas, from, to, edge, label, plan.laneBase + plan.edgeLane[i]!)
    canvas.endEdge()
  })

  canvas.finalizeMask()
  return canvas
}

// -------------------------------------------------------------------- groups

type ItemKey = string
const nodeKey = (i: number): ItemKey => `n:${i}`
const groupKey = (i: number): ItemKey => `g:${i}`

/**
 * Lay out a diagram with groups (subgraphs, composite states). Each group becomes a framed box
 * holding its own laid-out canvas. An edge is drawn in the innermost scope containing both
 * endpoints; one crossing a group's boundary attaches to the frame instead of the node.
 */
function layoutGrouped(graph: Graph, fit: Fit): Canvas | null {
  const proxy = new Map<number, number>()
  graph.nodes.forEach((_, ni) => {
    const gi = graph.proxyOf(ni)
    if (gi !== undefined) proxy.set(ni, gi)
  })

  const groupChain = (g: number | null): number[] => {
    const chain: number[] = []
    let cur = g
    while (cur !== null) {
      chain.push(cur)
      cur = graph.groups[cur]!.parent
    }
    return chain.reverse()
  }
  const endpoint = (n: number): { key: ItemKey; chain: number[] } => {
    const gi = proxy.get(n)
    return gi === undefined ? { key: nodeKey(n), chain: groupChain(graph.nodeGroup[n]!) } : { key: groupKey(gi), chain: groupChain(graph.groups[gi]!.parent) }
  }

  /** Edges bucketed by the scope that draws them; `null` is the top level. */
  const scopeEdges = new Map<number | null, [ItemKey, ItemKey, number][]>()
  graph.edges.forEach((e, ei) => {
    const f = endpoint(e.from)
    const t = endpoint(e.to)
    let k = 0
    while (k < f.chain.length && k < t.chain.length && f.chain[k] === t.chain[k]) k++
    const scope = k === 0 ? null : f.chain[k - 1]!
    const fKey = f.chain.length > k ? groupKey(f.chain[k]!) : f.key
    const tKey = t.chain.length > k ? groupKey(t.chain[k]!) : t.key
    const list = scopeEdges.get(scope)
    if (list) list.push([fKey, tKey, ei])
    else scopeEdges.set(scope, [[fKey, tKey, ei]])
  })

  const directNodes = new Map<number | null, number[]>()
  graph.nodeGroup.forEach((g, ni) => {
    if (proxy.has(ni)) return
    const list = directNodes.get(g)
    if (list) list.push(ni)
    else directNodes.set(g, [ni])
  })

  return buildScope(graph, null, scopeEdges, directNodes, fit)
}

function buildScope(
  graph: Graph,
  scope: number | null,
  scopeEdges: Map<number | null, [ItemKey, ItemKey, number][]>,
  directNodes: Map<number | null, number[]>,
  fit: Fit,
): Canvas | null {
  const items: ItemKey[] = (directNodes.get(scope) ?? []).map(nodeKey)
  items.push(...graph.groups.flatMap((g, gi) => (g.parent === scope ? [groupKey(gi)] : [])))

  if (items.length === 0) return new Canvas(1, 1)

  const indexOf = new Map<ItemKey, number>()
  const nodes: Node[] = []
  const extras: NodeExtra[] = []
  for (const item of items) {
    indexOf.set(item, nodes.length)
    const i = Number(item.slice(2))
    if (item.startsWith('n')) {
      nodes.push({ ...graph.nodes[i]! })
      extras.push({ kind: 'plain' })
    } else {
      const sub = buildScope(graph, i, scopeEdges, directNodes, fit)
      if (sub === null) return null
      nodes.push({ key: item, label: graph.groups[i]!.label, shape: 'rect' })
      extras.push({ kind: 'frame', sub })
    }
  }

  const edges: Edge[] = []
  for (const [f, t, ei] of scopeEdges.get(scope) ?? []) {
    const fi = indexOf.get(f)
    const ti = indexOf.get(t)
    if (fi === undefined || ti === undefined) continue
    edges.push({ ...graph.edges[ei]!, from: fi, to: ti })
  }

  // Layout reads only nodes and edges, so a bare Graph carrying those is enough.
  const synth = new Graph()
  synth.nodes = nodes
  synth.edges = edges
  return layoutCanvas(synth, extras, fit)
}

// ------------------------------------------------------------------- drawing

function drawBox(canvas: Canvas, p: Placed, node: Node, lines: string[]): void {
  outline(canvas, p, node.shape)
  const inner = Math.max(1, sat(p.w, 2 * PAD + 2))
  const runs = lines.map((text, li) => ({ x: p.x + 1 + PAD + half(sat(inner, stringWidth(text))), y: p.y + 1 + li, text }))
  for (const run of runs) drawText(canvas, run.text, run.x, run.y, 'text')
  canvas.boxes.push({ key: node.key, x: p.x, y: p.y, w: p.w, h: p.h, lines: runs })
}

function outline(canvas: Canvas, p: Placed, shape: Shape): void {
  const { x, y, w, h } = p
  const right = x + w - 1
  const bottom = y + h - 1

  const rounded = shape === 'round' || shape === 'diamond'
  canvas.set(x, y, rounded ? '╭' : '┌', 'border')
  canvas.set(right, y, rounded ? '╮' : '┐', 'border')
  canvas.set(x, bottom, rounded ? '╰' : '└', 'border')
  canvas.set(right, bottom, rounded ? '╯' : '┘', 'border')

  // The perimeter is drawn as bits so edges can tee into it, but it is the box outline, so it
  // claims `border` rather than `edge`.
  for (let cx = x + 1; cx < right; cx++) {
    canvas.addBits(cx, y, L | R, 'border')
    canvas.addBits(cx, bottom, L | R, 'border')
  }
  for (let cy = y + 1; cy < bottom; cy++) {
    canvas.addBits(x, cy, U | D, 'border')
    canvas.addBits(right, cy, U | D, 'border')
  }

  for (let cy = y; cy <= bottom; cy++) {
    for (let cx = x; cx <= right; cx++) canvas.occupied[canvas.idx(cx, cy)] = 1
  }
}

/** A frame: its title's first line on the top border, the rest under it, then its contents. */
function drawFrame(canvas: Canvas, p: Placed, node: Node, title: string[], sub: Canvas): void {
  outline(canvas, p, 'rect')
  const runs = title.map((text, i) => ({ x: p.x + 2, y: p.y + i, text }))
  drawTextOverEdges(canvas, ` ${runs[0]!.text} `, p.x + 1, p.y, 'text')
  for (const run of runs.slice(1)) drawText(canvas, run.text, run.x, run.y, 'text')
  const top = p.y + title.length
  canvas.blit(sub, p.x + 1 + half(p.w - 2 - sub.w), top + half(p.y + p.h - 1 - top - sub.h))
  canvas.frames.push({ key: node.key, x: p.x, y: p.y, w: p.w, h: p.h, title: runs })
}

// ------------------------------------------------------------------- routing

function headGlyph(head: Head, arrow: string): string {
  return head === 'circle' ? 'o' : head === 'cross' ? '×' : arrow
}

/** Adjacent ranks: drop, jog along the bus row, drop into the head. */
function routeForward(canvas: Canvas, from: Placed, to: Placed, edge: Edge, label: string | null, bus: number): void {
  const tx = to.cx
  // A jog of one column reads as a kink; snap straight instead.
  const bx = Math.abs(from.cx - tx) <= 1 ? tx : from.cx
  const by = from.y + from.h - 1
  const headRow = to.y - 1

  canvas.junction(bx, by, D)
  canvas.segV(bx, by, bus)
  if (bx === tx) {
    canvas.segV(bx, bus, headRow)
  } else {
    canvas.segH(bus, bx, tx)
    canvas.segV(tx, bus, headRow)
  }

  if (edge.headTo === 'none') {
    canvas.addBits(tx, headRow, U)
    canvas.tip(tx, headRow)
  } else canvas.head(tx, headRow, headGlyph(edge.headTo, '▼'))
  if (edge.headFrom !== 'none') canvas.set(bx, by, headGlyph(edge.headFrom, '▲'), 'edge')

  if (label !== null) placeLabel(canvas, label, headRow, tx + 1)
}

/** A self-edge: a stub loop hanging below the box. */
function routeSelf(canvas: Canvas, p: Placed, edge: Edge, label: string | null): void {
  const bottom = p.y + p.h - 1
  const exitX = p.cx + 1
  const retX = p.x + p.w - 2
  if (retX <= exitX || bottom + 2 >= canvas.h) return

  const [v, h, bl, br] = edge.line === 'dotted' ? ['╎', '╌', '╰', '╯'] : edge.line === 'thick' ? ['┃', '━', '┗', '┛'] : ['│', '─', '╰', '╯']

  canvas.junction(exitX, bottom, D)
  canvas.stroke(exitX, bottom + 1, v)
  canvas.stroke(exitX, bottom + 2, bl)
  for (let x = exitX + 1; x < retX; x++) canvas.stroke(x, bottom + 2, h)
  canvas.stroke(retX, bottom + 2, br)
  canvas.head(retX, bottom + 1, headGlyph(edge.headTo, '▲'))
  if (label !== null) placeLabel(canvas, label, bottom + 1, p.x + p.w + 1)
}

/** Skip or back edge: out the right side, along a lane, back in. */
function routeBack(canvas: Canvas, from: Placed, to: Placed, edge: Edge, label: string | null, laneX: number): void {
  const sx = from.x + from.w - 1
  const sy = from.cy
  const tx = to.x + to.w - 1
  const tyc = to.cy

  canvas.junction(sx, sy, R)
  canvas.segH(sy, sx, laneX)
  canvas.segV(laneX, sy, tyc)
  canvas.segH(tyc, tx + 1, laneX)

  if (edge.headTo === 'none') {
    canvas.addBits(tx + 1, tyc, R)
    canvas.tip(tx + 1, tyc)
  } else canvas.head(tx + 1, tyc, headGlyph(edge.headTo, '◄'))
  if (edge.headFrom !== 'none') canvas.set(sx, sy, headGlyph(edge.headFrom, '◄'), 'edge')

  if (label !== null) placeLabel(canvas, label, sat(tyc, 1), sat(laneX, stringWidth(label) + 1))
}

/** Write an edge label, stopping at the first cell already taken. */
function placeLabel(canvas: Canvas, text: string, row: number, startX: number): void {
  if (row >= canvas.h) return
  const run = { x: startX, y: row, text: '' }
  let x = startX
  for (const [c, cw] of measured(text)) {
    if (cw === 0) continue
    if (x + cw > canvas.w) break
    let blocked = false
    for (let k = 0; k < cw; k++) {
      const i = canvas.idx(x + k, row)
      if (canvas.ch[i] !== ' ' || canvas.mask[i] !== 0 || canvas.occupied[i]) blocked = true
    }
    if (blocked) break
    drawText(canvas, c, x, row, 'edgeLabel')
    run.text += c
    x += cw
  }
  canvas.labelRun(run)
}
