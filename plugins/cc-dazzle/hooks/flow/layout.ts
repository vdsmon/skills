// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

/**
 * Graph layout, top-down. Boxes take ranks; each rank is a level of the drawing, and where an edge
 * label needs room a level of labels sits between two ranks. An edge that spans several levels
 * passes each as a one-column node, and its label is a node as wide as its text, so the layout places
 * lines and labels as it places boxes and nothing is drawn on anything else. Between two levels lies
 * a channel of rows where lines turn; a back edge leaves its box by the top and comes into its target
 * from below. A frame is laid out on its own, with a level above and below its contents where edges
 * cross its border, and becomes one node of the level around it.
 */

import { Canvas, D, drawText, drawTextOverEdges, L, R, STY_DOT, STY_SOLID, STY_THICK, U } from './canvas'
import type { Edge, Head, Shape } from './graph'
import type { Graph } from './graph'
import { stringWidth, wrapLabel } from './labels'
import type { Drawing } from './types'

/**
 * How tightly one drawing is packed: box labels wrap at `wrap` columns, boxes of a level keep `gap`
 * columns apart, and edge labels wrap at `label` columns.
 */
export type Fit = { wrap: number; gap: number; label: number }

/**
 * What narrowing a drawing past its fit has changed: the ranks of a scope's items, where rows were
 * split, and, by edge, a label wrapped narrower than the fit's or moved to a level of labels of its
 * own (`sub` orders the levels of labels between two rows).
 */
export type Narrowing = { ranks: Map<number | null, number[]>; labels: Map<number, { wrap: number; sub: number }> }

export const UNNARROWED: Narrowing = { ranks: new Map(), labels: new Map() }

/** One level of a scope: what is on it, left to right, and the columns each takes when packed. */
export type Level = {
  kind: 'rank' | 'label' | 'border'
  /** The rank of a row; for a level of labels, the rank above it (-1 above the first) and its `sub`. */
  rank: number
  sub: number
  nodes: { item: string | null; edge: number | null; start: number; end: number }[]
}

/** A scope as laid out: its levels, and the items and ranks it was laid out with. */
export type Scope = { levels: Level[]; items: string[]; ranks: number[] }

export type Layout = { drawing: Drawing; scopes: Map<number | null, Scope> }

/** Cells of padding between a box border and its text. */
const PAD = 1
/** Refuse to allocate a canvas larger than this many cells, or to place more nodes than this. */
const MAX_CANVAS_CELLS = 1 << 21
const MAX_NODES = 1 << 14
/** Slots per rank: a rank's level, then up to this many minus one levels of labels under it. */
const SLOTS = 1 << 10

const half = (n: number): number => Math.floor(n / 2)
const widest = (lines: string[]): number => Math.max(0, ...lines.map(stringWidth))

/** Draw a parsed flowchart or state diagram, or `null` when it is empty or over a cap. */
export function layout(graph: Graph, fit: Fit, narrowing: Narrowing = UNNARROWED): Layout | null {
  const plans = planScopes(graph, narrowing)
  const scopes = new Map<number | null, Scope>()
  const laid = layScope(graph, null, plans, { ...fit, narrowing, scopes })
  return laid && { drawing: laid.canvas.toDrawing(), scopes }
}

/** A fit with the narrowing applied past it, and where each scope reports how it was laid out. */
type Packing = Fit & { narrowing: Narrowing; scopes: Map<number | null, Scope> }

const labelWrap = (edge: Edge, pack: Packing) => pack.narrowing.labels.get(edge.index)?.wrap ?? pack.label

// ------------------------------------------------------------------- scopes

type Side = 'top' | 'bottom'
/**
 * What an edge does where it meets a frame's border: `cross` passes through it to a box inside,
 * `own` ends on the frame from outside, `start` leaves the frame's border for a box inside it, and
 * `end` comes from a box inside to the frame's border.
 */
type Role = 'cross' | 'own' | 'start' | 'end'
type Port = { edge: number; side: Side; x: number; role: Role }
/** A laid-out scope: its canvas, where edges meet its frame's border, and the frame's title lines. */
type Laid = { canvas: Canvas; ports: Port[]; title: string[]; levels: Level[] }

type End = { item: string } | { side: Side; role: Role }
/** An edge, or the part of one, drawn in a scope: `from` and `to` are its items or its frame's border. */
type Link = { edge: Edge; keys: [string, string]; from: End; to: End; label: string | null }
type Plan = { items: string[]; links: Link[]; reserve: { edge: number; side: Side }[]; ranks: number[] }

/**
 * Split the graph into scopes: the top level and each group. An edge is drawn in the innermost scope
 * holding both its ends, between the items there that hold them; where an end lies inside a frame,
 * each frame on the way draws the part from its border to the end.
 */
