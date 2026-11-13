// Routes the back edges of a flowchart or state diagram: the edges that point against the flow,
// each a return to an earlier node, and the edges from a node to itself.
//
// beautiful-mermaid routes every edge alone, around nodes only. A back edge then took the corridor
// of the forward edge it answers, several back edges ran along one lane, and their labels landed on
// one spot. Here they are routed last, one at a time, shortest span first, by these rules:
//
//   - A link between two cells holds one edge. The exception is the straight run into a port, which
//     the back edges that end on that port share, and the straight run out of one, likewise.
//   - An edge crosses another only straight through a straight stretch of it, and never in the
//     cell beside a port, where the arrowhead is drawn.
//   - A leg into or out of a port is two links long at least, so an arrowhead has a cell of its own,
//     and no edge turns in a cell beside a port of its own nodes.
//   - An edge from a node to itself turns one corner of the node; it does not go around it.
//   - A label sits on a straight stretch of its edge that no other edge touches.
//
// Routes may leave the grid on any side; the grid is moved afterwards so that it starts at 0 again.
// An edge with no such route throws, and cc-dazzle shows the diagram's source instead. So does any
// back edge in a diagram with subgraphs: their boxes are drawn after the layout, around the nodes
// only, so a route cannot keep clear of them.

import { setRole } from './node_modules/beautiful-mermaid/src/ascii/canvas.ts'
import { getNodeSubgraph, gridToDrawingCoord } from './node_modules/beautiful-mermaid/src/ascii/grid.ts'
import type { AsciiEdge, AsciiGraph, AsciiNode, Direction, GridCoord } from './node_modules/beautiful-mermaid/src/ascii/types.ts'
import { Down, Left, Right, Up } from './node_modules/beautiful-mermaid/src/ascii/types.ts'

// A side of a cell, and a move through it: up, right, down, left.
const STEPS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const
const PORTS: Direction[] = [Up, Right, Down, Left]
const [UP, RIGHT, DOWN, LEFT] = [0, 1, 2, 3]
// What a cell holds: the sides edges leave it by, then whether it is beside a port or in a node.
const ALL_SIDES = 15
const BESIDE_PORT = 16
const NODE = 32
const TURN = 2
const CROSSING = 2
const NEAR_SIDE = 4
const MAX_STEPS = 200000
// Two cells keep upright lanes in neighboring columns one cell apart.
const LANE_WIDTH = 2

const reverse = (side: number) => (side + 2) % 4
const step = (c: GridCoord, side: number): GridCoord => ({ x: c.x + STEPS[side]!.x, y: c.y + STEPS[side]!.y })
const same = (a: GridCoord, b: GridCoord) => a.x === b.x && a.y === b.y
const sideOf = (from: GridCoord, to: GridCoord) => STEPS.findIndex(s => s.x === to.x - from.x && s.y === to.y - from.y)
const port = (node: AsciiNode, side: number) => step({ x: node.gridCoord!.x + 1, y: node.gridCoord!.y + 1 }, side)

const flow = (graph: AsciiGraph, edge: AsciiEdge): 'LR' | 'TD' => {
  const inside = getNodeSubgraph(graph, edge.from)
  return inside?.direction && inside === getNodeSubgraph(graph, edge.to) ? inside.direction : graph.config.graphDirection
}

export function isBackEdge(graph: AsciiGraph, edge: AsciiEdge): boolean {
  const from = edge.from.gridCoord
  const to = edge.to.gridCoord
  if (!from || !to) return false
  return edge.from === edge.to || (flow(graph, edge) === 'LR' ? to.x < from.x : to.y < from.y)
}

// Every cell of a path given by its corners. A slanted pair goes sideways first, as drawLine does.
const cellsOf = (path: GridCoord[]): GridCoord[] => {
  const cells = path.slice(0, 1)
  for (const to of path.slice(1)) {
    let at = cells[cells.length - 1]!
    while (at.x !== to.x) cells.push((at = { x: at.x + Math.sign(to.x - at.x), y: at.y }))
    while (at.y !== to.y) cells.push((at = { x: at.x, y: at.y + Math.sign(to.y - at.y) }))
  }
  return cells
}

const cornersOf = (cells: GridCoord[]): GridCoord[] =>
  cells.filter((c, i) => i === 0 || i === cells.length - 1 || sideOf(cells[i - 1]!, c) !== sideOf(c, cells[i + 1]!))

