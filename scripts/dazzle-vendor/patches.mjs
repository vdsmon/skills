// cc-dazzle's own changes to beautiful-mermaid, applied to its source after upstream's patches.
// Each entry is [file, [[text the source must hold, its replacement], ...]].

import { fileURLToPath } from 'node:url'

const BACK_EDGES = JSON.stringify(fileURLToPath(new URL('./back-edges.ts', import.meta.url)))

const PATCHES = [
  [/beautiful-mermaid\/src\/ascii\/grid\.ts$/, [
    // A row or column that only edges use took half the padding, rounded down: none at all at the
    // padding cc-dazzle draws with, so an edge routed under the last row of nodes was cut off.
    ['graph.columnWidth.set(c.x, Math.floor(graph.config.paddingX / 2))', 'graph.columnWidth.set(c.x, Math.max(1, Math.floor(graph.config.paddingX / 2)))'],
    ['graph.rowHeight.set(c.y, Math.floor(graph.config.paddingY / 2))', 'graph.rowHeight.set(c.y, Math.max(1, Math.floor(graph.config.paddingY / 2)))'],
    ["import { determinePath, determineLabelLine } from './edge-routing.ts'", `import { determinePath, determineLabelLine } from './edge-routing.ts'\nimport { isBackEdge, routeBackEdges } from ${BACK_EDGES}`],
    ['  for (const edge of graph.edges) {\n    // Skip edges that were already routed as part of a bundle\n', '  for (const edge of graph.edges) {\n    if (isBackEdge(graph, edge)) continue\n    // Skip edges that were already routed as part of a bundle\n'],
    ['  // Convert grid coords → drawing coords and generate box drawings\n', '  routeBackEdges(graph)\n\n  // Convert grid coords → drawing coords and generate box drawings\n'],
  ]],
  [/beautiful-mermaid\/src\/ascii\/edge-bundling\.ts$/, [
    // A bundle joins its edges at a point between the ranks, where a back edge does not pass.
    ["import { getNodeSubgraph } from './grid.ts'", `import { getNodeSubgraph } from './grid.ts'\nimport { isBackEdge } from ${BACK_EDGES}`],
    ['    // Skip self-loops\n    if (edge.from === edge.to) continue\n', '    // Skip self-loops\n    if (edge.from === edge.to || isBackEdge(graph, edge)) continue\n'],
    ['    // Skip self-loops and already bundled edges\n    if (edge.from === edge.to) continue\n', '    // Skip self-loops and already bundled edges\n    if (edge.from === edge.to || isBackEdge(graph, edge)) continue\n'],
  ]],
  [/beautiful-mermaid\/src\/ascii\/draw\.ts$/, [
    ["import { gridToDrawingCoord, lineToDrawing } from './grid.ts'", `import { gridToDrawingCoord, lineToDrawing } from './grid.ts'\nimport { drawBackEdgeJunctions, isBackEdge } from ${BACK_EDGES}`],
    ["  fillRolesFromCanvases(graph.roleCanvas, junctionCanvases, zero, 'junction')\n", "  fillRolesFromCanvases(graph.roleCanvas, junctionCanvases, zero, 'junction')\n  drawBackEdgeJunctions(graph)\n"],
    // The shift keeps the labels of two edges on one line apart; a back edge has its line alone.
    ['  drawTextOnLine(canvas, drawingLine, edge.text, isUpwardEdge)', '  drawTextOnLine(canvas, drawingLine, edge.text, isBackEdge(graph, edge) ? undefined : isUpwardEdge)'],
  ]],
]

export const ownPatches = (path, source) => {
  for (const [file, changes] of PATCHES) {
    if (!file.test(path)) continue
    for (const [from, to] of changes) {
      if (!source.includes(from)) throw new Error(`${path} no longer has "${from.trim().split('\n')[0]}"`)
      source = source.replace(from, to)
    }
  }
  return source
}

export const OWN_FILES = /beautiful-mermaid\/src\/ascii\/(grid|edge-bundling)\.ts$/