function planScopes(graph: Graph, narrowing: Narrowing): Map<number | null, Plan> {
  const plans = new Map<number | null, Plan>()
  const plan = (s: number | null): Plan => plans.get(s) ?? plans.set(s, { items: [], links: [], reserve: [], ranks: [] }).get(s)!
  const chain = (g: number | null): number[] => {
    const out: number[] = []
    for (let cur = g; cur !== null; cur = graph.groups[cur]!.parent) out.unshift(cur)
    return out
  }
  const endOf = (n: number) => {
    const group = graph.proxyOf(n)
    return group === undefined ? { key: `n:${n}`, chain: chain(graph.nodeGroup[n]!), group } : { key: `g:${group}`, chain: chain(graph.groups[group]!.parent), group }
  }
  type EndOf = ReturnType<typeof endOf>
  const itemAt = (e: EndOf, k: number): string => (e.chain.length > k ? `g:${e.chain[k]}` : e.key)

  plan(null)
  graph.nodes.forEach((_, n) => {
    if (graph.proxyOf(n) === undefined) plan(graph.nodeGroup[n]!).items.push(`n:${n}`)
  })
  graph.groups.forEach((g, i) => {
    plan(g.parent).items.push(`g:${i}`)
    plan(i)
  })

  /** The parts of `edge` inside the frames of `e.chain` from depth `k` on, leaving or entering by `side`. */
  const descend = (link: Omit<Link, 'from' | 'to' | 'label'>, e: EndOf, k: number, side: Side, leaving: boolean) => {
    for (let j = k; j < e.chain.length; j++) {
      const inner: End = { item: itemAt(e, j + 1) }
      const border: End = { side, role: 'cross' }
      plan(e.chain[j]!).links.push({ ...link, from: leaving ? inner : border, to: leaving ? border : inner, label: null })
    }
    if (e.group !== undefined) plan(e.group).reserve.push({ edge: link.edge.index, side })
  }

  const across: { link: Link; scope: number | null; f: EndOf; t: EndOf; k: number }[] = []
  for (const edge of graph.edges) {
    const f = endOf(edge.from)
    const t = endOf(edge.to)
    const base = { edge, keys: [f.key, t.key] as [string, string] }
    let k = 0
    while (k < f.chain.length && k < t.chain.length && f.chain[k] === t.chain[k]) k++
    if (f.group !== undefined && k === f.chain.length && t.chain[k] === f.group) {
      // From a frame to something inside it: the line leaves the frame's top border inward.
      plan(f.group).links.push({ ...base, from: { side: 'top', role: 'start' }, to: { item: itemAt(t, k + 1) }, label: edge.label })
      descend(base, t, k + 1, 'top', false)
    } else if (t.group !== undefined && k === t.chain.length && f.chain[k] === t.group) {
      plan(t.group).links.push({ ...base, from: { item: itemAt(f, k + 1) }, to: { side: 'bottom', role: 'end' }, label: edge.label })
      descend(base, f, k + 1, 'bottom', true)
    } else {
      const scope = k === 0 ? null : f.chain[k - 1]!
      const link: Link = { ...base, from: { item: itemAt(f, k) }, to: { item: itemAt(t, k) }, label: edge.label }
      plan(scope).links.push(link)
      across.push({ link, scope, f, t, k })
    }
  }
  // Split rows keep every linked pair of items in the order ranking gave them, so which side of a
  // frame an edge crosses does not change.
  for (const [scope, p] of plans) {
    const index = new Map(p.items.map((key, i) => [key, i]))
    const pairs: [number, number][] = []
    for (const l of p.links) {
      if ('item' in l.from && 'item' in l.to && l.from.item !== l.to.item) pairs.push([index.get(l.from.item)!, index.get(l.to.item)!])
    }
    p.ranks = narrowing.ranks.get(scope) ?? computeRanks(p.items.length, pairs)
  }

  for (const { link, scope, f, t, k } of across) {
    if (!('item' in link.from && 'item' in link.to) || link.from.item === link.to.item) continue
    const p = plan(scope)
    const down = p.ranks[p.items.indexOf(link.to.item)]! > p.ranks[p.items.indexOf(link.from.item)]!
    descend(link, f, k, down ? 'bottom' : 'top', true)
    descend(link, t, k, down ? 'top' : 'bottom', false)
  }
  return plans
}

type Item = { key: string; label: string; shape: Shape; sub: Laid | null }

function layScope(graph: Graph, scope: number | null, plans: Map<number | null, Plan>, pack: Packing): Laid | null {
  const plan = plans.get(scope)!
  const items: Item[] = []
  for (const key of plan.items) {
    const i = Number(key.slice(2))
    if (key.startsWith('n')) {
      items.push({ key, label: graph.nodes[i]!.label, shape: graph.nodes[i]!.shape, sub: null })
    } else {
      const sub = layScope(graph, i, plans, pack)
      if (sub === null) return null
      items.push({ key, label: graph.groups[i]!.label, shape: 'rect', sub })
    }
  }
  const report = (laid: Laid | null) => {
    if (laid !== null) pack.scopes.set(scope, { levels: laid.levels, items: plan.items, ranks: plan.ranks })
    return laid
  }
  if (scope === null) return report(arrange(items, plan, null, pack))
  // The frame's own self-loops, drawn on its border by its parent, set the least height of its contents.
  const key = `g:${scope}`
  const own = plans.get(graph.groups[scope]!.parent)!.links.filter(l => 'item' in l.from && 'item' in l.to && l.from.item === key && l.to.item === key)
  const least = own.length === 0 ? 0 : stackLoops(own.map(l => loopOf(l, pack))).box - 2
  // A frame's title wraps to the frame's width when that is wider than the fit's.
  const label = graph.groups[scope]!.label
  const title = wrapLabel(label, pack.wrap)
  const laid = arrange(items, plan, title, pack, least)
  if (laid === null || title.length === 1) return report(laid)
  const wider = wrapLabel(label, laid.canvas.w - 1)
  if (wider.length >= title.length) return report(laid)
  const again = arrange(items, plan, wider, pack, least)
  return report(again !== null && again.canvas.w <= laid.canvas.w ? again : laid)
}

// ------------------------------------------------------------------ ranking

/**
 * Longest-path ranking over the graph's DAG. Back edges (those closing a cycle) are excluded by a
 * DFS colouring pass, so `A --> B --> C --> A` still ranks 0, 1, 2.
 */