// The part of the grid that routes may use, and what is in it: what each cell holds, and for each
// link how many edges run on it and which edges may share it. A route stays within reach: two cells
// around what is in use, which is as far out as a new lane has to go.
type Reach = { left: number; top: number; right: number; bottom: number }
type Board = { x: number; y: number; width: number; height: number; cells: Uint8Array; links: Map<number, { edges: number; shared: string }>; reach: Reach }

const REACH = 2
const index = (board: Board, c: GridCoord) => (c.x - board.x) * board.height + (c.y - board.y)
const inReach = ({ reach }: Board, c: GridCoord) => c.x >= reach.left && c.x <= reach.right && c.y >= reach.top && c.y <= reach.bottom
const reachOf = (cells: GridCoord[], reach?: Reach): Reach => ({
  left: Math.min(reach?.left ?? Infinity, ...cells.map(c => c.x - REACH)),
  top: Math.min(reach?.top ?? Infinity, ...cells.map(c => c.y - REACH)),
  right: Math.max(reach?.right ?? -Infinity, ...cells.map(c => c.x + REACH)),
  bottom: Math.max(reach?.bottom ?? -Infinity, ...cells.map(c => c.y + REACH)),
})
// A link is numbered by its upper or left cell.
const link = (board: Board, c: GridCoord, side: number): number =>
  side === RIGHT || side === DOWN ? index(board, c) * 2 + side - 1 : link(board, step(c, side), reverse(side))

// Edges share a run out of a port, or into one, when they would draw it the same.
const runOut = (edge: AsciiEdge, start: GridCoord) => `out:${start.x},${start.y}:${edge.style}:${edge.hasArrowStart}`
const runIn = (edge: AsciiEdge, end: GridCoord) => `in:${end.x},${end.y}:${edge.style}:${edge.hasArrowEnd}`

const hold = (board: Board, cells: GridCoord[], back?: AsciiEdge): void => {
  const mark = (c: GridCoord, bits: number) => (board.cells[index(board, c)] = board.cells[index(board, c)]! | bits)
  const turns = cells.map((c, i) => i > 0 && i < cells.length - 1 && sideOf(cells[i - 1]!, c) !== sideOf(c, cells[i + 1]!))
  const firstTurn = turns.indexOf(true)
  const lastTurn = turns.lastIndexOf(true)
  for (let i = 0; i + 1 < cells.length; i++) {
    const side = sideOf(cells[i]!, cells[i + 1]!)
    if (side < 0) continue
    mark(cells[i]!, 1 << side)
    mark(cells[i + 1]!, 1 << reverse(side))
    if (i === 0) mark(cells[1]!, BESIDE_PORT)
    if (i === cells.length - 2) mark(cells[i]!, BESIDE_PORT)
    const shared = !back ? '' : i >= lastTurn ? runIn(back, cells[cells.length - 1]!) : i < firstTurn ? runOut(back, cells[0]!) : ''
    const name = link(board, cells[i]!, side)
    const held = board.links.get(name)
    board.links.set(name, { edges: (held?.edges ?? 0) + 1, shared: held?.shared ?? shared })
  }
}

// The side a back edge leaves and enters by last: up in a flow to the right, left in a flow down.
const nearSide = (graph: AsciiGraph, edge: AsciiEdge) => (flow(graph, edge) === 'LR' ? UP : LEFT)

type Route = { cost: number; cells: GridCoord[] }

