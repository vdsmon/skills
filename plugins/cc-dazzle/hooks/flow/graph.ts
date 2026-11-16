// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

/** The diagram model flowcharts and state diagrams parse into. */

/** Caps that keep layout bounded; exceeding one makes the diagram too large to draw. */
export const MAX_NODES = 128
export const MAX_EDGES = 512
export const MAX_GROUPS = 24
export const MAX_GROUP_DEPTH = 6

export type Shape = 'rect' | 'round' | 'diamond'

/** Decoration at one end of an edge. */
export type Head = 'none' | 'arrow' | 'circle' | 'cross'

export type LineKind = 'solid' | 'dotted' | 'thick'

export interface Node {
  /** `n:<index>` for a parsed node, `g:<index>` for a group drawn as a frame. */
  key: string
  label: string
  shape: Shape
}

export interface Edge {
  /** The edge's index in the parsed source, kept when a layout scope copies it. */
  index: number
  from: number
  to: number
  label: string | null
  headTo: Head
  headFrom: Head
  line: LineKind
}

export interface Group {
  id: string
  label: string
  parent: number | null
}

export class Graph {
  nodes: Node[] = []
  edges: Edge[] = []
  index = new Map<string, number>()
  /** Each node's id in the source, parallel to `nodes`. */
  ids: string[] = []
  groups: Group[] = []
  /** Innermost group each node was first named in, parallel to `nodes`. */
  nodeGroup: (number | null)[] = []
  curGroup: number | null = null
  /** Set when a cap was hit: the diagram is too large to draw. */
  overCap = false
  /**
   * Statements the grammar could not read and dropped. Parsing is lenient: a malformed statement
   * keeps whatever prefix parsed.
   */
  warnings: string[] = []

  /**
   * Index of `id`, creating the node if new. A later declaration carrying a label overwrites the
   * placeholder one an edge created. Returns `null` once `MAX_NODES` is reached.
   */
  nodeIndex(id: string, label: string | null, shape: Shape): number | null {
    const existing = this.index.get(id)
    if (existing !== undefined) {
      this.pull(existing)
      if (label !== null) {
        this.nodes[existing]!.label = label
        this.nodes[existing]!.shape = shape
      }
      return existing
    }
    if (this.nodes.length >= MAX_NODES) {
      this.overCap = true
      return null
    }
    this.index.set(id, this.nodes.length)
    this.ids.push(id)
    this.nodes.push({ key: `n:${this.nodes.length}`, label: label ?? id, shape })
    this.nodeGroup.push(this.curGroup)
    return this.nodes.length - 1
  }

  /** Set a node's label without disturbing its shape, creating it if new. */
  nodeLabel(id: string, label: string): number | null {
    const existing = this.index.get(id)
    if (existing !== undefined) {
      this.pull(existing)
      this.nodes[existing]!.label = label
      return existing
    }
    return this.nodeIndex(id, label, 'round')
  }

  /**
   * A node named again inside a group nested in its own moves into that group, as in Mermaid, where
   * listing an earlier node in a subgraph puts it there.
   */
  private pull(node: number): void {
    for (let g = this.curGroup; g !== null; ) {
      g = this.groups[g]!.parent
      if (g === this.nodeGroup[node]) {
        this.nodeGroup[node] = this.curGroup
        return
      }
    }
  }

  pushEdge(edge: Omit<Edge, 'index'>): boolean {
    if (this.edges.length >= MAX_EDGES) {
      this.overCap = true
      return false
    }
    this.edges.push({ ...edge, index: this.edges.length })
    return true
  }

  /** Open a group under the current one, or flag `overCap` past the caps. */
  openGroup(id: string, label: string, depth: number): number | null {
    if (this.groups.length >= MAX_GROUPS || depth >= MAX_GROUP_DEPTH) {
      this.overCap = true
      return null
    }
    this.groups.push({ id, label, parent: this.curGroup })
    this.curGroup = this.groups.length - 1
    return this.curGroup
  }

  closeGroup(): void {
    if (this.curGroup !== null) this.curGroup = this.groups[this.curGroup]!.parent
  }

  /** The group a node stands in for: a node whose id is a group's id is drawn as that frame. */
  proxyOf(node: number): number | undefined {
    const group = this.groups.findLastIndex(g => g.id === this.ids[node])
    return group < 0 ? undefined : group
  }
}