export function computeRanks(n: number, pairs: [number, number][]): number[] {
  const children: number[][] = Array.from({ length: n }, () => [])
  const indeg = new Array<number>(n).fill(0)
  for (const [a, b] of pairs) {
    children[a]!.push(b)
    indeg[b]!++
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

// ------------------------------------------------------------------- levels

type Kind = 'item' | 'line' | 'label' | 'title' | 'border'

/** Something placed on a level: a box or frame, a line passing through, a label, a frame's title. */
interface LNode {
  id: number
  slot: number
  kind: Kind
  item: number
  /** For a label, its edge's index in the source. */
  edge: number
  /** Columns the node takes left and right of its anchor, the column its lines align on. */
  left: number
  right: number
  height: number
  x: number
  /** Neighbours on the levels above and below, each with where its port sits across it, as a fraction. */
  ups: [number, number][]
  downs: [number, number][]
  /** Where a neighbour would put this node's anchor to line up with it: [neighbour, offset]. */
  pullUp: [number, number][]
  pullDown: [number, number][]
  text: string[]
  /** For a node on a frame's border, where an edge meets it. */
  port: Port | null
}

/** A link's line through the levels, from its upper end to its lower end. */
interface Path {
  link: Link
  nodes: number[]
  /** Whether the link's source is its lower end: a back edge, or one leaving a frame by its top. */
  reversed: boolean
  /** Port columns relative to the anchors of the first and last node. */
  upPort: number
  lowPort: number
}

type Loop = { link: Link; row: number; lines: string[] }

const loopOf = (link: Link, pack: Packing): Loop => ({ link, row: 0, lines: link.label === null ? [] : wrapLabel(link.label, labelWrap(link.edge, pack)) })

/**
 * Stack an item's self-loops down its right side: each takes two rows, or as many as its label has
 * lines. Gives the height the item's box needs and the rows the loops and labels take below its top.
 */
function stackLoops(loops: Loop[]): { box: number; below: number } {
  let row = 1
  let below = 0
  for (const loop of loops) {
    loop.row = row
    below = Math.max(below, row + 2, row + 1 + loop.lines.length)
    row += Math.max(2, loop.lines.length)
  }
  return { box: loops.at(-1)!.row + 3, below }
}

/** One link's stretch through a channel: from column `xu` on the level above to `xl` below. */
type Seg = { path: number; xu: number; xl: number; up: string; low: string }
/** Where a stretch turns: on one track, or with a dogleg on two joined by column `xf`. */
type Turn = { t1: number; t2: number; xf: number | null }

/**
 * Lay out one scope: its items, the links between them and, for a frame, the ports on its border.
 * `title` is the frame's title, or `null` at the top level.
 */
function arrange(items: Item[], plan: Plan, title: string[] | null, pack: Packing, least = 0): Laid | null {
  const framed = title !== null
  const ranks = plan.ranks
  const maxRank = Math.max(-1, ...ranks)
  // A rank's level takes the first of its slots; levels of labels under it take the next ones.
  const rankSlot = (r: number) => (framed ? r + 1 : r) * SLOTS
  const bottomSlot = framed ? rankSlot(maxRank + 1) : -1
  const nodes: LNode[] = []
  const add = (slot: number, kind: Kind, item = -1): LNode => {
    const node: LNode = { id: nodes.length, slot, kind, item, edge: -1, left: 0, right: 0, height: 0, x: 0, ups: [], downs: [], pullUp: [], pullDown: [], text: [], port: null }
    nodes.push(node)
    return node
  }
  const index = new Map(items.map((it, i) => [it.key, i]))
  const itemNode = items.map((_, i) => add(rankSlot(ranks[i]!), 'item', i))
  const titleNode = framed ? add(0, 'title') : null

  // Links: self-loops apart, every other link becomes a path from its upper end to its lower end.
  const loops: Loop[][] = items.map(() => [])
  const paths: Path[] = []
  const borderPorts: Port[] = []
  for (const link of plan.links) {
    const ends = [link.from, link.to].map(end => {
      if ('item' in end) return itemNode[index.get(end.item)!]!
      const node = add(end.side === 'top' ? 0 : bottomSlot, 'border')
      node.port = { edge: link.edge.index, side: end.side, x: 0, role: end.role }
      borderPorts.push(node.port)
      return node
    })
    const [a, b] = ends as [LNode, LNode]
    if (a === b) {
      loops[a.item]!.push(loopOf(link, pack))
      continue
    }
    const reversed = b.slot < a.slot
    paths.push({ link, nodes: reversed ? [b.id, a.id] : [a.id, b.id], reversed, upPort: 0, lowPort: 0 })
  }
  for (const { edge, side } of plan.reserve) {
    const node = add(side === 'top' ? 0 : bottomSlot, 'border')
    node.port = { edge, side, x: 0, role: 'own' }
    borderPorts.push(node.port)
  }

  // A labelled path puts its label in the middle gap it crosses, on the level of labels its narrowing
  // names there; each such level exists only where a label needs it.
  const labelSlot = paths.map(p => {
    if (p.link.label === null) return -1
    const top = nodes[p.nodes[0]!]!.slot
    const gaps = (nodes[p.nodes[1]!]!.slot - top) / SLOTS
    return top + SLOTS * Math.floor((gaps - 1) / 2) + 1 + (pack.narrowing.labels.get(p.link.edge.index)?.sub ?? 0)
  })
  const lastSlot = framed ? bottomSlot : rankSlot(maxRank)
  const majors = Array.from({ length: Math.max(0, lastSlot / SLOTS + 1) }, (_, m) => m * SLOTS)
  const slots = [...new Set([...majors, ...labelSlot.filter(s => s >= 0)])].sort((a, b) => a - b)
  paths.forEach((p, k) => {
    const [up, low] = [nodes[p.nodes[0]!]!, nodes[p.nodes[1]!]!]
    const between = slots.filter(s => s > up.slot && s < low.slot).map(s => {
      const node = add(s, s === labelSlot[k] ? 'label' : 'line')
      if (node.kind === 'label') {
        node.text = wrapLabel(p.link.label!, labelWrap(p.link.edge, pack))
        node.edge = p.link.edge.index
      }
      return node.id
    })
    p.nodes = [up.id, ...between, low.id]
  })
  if (nodes.length > MAX_NODES) return null

  // Ports on the items' borders. On a side, the lines leaving share one port and the heads coming in
  // share another, except that two links between the same two ports would share both ends, so the
  // second one gets a port of its own.
  const groupsOf = items.map(() => ({ top: [] as number[][], bottom: [] as number[][] }))
  const ends = items.map(() => ({ top: [] as number[], bottom: [] as number[] }))
  paths.forEach((p, k) => {
    const up = nodes[p.nodes[0]!]!
    const low = nodes[p.nodes.at(-1)!]!
    if (up.kind === 'item') ends[up.item]!.bottom.push(k)
    if (low.kind === 'item') ends[low.item]!.top.push(k)
  })
  const framePort = (i: number, side: Side, k: number) => items[i]!.sub!.ports.find(q => q.edge === paths[k]!.link.edge.index && q.side === side)!
  /**
   * The port a head's line leaves from: its source's shared one. The source may sit inside a frame,
   * so it is named by the edge, not by this scope's item.
   */
  const sourcePort = (k: number): string => `${paths[k]!.link.keys[0]}:${paths[k]!.link.edge.headFrom}`
  items.forEach((it, i) => {
    if (it.sub !== null) return
    for (const side of ['top', 'bottom'] as const) {
      const shared = new Map<string, number[]>()
      const own: number[][] = []
      const seen = new Set<string>()
      for (const k of ends[i]![side]) {
        // On the top, heads come in on paths that are not reversed; on the bottom, on reversed ones.
        const coming = (side === 'top') !== paths[k]!.reversed
        const far = sourcePort(k)
        if (coming && seen.has(far)) own.push([k])
        else {
          if (coming) seen.add(far)
          // A shared port shows one glyph, so only ends with the same head share it.
          const { headTo, headFrom } = paths[k]!.link.edge
          const key = coming ? `in:${headTo}` : `out:${headFrom}`
          const group = shared.get(key)
          if (group) group.push(k)
          else shared.set(key, [k])
        }
      }
      groupsOf[i]![side] = [...shared.values(), ...own]
    }
  })

  // Sizes, with room for the ports and for self-loops, which go on an item's right side, one under
  // the other, each label beside its loop.
  const sizes = items.map((it, i) => {
    if (it.sub !== null) return { w: it.sub.canvas.w + 4, h: it.sub.canvas.h + 2, lines: [] as string[] }
    const lines = wrapLabel(it.label, pack.wrap)
    const ports = Math.max(groupsOf[i]!.top.length, groupsOf[i]!.bottom.length)
    return { w: Math.max(widest(lines) + 2 * PAD + 2, ports + 2), h: lines.length + 2, lines }
  })
  const loopRight = items.map(() => 0)
  items.forEach((it, i) => {
    if (loops[i]!.length === 0) return
    const { box, below } = stackLoops(loops[i]!)
    // A frame was laid out tall enough for its loops; growing it here would part its contents from
    // its bottom border.
    if (it.sub === null) sizes[i]!.h = Math.max(sizes[i]!.h, box)
    loopRight[i] = 2 + (loops[i]!.some(l => l.lines.length > 0) ? 1 + Math.max(...loops[i]!.map(l => widest(l.lines))) : 0)
    itemNode[i]!.height = below
  })
  for (const node of nodes) {
    if (node.kind === 'item') {
      const { w, h } = sizes[node.item]!
      node.left = half(w)
      node.right = w - 1 - half(w) + loopRight[node.item]!
      node.height = Math.max(node.height, h)
    } else if (node.kind === 'label') {
      node.right = 1 + widest(node.text)
      node.height = node.text.length
    } else if (node.kind === 'title') {
      node.text = title!
      node.right = widest(title!)
      node.height = title!.length - 1
    }
  }

  // A frame's ports are fixed by its contents; ordering reads each as a fraction of the frame's place.
  const frameOffset = (node: LNode, side: Side, k: number) => 2 + framePort(node.item, side, k).x - half(sizes[node.item]!.w)
  const offsetFor = (node: LNode, side: Side, k: number) => (node.kind === 'item' && items[node.item]!.sub !== null ? frameOffset(node, side, k) : 0)
  const span = (v: LNode) => v.left + v.right + 1
  paths.forEach((p, k) => {
    for (let j = 0; j + 1 < p.nodes.length; j++) {
      const a = nodes[p.nodes[j]!]!
      const b = nodes[p.nodes[j + 1]!]!
      a.downs.push([b.id, offsetFor(b, 'top', k) / span(b)])
      b.ups.push([a.id, offsetFor(a, 'bottom', k) / span(a)])
    }
  })

  // Order each level to cut crossings.
  const bySlot = new Map<number, LNode[]>(slots.map(s => [s, []]))
  for (const node of nodes) bySlot.get(node.slot)?.push(node)
  const levels = slots.map(s => bySlot.get(s)!)
  orderLevels(levels, nodes, titleNode)

  // A box's ports take columns side by side around its centre, in the order of where their lines go.
  const order = new Map<number, number>()
  for (const level of levels) level.forEach((v, i) => order.set(v.id, i))
  const offsets = new Map<string, number>()
  items.forEach((it, i) => {
    if (it.sub !== null) return
    for (const side of ['top', 'bottom'] as const) {
      const next = (k: number) => order.get(side === 'top' ? paths[k]!.nodes.at(-2)! : paths[k]!.nodes[1]!)!
      const groups = groupsOf[i]![side].map(g => ({ g, at: g.reduce((s, k) => s + next(k), 0) / g.length })).sort((a, b) => a.at - b.at)
      const first = -Math.ceil((groups.length - 1) / 2)
      groups.forEach(({ g }, j) => {
        for (const k of g) offsets.set(`${k}:${side}`, first + j)
      })
    }
  })
  const portOffset = (node: LNode, side: Side, k: number): number =>
    node.kind !== 'item' ? 0 : items[node.item]!.sub !== null ? frameOffset(node, side, k) : offsets.get(`${k}:${side}`)!
  paths.forEach((p, k) => {
    p.upPort = portOffset(nodes[p.nodes[0]!]!, 'bottom', k)
    p.lowPort = portOffset(nodes[p.nodes.at(-1)!]!, 'top', k)
    for (let j = 0; j + 1 < p.nodes.length; j++) {
      const a = nodes[p.nodes[j]!]!
      const b = nodes[p.nodes[j + 1]!]!
      const pa = j === 0 ? p.upPort : 0
      const pb = j + 2 === p.nodes.length ? p.lowPort : 0
      a.pullDown.push([b.id, pb - pa])
      b.pullUp.push([a.id, pa - pb])
    }
  })
  placeLevels(levels, nodes, pack.gap, titleNode)

  // Heights, then channels: each pair of neighbouring levels with the stretches of line between them.
  const levelH = levels.map(level => Math.max(0, ...level.map(n => n.height)))
  const colOf = (p: Path, j: number) => nodes[p.nodes[j]!]!.x + (j === 0 ? p.upPort : j === p.nodes.length - 1 ? p.lowPort : 0)
  const isLabels = (s: number) => s % SLOTS !== 0
  const isRank = (s: number) => !isLabels(s) && !(framed && (s === 0 || s === bottomSlot))
  /** Whether path `k` passes through the border of the frame `node` on `side`, on to a box inside. */
  const crosses = (node: LNode, side: Side, k: number) => node.kind === 'item' && items[node.item]!.sub !== null && framePort(node.item, side, k).role === 'cross'
  const segsAt: Seg[][] = levels.map(() => [])
  const headUp = levels.map(() => false)
  const headDown = levels.map(() => false)
  paths.forEach((p, k) => {
    const upNode = nodes[p.nodes[0]!]!
    const lowNode = nodes[p.nodes.at(-1)!]!
    for (let j = 0; j + 1 < p.nodes.length; j++) {
      const level = slots.indexOf(nodes[p.nodes[j]!]!.slot)
      const xu = colOf(p, j)
      const xl = colOf(p, j + 1)
      segsAt[level]!.push({ path: k, xu, xl, up: `${p.nodes[j]}:${xu}`, low: `${p.nodes[j + 1]}:${xl}` })
      if (j === 0 && upNode.kind === 'item' && p.reversed && !crosses(upNode, 'bottom', k)) headUp[level] = true
      const last = j + 2 === p.nodes.length
      if (last && ((lowNode.kind === 'item' && !p.reversed && !crosses(lowNode, 'top', k)) || roleOf(lowNode) === 'end')) headDown[level] = true
    }
  })
  const turns = new Map<string, Turn>()
  const chanRows: number[] = []
  const chanTop: number[] = []
  levels.forEach((_, li) => {
    if (li + 1 === levels.length) return
    const { turn, count } = channel(segsAt[li]!)
    for (const [seg, t] of turn) turns.set(`${seg.path}:${li}`, t)
    const top = headUp[li] ? 1 : 0
    const min = isRank(slots[li]!) && isRank(slots[li + 1]!) ? 2 : isLabels(slots[li]!) ? 1 : 0
    chanTop.push(top)
    chanRows.push(Math.max(min, top + count + (headDown[li] ? 1 : 0)))
  })
  // Rows a frame's own self-loops need come in before its bottom level, which stays on its border.
  const short = least - levelH.reduce((s, h) => s + h, 0) - chanRows.reduce((s, r) => s + r, 0)
  if (short > 0 && chanRows.length > 0) chanRows[chanRows.length - 1]! += short
  const levelY: number[] = []
  let y = 0
  levels.forEach((_, li) => {
    levelY.push(y)
    y += levelH[li]! + (chanRows[li] ?? 0)
  })
  const height = Math.max(1, y)
  const trackRow = (li: number, t: number) => levelY[li]! + levelH[li]! + chanTop[li]! + t

  let width = 1
  for (const node of nodes) width = Math.max(width, node.x + node.right + 1)
  for (const t of turns.values()) if (t.xf !== null) width = Math.max(width, t.xf + 1)
  if (width * height > MAX_CANVAS_CELLS) return null
  const canvas = new Canvas(width, height)

  // Items: boxes, and frames with their contents.
  const boxAt = (i: number) => {
    const node = itemNode[i]!
    const { w, h } = sizes[i]!
    return { x: node.x - half(w), y: levelY[slots.indexOf(node.slot)]!, w, h }
  }
  items.forEach((it, i) => {
    const p = boxAt(i)
    if (it.sub === null) drawBox(canvas, p, it, sizes[i]!.lines)
    else drawFrame(canvas, p, it, it.sub)
  })
  if (titleNode !== null) {
    const titleRuns = title!.slice(1).map((text, li) => ({ x: titleNode.x, y: li, text }))
    for (const run of titleRuns) drawText(canvas, run.text, run.x, run.y, 'text')
  }

  // Labels, then lines.
  const styleOf = (edge: Edge) => (edge.line === 'dotted' ? STY_DOT : edge.line === 'thick' ? STY_THICK : STY_SOLID)
  paths.forEach((p, k) => {
    const { edge, keys } = p.link
    canvas.curStyle = styleOf(edge)
    canvas.beginEdge(edge.index, keys[0], keys[1])
    for (const node of p.nodes.map(id => nodes[id]!)) {
      if (node.kind !== 'label') continue
      node.text.forEach((text, li) => {
        const run = { x: node.x + 2, y: levelY[slots.indexOf(node.slot)]! + li, text }
        drawText(canvas, text, run.x, run.y, 'edgeLabel')
        canvas.labelRun(run)
      })
    }
    drawPath(canvas, p, k)
    canvas.endEdge()
  })

  function drawPath(canvas: Canvas, p: Path, k: number): void {
    const { edge } = p.link
    const upNode = nodes[p.nodes[0]!]!
    const lowNode = nodes[p.nodes.at(-1)!]!
    const x0 = colOf(p, 0)
    const xn = colOf(p, p.nodes.length - 1)
    const upBox = upNode.kind === 'item' ? boxAt(upNode.item) : null
    const lowBox = lowNode.kind === 'item' ? boxAt(lowNode.item) : null
    const upCross = crosses(upNode, 'bottom', k)
    const lowCross = crosses(lowNode, 'top', k)

    // The upper end: the source leaving by a bottom border, a head under its target, or a frame's top.
    const y0 = upBox === null ? 0 : p.reversed && !upCross ? upBox.y + upBox.h : upBox.y + upBox.h - 1
    const yn = lowBox === null ? height - 1 : !p.reversed && !lowCross ? lowBox.y - 1 : lowBox.y
    const points: [number, number][] = [[x0, y0]]
    for (let j = 0; j + 1 < p.nodes.length; j++) {
      const li = slots.indexOf(nodes[p.nodes[j]!]!.slot)
      const t = turns.get(`${k}:${li}`)
      if (!t) continue
      const [xu, xl] = [colOf(p, j), colOf(p, j + 1)]
      if (t.xf === null) points.push([xu, trackRow(li, t.t1)], [xl, trackRow(li, t.t1)])
      else points.push([xu, trackRow(li, t.t1)], [t.xf, trackRow(li, t.t1)], [t.xf, trackRow(li, t.t2)], [xl, trackRow(li, t.t2)])
    }
    points.push([xn, yn])
    for (let j = 0; j + 1 < points.length; j++) {
      const [[ax, ay], [bx, by]] = [points[j]!, points[j + 1]!]
      if (ax === bx) canvas.segV(ax, ay, by)
      else canvas.segH(ay, ax, bx)
    }
    // A line that comes through the frame's border joins the border's crossing.
    if (upNode.kind === 'border') canvas.addBits(x0, y0, U)
    if (lowNode.kind === 'border' && roleOf(lowNode) !== 'end') canvas.addBits(xn, yn, D)

    if (upBox !== null) {
      if (upCross) canvas.junction(x0, y0, U | D)
      else if (p.reversed) end(canvas, x0, y0, U, edge.headTo, '▲')
      else leave(canvas, x0, y0, D, edge.headFrom, '▲')
    }
    if (lowBox !== null) {
      if (lowCross) canvas.junction(xn, yn, U | D)
      else if (p.reversed) leave(canvas, xn, yn, U, edge.headFrom, '▼')
      else end(canvas, xn, yn, D, edge.headTo, '▼')
    } else if (roleOf(lowNode) === 'end') end(canvas, xn, yn, D, edge.headTo, '▼')
  }

  // Self-loops on the right side of their box or frame.
  items.forEach((_, i) => {
    const { x, y, w } = boxAt(i)
    for (const loop of loops[i]!) {
      const { edge, keys } = loop.link
      canvas.curStyle = styleOf(edge)
      canvas.beginEdge(edge.index, keys[0], keys[1])
      const row = y + loop.row
      const [h, down, up] = edge.line === 'dotted' ? ['╌', '┐', '┘'] : edge.line === 'thick' ? ['━', '┓', '┛'] : ['─', '┐', '┘']
      canvas.junction(x + w - 1, row, R)
      canvas.start(x + w - 1, row)
      if (edge.headFrom !== 'none') canvas.set(x + w - 1, row, headGlyph(edge.headFrom, '◄'), 'edge')
      canvas.stroke(x + w, row, h!)
      canvas.stroke(x + w + 1, row, down!)
      canvas.stroke(x + w + 1, row + 1, up!)
      if (edge.headTo === 'none') canvas.stroke(x + w, row + 1, h!)
      else canvas.stroke(x + w, row + 1, headGlyph(edge.headTo, '◄'))
      canvas.tip(x + w, row + 1)
      loop.lines.forEach((text, li) => {
        const run = { x: x + w + 3, y: row + 1 + li, text }
        drawText(canvas, text, run.x, run.y, 'edgeLabel')
        canvas.labelRun(run)
      })
      canvas.endEdge()
    }
  })

  // Edges that leave a frame's own border for something inside it start on that border, which the
  // frame's parent draws.
  items.forEach((it, i) => {
    if (it.sub === null) return
    const { x, y } = boxAt(i)
    for (const port of it.sub.ports) {
      if (port.role !== 'start') continue
      const link = plan.links.find(l => l.edge.index === port.edge)
      const edge = link?.edge
      const keys = link?.keys ?? [it.key, it.key]
      canvas.beginEdge(port.edge, keys[0], keys[1])
      canvas.junction(x + 2 + port.x, y, D)
      canvas.start(x + 2 + port.x, y)
      if (edge && edge.headFrom !== 'none') canvas.set(x + 2 + port.x, y, headGlyph(edge.headFrom, '▲'), 'edge')
      canvas.endEdge()
    }
  })

  canvas.finalizeMask()
  for (const node of nodes) if (node.port) node.port.x = node.x
  const report = levels.map((level, li): Level => {
    const s = slots[li]!
    let at = 0
    const placed = level.map((v, i) => {
      at = i === 0 ? v.left : at + apartBy(level[i - 1]!, v, pack.gap)
      return { item: v.kind === 'item' ? items[v.item]!.key : null, edge: v.kind === 'label' ? v.edge : null, start: at - v.left, end: at + v.right + 1 }
    })
    const kind = isLabels(s) ? 'label' : isRank(s) ? 'rank' : 'border'
    return { kind, rank: Math.floor(s / SLOTS) - (framed ? 1 : 0), sub: isLabels(s) ? (s % SLOTS) - 1 : 0, nodes: placed }
  })
  return { canvas, ports: borderPorts, title: title ?? [], levels: report }
}

const roleOf = (node: LNode): Role | undefined => node.port?.role

function headGlyph(head: Head, arrow: string): string {
  return head === 'circle' ? 'o' : head === 'cross' ? '×' : arrow
}

/** Where a line leaves its source's border, with the source's own head if it has one. */
function leave(canvas: Canvas, x: number, y: number, bits: number, head: Head, arrow: string): void {
  canvas.junction(x, y, bits)
  canvas.start(x, y)
  if (head !== 'none') canvas.set(x, y, headGlyph(head, arrow), 'edge')
}

/** Where a line ends beside its target: its head, or a bare line end. */
function end(canvas: Canvas, x: number, y: number, bits: number, head: Head, arrow: string): void {
  if (head === 'none') {
    canvas.addBits(x, y, bits)
    canvas.tip(x, y)
  } else canvas.head(x, y, headGlyph(head, arrow))
}

// ----------------------------------------------------------------- ordering

/**
 * Reorder each level to cut crossings (barycenter sweeps): alternate down and up passes sort each
 * level by the mean position of its neighbours, keeping the ordering that crossed least. A frame's
 * title stays first on its level.
 */
function orderLevels(levels: LNode[][], nodes: LNode[], pinned: LNode | null): void {
  const pos = new Array<number>(nodes.length).fill(0)
  const reindex = (level: LNode[]) => level.forEach((v, i) => (pos[v.id] = i))
  levels.forEach(reindex)
  const crossings = () => {
    let count = 0
    for (const level of levels) {
      const segs = level.flatMap(v => v.downs.map(([d, f]) => [pos[v.id]!, pos[d]! + f] as const))
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const [a, b] = [segs[i]!, segs[j]!]
          if ((a[0] < b[0] && a[1] > b[1]) || (a[0] > b[0] && a[1] < b[1])) count++
        }
      }
    }
    return count
  }
  let best = levels.map(l => [...l])
  let bestCount = crossings()
  for (let it = 0; it < 8 && bestCount > 0; it++) {
    const sweep = it % 2 === 0 ? levels.slice(1) : levels.slice(0, -1).reverse()
    for (const level of sweep) {
      const keyed = level.map(v => {
        const neigh = it % 2 === 0 ? v.ups : v.downs
        return { v, key: v === pinned ? -1 : neigh.length === 0 ? pos[v.id]! : neigh.reduce((s, [u, f]) => s + pos[u]! + f, 0) / neigh.length }
      })
      keyed.sort((a, b) => a.key - b.key)
      level.splice(0, level.length, ...keyed.map(k => k.v))
      reindex(level)
    }
    const count = crossings()
    if (count < bestCount) {
      bestCount = count
      best = levels.map(l => [...l])
    }
  }
  levels.forEach((level, i) => level.splice(0, level.length, ...best[i]!))
}