// The cheapest route for an edge that leaves its node by one of the sides in starts and enters the
// other by one of the sides in ends, by A* over each cell and the move that entered it.
const search = (graph: AsciiGraph, board: Board, edge: AsciiEdge, starts: number[], ends: number[], budget: { steps: number }): Route | null => {
  const open = (c: GridCoord) => inReach(board, c) && !(board.cells[index(board, c)]! & NODE)
  const shared = (c: GridCoord, side: number) => board.links.get(link(board, c, side))?.shared
  const near = nearSide(graph, edge)
  const goals = ends
    .map(side => ({ side, end: port(edge.to, side), last: step(port(edge.to, side), side) }))
    .filter(goal => open(goal.last) && [undefined, runIn(edge, goal.end)].includes(shared(goal.end, goal.side)))
  if (goals.length === 0) return null
  const runsIn = goals.map(goal => runIn(edge, goal.end))
  const beside = new Set([edge.from, edge.to].flatMap(node => PORTS.map((_, side) => index(board, step(port(node, side), side)))))

  // Whether the edge may leave cell c by a link another edge holds: along a run out of its own
  // port, from the port on, and onto a run into one of its ports, which it then follows to the end.
  const usable = (c: GridCoord, entered: number, leaving: number): boolean => {
    const behind = shared(c, reverse(entered))
    const ahead = shared(c, leaving)
    if (behind?.startsWith('in:') && (leaving !== entered || ahead !== behind)) return false
    if (ahead === undefined) return true
    return ahead.startsWith('out:') ? leaving === entered && behind === ahead : runsIn.includes(ahead)
  }
  // What it costs to enter cell c by one move and leave it by another, or -1 when it may not: free
  // through a free cell and along a shared run, a crossing through a straight stretch.
  const pass = (c: GridCoord, entered: number, leaving: number): number => {
    if (!usable(c, entered, leaving)) return -1
    const held = board.cells[index(board, c)]!
    const turn = entered === leaving ? 0 : TURN
    if (held === 0 || held & ((1 << reverse(entered)) | (1 << leaving))) return turn
    return turn === 0 && held === ((1 << ((entered + 1) % 4)) | (1 << ((entered + 3) % 4))) ? CROSSING : -1
  }

  const cell = (state: number): GridCoord => ({ x: board.x + Math.floor(state / 4 / board.height), y: board.y + (Math.floor(state / 4) % board.height) })
  const ahead = (c: GridCoord) => Math.min(...goals.map(goal => Math.abs(c.x - goal.last.x) + Math.abs(c.y - goal.last.y)))
  const costs = new Int32Array(board.cells.length * 4).fill(-1)
  const came = new Int32Array(costs.length).fill(-1)
  const queue: number[][] = []
  const push = (c: GridCoord, side: number, cost: number, previous: number) => {
    const state = index(board, c) * 4 + side
    if (costs[state] !== -1 && costs[state]! <= cost) return
    costs[state] = cost
    came[state] = previous
    ;(queue[cost + ahead(c)] ??= []).push(state, cost)
  }
  for (const side of starts) {
    const start = port(edge.from, side)
    if (open(step(start, side)) && [undefined, runOut(edge, start)].includes(shared(start, side))) push(step(start, side), side, 1 + (side === near ? NEAR_SIDE : 0), -1)
  }

  let done: { cost: number; state: number; end: GridCoord } | undefined
  for (let total = 0; total < queue.length && total < (done?.cost ?? Infinity); total++) {
    const bucket = queue[total]
    for (let i = 0; bucket && i < bucket.length; i += 2) {
      const state = bucket[i]!
      const cost = bucket[i + 1]!
      if (costs[state] !== cost) continue
      if (++budget.steps > MAX_STEPS) throw new Error('mermaid edge routing gave up')
      const c = cell(state)
      const entered = state % 4
      for (const goal of goals) {
        if (!same(c, goal.last) || entered !== reverse(goal.side)) continue
        const final = pass(c, entered, entered)
        const whole = cost + 1 + final + (goal.side === near ? NEAR_SIDE : 0)
        if (final >= 0 && (!done || whole < done.cost)) done = { cost: whole, state, end: goal.end }
      }
      for (let leaving = 0; leaving < 4; leaving++) {
        if (leaving === reverse(entered) || (leaving !== entered && beside.has(state >> 2))) continue
        const next = step(c, leaving)
        if (!open(next)) continue
        const price = pass(c, entered, leaving)
        if (price >= 0) push(next, leaving, cost + 1 + price, state)
      }
    }
  }
  if (!done) return null
  const cells = [done.end]
  let first = done.state
  for (let back = done.state; back !== -1; back = came[back]!) cells.push(cell((first = back)))
  return { cost: done.cost, cells: [...cells, step(cell(first), reverse(first % 4))].reverse() }
}

const route = (graph: AsciiGraph, board: Board, edge: AsciiEdge, budget: { steps: number }): GridCoord[] => {
  const sides = flow(graph, edge) === 'LR' ? [DOWN, LEFT, RIGHT, UP] : [RIGHT, UP, DOWN, LEFT]
  const found = edge.from !== edge.to
    ? search(graph, board, edge, sides, sides, budget)
    : sides
        .map(from => search(graph, board, edge, [from], sides.filter(to => (from + to) % 2 === 1), budget))
        .reduce((best, loop) => (loop && (!best || loop.cost < best.cost) ? loop : best), null)
  if (!found) throw new Error(`mermaid found no free route for the back edge ${edge.from.name} to ${edge.to.name}`)
  return found.cells
}