/** Columns between the anchors of two neighbours: boxes keep the fit's gap, lines and labels one column. */
const apartBy = (a: LNode, b: LNode, sep: number) => a.right + 1 + (a.kind === 'item' || b.kind === 'item' || a.kind === 'title' ? sep : 1) + b.left

/**
 * Give every node an anchor column so its lines run as straight as they can: level by level, each
 * node goes where its neighbours' ports are, as near as keeping its level's order and `sep` columns
 * between nodes allows. A level is placed by least squares on the columns it is pulled to (isotonic
 * regression: neighbours that would collide move as one block, to the mean of their pulls).
 */
function placeLevels(levels: LNode[][], nodes: LNode[], sep: number, pinned: LNode | null): void {
  const apart = (a: LNode, b: LNode) => apartBy(a, b, sep)
  for (const level of levels) {
    let x = 0
    level.forEach((v, i) => {
      x = i === 0 ? v.left : x + apart(level[i - 1]!, v)
      v.x = x
    })
  }
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length
  const place = (level: LNode[], pulls: (v: LNode) => [number, number][]) => {
    type Block = { targets: number[]; value: number; size: number }
    const blocks: Block[] = []
    let offset = 0
    level.forEach((v, i) => {
      if (i > 0) offset += apart(level[i - 1]!, v)
      const own = pulls(v).map(([u, d]) => nodes[u]!.x + d - offset)
      let block: Block = { targets: own.length > 0 ? own : [v.x - offset], value: 0, size: 1 }
      block.value = mean(block.targets)
      while (blocks.length > 0 && blocks.at(-1)!.value >= block.value) {
        const prev = blocks.pop()!
        const targets = [...prev.targets, ...block.targets]
        block = { targets, value: mean(targets), size: prev.size + block.size }
      }
      blocks.push(block)
    })
    let i = 0
    offset = 0
    for (const block of blocks) {
      for (let k = 0; k < block.size; k++, i++) {
        if (i > 0) offset += apart(level[i - 1]!, level[i]!)
        level[i]!.x = block.value + offset
      }
    }
  }
  for (const level of levels) place(level, v => v.pullUp)
  for (let it = 0; it < 8; it++) {
    for (const level of it % 2 === 0 ? [...levels].reverse() : levels) place(level, v => [...v.pullUp, ...v.pullDown])
  }
  for (const level of levels) {
    level.forEach((v, i) => {
      v.x = Math.round(v.x)
      if (i > 0) v.x = Math.max(v.x, level[i - 1]!.x + apart(level[i - 1]!, v))
    })
  }
  // Rounding and averaging leave lines a column or two off; move each node, within the room its level
  // leaves it, to where the most of its lines run straight.
  for (let it = 0; it < 4; it++) {
    for (const level of it % 2 === 0 ? levels : [...levels].reverse()) {
      level.forEach((v, i) => {
        const pulls = [...v.pullUp, ...v.pullDown].map(([u, d]) => nodes[u]!.x + d)
        const lo = i === 0 ? Number.NEGATIVE_INFINITY : level[i - 1]!.x + apart(level[i - 1]!, v)
        const hi = i === level.length - 1 ? Number.POSITIVE_INFINITY : level[i + 1]!.x - apart(v, level[i + 1]!)
        const cost = (x: number) => pulls.reduce((s, t) => s + Math.abs(x - t) + (x === t ? 0 : 0.5), 0)
        for (const t of pulls) {
          const x = Math.min(hi, Math.max(lo, t))
          if (cost(x) < cost(v.x)) v.x = x
        }
      })
    }
  }
  const shift = nodes.length === 0 ? 0 : -Math.min(...nodes.map(v => v.x - v.left))
  for (const v of nodes) v.x += shift
  if (pinned !== null) {
    const level = levels.find(l => l.includes(pinned))!
    pinned.x = pinned.left
    level.forEach((v, i) => {
      if (i > 0) v.x = Math.max(v.x, level[i - 1]!.x + apart(level[i - 1]!, v))
    })
  }
}