// Moves the whole layout so that no cell has a negative coordinate.
const moveIntoGrid = (graph: AsciiGraph, board: Board, routes: Map<AsciiEdge, GridCoord[]>): void => {
  const all = [...routes.values()].flat()
  const dx = Math.max(0, -Math.min(...all.map(c => c.x)))
  const dy = Math.max(0, -Math.min(...all.map(c => c.y)))
  if (dx === 0 && dy === 0) return
  const moved = (c: GridCoord): GridCoord => ({ x: c.x + dx, y: c.y + dy })
  for (const node of graph.nodes) if (node.gridCoord) node.gridCoord = moved(node.gridCoord)
  graph.grid = new Map([...graph.grid].map(([name, node]) => {
    const [x, y] = name.split(',').map(Number)
    return [`${x! + dx},${y! + dy}`, node] as [string, AsciiNode]
  }))
  graph.columnWidth = new Map([...graph.columnWidth].map(([x, width]) => [x + dx, width] as [number, number]))
  graph.rowHeight = new Map([...graph.rowHeight].map(([y, height]) => [y + dy, height] as [number, number]))
  for (const edge of graph.edges) {
    edge.path = edge.path.map(moved)
    edge.labelLine = edge.labelLine.map(moved)
    if (edge.pathToJunction) edge.pathToJunction = edge.pathToJunction.map(moved)
  }
  for (const bundle of graph.bundles) {
    if (bundle.junctionPoint) bundle.junctionPoint = moved(bundle.junctionPoint)
    bundle.sharedPath = bundle.sharedPath.map(moved)
  }
  for (const [edge, cells] of routes) routes.set(edge, cells.map(moved))
  board.x += dx
  board.y += dy
}

// Puts the label on the first level stretch of the edge that no other edge touches and that has
// room for it, else on the largest one, widened; with no level stretch, across the longest upright one.
const placeLabel = (graph: AsciiGraph, board: Board, edge: AsciiEdge, cells: GridCoord[]): void => {
  // A lane is one row high.
  edge.text = edge.text.replace(/\s*\n\s*/g, ' ')
  if (edge.text.length === 0) return
  // A line cell on each side of the text, whichever way drawTextOnLine rounds its middle.
  const room = edge.text.length + 3
  const alone = cells.map((c, i) => {
    if (i === 0 || i === cells.length - 1) return false
    const entered = sideOf(cells[i - 1]!, c)
    const leaving = sideOf(c, cells[i + 1]!)
    const mine = (1 << reverse(entered)) | (1 << leaving)
    const held = (side: number) => board.links.get(link(board, c, side))!.edges
    return entered === leaving && (board.cells[index(board, c)]! & ALL_SIDES) === mine && held(leaving) === 1 && held(reverse(entered)) === 1
  })
  // A stretch runs between the cells at from - 1 and to + 1. Its size is the cells drawn between
  // them when it is level, and its rows when it is upright.
  type Stretch = { from: number; to: number; level: boolean; size: number }
  const stretches: Stretch[] = []
  for (let i = 1; i < cells.length - 1; i++) {
    if (!alone[i]) continue
    let to = i
    while (alone[to + 1]) to++
    const level = cells[i]!.y === cells[i - 1]!.y
    const size = level ? Math.abs(gridToDrawingCoord(graph, cells[to + 1]!).x - gridToDrawingCoord(graph, cells[i - 1]!).x) - 1 : to - i + 1
    stretches.push({ from: i, to, level, size })
    i = to
  }
  // The column of a stretch to widen: one between the nodes, else one through the middle of nodes,
  // whose boxes then grow. A column of box borders is one cell wide for the boxes to close.
  const part = (x: number) => Math.max(...graph.nodes.map(node => (node.gridCoord && x >= node.gridCoord.x && x <= node.gridCoord.x + 2 ? Math.abs(x - node.gridCoord.x - 1) : -1)))
  const widenable = (s: Stretch) => [-1, 0].flatMap(wanted => cells.slice(s.from, s.to + 1).filter(c => part(c.x) === wanted))[0]?.x
  const largest = (level: boolean) => stretches.filter(s => s.level === level && widenable(s) !== undefined).reduce<Stretch | undefined>((best, s) => (best && best.size >= s.size ? best : s), undefined)
  const chosen = stretches.find(s => s.level && s.size >= room) ?? largest(true) ?? largest(false)
  if (!chosen) throw new Error(`mermaid found no free cells for the label of the back edge ${edge.from.name} to ${edge.to.name}`)
  const column = widenable(chosen)
  if (column !== undefined) {
    const width = graph.columnWidth.get(column) ?? 0
    graph.columnWidth.set(column, chosen.level ? width + Math.max(0, room - chosen.size) : Math.max(width, room))
  }
  edge.labelLine = [cells[chosen.from - 1]!, cells[chosen.to + 1]!]
}