// ----------------------------------------------------------------- channels

/**
 * Give each stretch that turns a track in its channel. A stretch leaving column x must turn above
 * any other stretch arriving at x, or their lines would run over each other; when two stretches each
 * need to be above the other, one of them turns twice, on a free column between two tracks.
 * Stretches share a track when they are two columns apart or start or end at the same port.
 */
function channel(segs: Seg[]): { turn: Map<Seg, Turn>; count: number } {
  type Unit = { seg: Seg; part: 0 | 1 | 2; a: number; b: number; from: number; to: number; up: string; low: string; track: number }
  const turn = new Map<Seg, Turn>()
  const jogs = segs.filter(s => s.xu !== s.xl)
  const taken = new Set(segs.flatMap(s => [s.xu, s.xl]))
  const units: Unit[] = jogs.map(seg => ({ seg, part: 0, a: Math.min(seg.xu, seg.xl), b: Math.max(seg.xu, seg.xl), from: seg.xu, to: seg.xl, up: seg.up, low: seg.low, track: -1 }))
  const above = (a: Unit, b: Unit) => a !== b && (a.seg === b.seg ? a.part === 1 && b.part === 2 : a.from === b.to)
  const done = new Set<Unit>()
  const freeColumn = (u: Unit): number => {
    const mid = Math.round((u.from + u.to) / 2)
    for (let d = 0; ; d++) {
      for (const x of [mid + d, mid - d]) if (x >= 0 && !taken.has(x)) return x
    }
  }
  while (done.size < units.length) {
    const left = units.filter(u => !done.has(u))
    const ready = left.filter(u => !left.some(v => above(v, u))).sort((p, q) => p.a - q.a || p.b - q.b)
    if (ready.length === 0) {
      // Every stretch left waits on another: turn one of them twice, on a column nobody uses.
      const u = left.find(v => v.part === 0)!
      const xf = freeColumn(u)
      taken.add(xf)
      const second: Unit = { ...u, part: 2, a: Math.min(xf, u.seg.xl), b: Math.max(xf, u.seg.xl), from: xf, to: u.seg.xl, up: `dogleg:${xf}`, track: -1 }
      Object.assign(u, { part: 1, a: Math.min(u.seg.xu, xf), b: Math.max(u.seg.xu, xf), to: xf, low: `dogleg:${xf}` })
      units.push(second)
      continue
    }
    for (const u of ready) {
      let lowest = 0
      for (const v of done) if (above(v, u)) lowest = Math.max(lowest, v.track + 1)
      const clash = (v: Unit) => v.track === u.track && !(v.b + 2 <= u.a || u.b + 2 <= v.a) && v.up !== u.up && v.low !== u.low
      u.track = lowest
      while ([...done].some(clash)) u.track++
      done.add(u)
    }
  }
  let count = 0
  for (const u of units) count = Math.max(count, u.track + 1)
  for (const u of units) {
    if (u.part === 2) continue
    if (u.part === 0) turn.set(u.seg, { t1: u.track, t2: u.track, xf: null })
    else {
      const second = units.find(v => v.seg === u.seg && v.part === 2)!
      turn.set(u.seg, { t1: u.track, t2: second.track, xf: u.to })
    }
  }
  return { turn, count }
}