// The cells where back edges meet or cross, each with the sides they leave it by.
const junctions = new WeakMap<AsciiGraph, { cell: GridCoord; arms: number }[]>()
const JUNCTION_CHARS: Record<number, string> = { 7: '├', 11: '┴', 13: '┤', 14: '┬', 15: '┼' }

export function routeBackEdges(graph: AsciiGraph): void {
  const backEdges = graph.edges.filter(edge => isBackEdge(graph, edge))
  if (backEdges.length === 0) return
  if (graph.subgraphs.length > 0) throw new Error('mermaid cannot route a back edge in a diagram with subgraphs')

  const forward = graph.edges.filter(edge => !backEdges.includes(edge)).map(edge => cellsOf(edge.path))
  const taken = [...forward.flat(), ...graph.nodes.flatMap(node => (node.gridCoord ? [node.gridCoord, { x: node.gridCoord.x + 2, y: node.gridCoord.y + 2 }] : []))]
  // Each back edge may push the reach out again, on any side.
  const reach = reachOf(taken)
  const margin = REACH * backEdges.length
  const x = reach.left - margin
  const y = reach.top - margin
  const width = reach.right + margin - x + 1
  const height = reach.bottom + margin - y + 1
  const board: Board = { x, y, width, height, cells: new Uint8Array(width * height), links: new Map(), reach }
  for (const name of graph.grid.keys()) {
    const [nodeX, nodeY] = name.split(',').map(Number)
    board.cells[index(board, { x: nodeX!, y: nodeY! })] = NODE
  }
  for (const cells of forward) hold(board, cells)

  const span = (edge: AsciiEdge) => Math.abs(edge.from.gridCoord!.x - edge.to.gridCoord!.x) + Math.abs(edge.from.gridCoord!.y - edge.to.gridCoord!.y)
  const routes = new Map<AsciiEdge, GridCoord[]>()
  const budget = { steps: 0 }
  for (const edge of [...backEdges].sort((a, b) => span(a) - span(b))) {
    const cells = route(graph, board, edge, budget)
    hold(board, cells, edge)
    board.reach = reachOf(cells, board.reach)
    routes.set(edge, cells)
    edge.startDir = PORTS[sideOf(cells[0]!, cells[1]!)]!
    edge.endDir = PORTS[sideOf(cells[cells.length - 1]!, cells[cells.length - 2]!)]!
  }
  moveIntoGrid(graph, board, routes)

  const met = new Map<number, { cell: GridCoord; arms: number; edges: number }>()
  for (const [edge, cells] of routes) {
    edge.path = cornersOf(cells)
    for (const c of cells) {
      if (!graph.columnWidth.has(c.x)) graph.columnWidth.set(c.x, LANE_WIDTH)
      if (!graph.rowHeight.has(c.y)) graph.rowHeight.set(c.y, 1)
    }
    cells.slice(1, -1).forEach((c, i) => {
      const at = met.get(index(board, c)) ?? { cell: c, arms: 0, edges: 0 }
      met.set(index(board, c), { cell: c, arms: at.arms | (1 << reverse(sideOf(cells[i]!, c))) | (1 << sideOf(c, cells[i + 2]!)), edges: at.edges + 1 })
    })
  }
  for (const edge of backEdges) placeLabel(graph, board, edge, routes.get(edge)!)
  junctions.set(graph, [...met.values()].filter(at => at.edges > 1 && JUNCTION_CHARS[at.arms]))
}

// Draws the tee or cross where back edges meet. The corner and the line beneath it are each drawn
// for one edge, so neither shows the other.
export function drawBackEdgeJunctions(graph: AsciiGraph): void {
  for (const { cell, arms } of junctions.get(graph) ?? []) {
    const at = gridToDrawingCoord(graph, cell)
    if (graph.canvas[at.x]?.[at.y] === undefined) continue
    graph.canvas[at.x]![at.y] = graph.config.useAscii ? '+' : JUNCTION_CHARS[arms]!
    setRole(graph.roleCanvas, at.x, at.y, 'junction')
  }
}