// ------------------------------------------------------------------- drawing

type Box = { x: number; y: number; w: number; h: number }

function drawBox(canvas: Canvas, p: Box, item: Item, lines: string[]): void {
  outline(canvas, p, item.shape)
  const inner = Math.max(1, p.w - 2 * PAD - 2)
  const runs = lines.map((text, li) => ({ x: p.x + 1 + PAD + half(Math.max(0, inner - stringWidth(text))), y: p.y + 1 + li, text }))
  for (const run of runs) drawText(canvas, run.text, run.x, run.y, 'text')
  canvas.boxes.push({ key: item.key, x: p.x, y: p.y, w: p.w, h: p.h, lines: runs })
}

function outline(canvas: Canvas, p: Box, shape: Shape): void {
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

/**
 * A frame: its contents one column in from its sides, and its title's first line on its top border;
 * the rest of the title is part of the contents.
 */
function drawFrame(canvas: Canvas, p: Box, item: Item, sub: Laid): void {
  outline(canvas, p, 'rect')
  canvas.blit(sub.canvas, p.x + 2, p.y + 1)
  const title = sub.title
  drawTextOverEdges(canvas, ` ${title[0]!} `, p.x + 1, p.y, 'text')
  const runs = title.map((text, i) => ({ x: p.x + 2, y: p.y + i, text }))
  canvas.frames.push({ key: item.key, x: p.x, y: p.y, w: p.w, h: p.h, title: runs })
}
