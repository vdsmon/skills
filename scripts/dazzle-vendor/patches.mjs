// cc-dazzle's own changes to beautiful-mermaid, applied to its source after upstream's patches.
// Each entry is [file, [[text the source must hold, its replacement], ...]].
//
// `node build.mjs --upstream-only` leaves them out, to check that the build still writes upstream's
// bundles byte for byte.

import { fileURLToPath } from 'node:url'

const UPSTREAM_ONLY = process.argv.includes('--upstream-only')
const BACK_EDGES = JSON.stringify(fileURLToPath(new URL('./back-edges.ts', import.meta.url)))

const PATCHES = [
  [/beautiful-mermaid\/src\/ascii\/grid\.ts$/, [
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

const applied = new Set()

export const ownPatches = (path, source) => {
  if (UPSTREAM_ONLY) return source
  for (const [file, changes] of PATCHES) {
    if (!file.test(path)) continue
    applied.add(file)
    for (const [from, to] of changes) {
      if (!source.includes(from)) throw new Error(`${path} no longer has "${from.trim().split('\n')[0]}"`)
      source = source.replace(from, to)
    }
  }
  return source
}

// esbuild loads a file through the first handler that matches it. Once upstream patches a file of
// OWN_FILES, its handler takes that file from the one cc-dazzle adds, and the changes here would be
// left out with no error.
export const checkOwnPatches = () => {
  const missed = PATCHES.filter(([file]) => !applied.has(file)).map(([file]) => file.source)
  if (!UPSTREAM_ONLY && missed.length > 0) throw new Error(`cc-dazzle's patches never reached ${missed.join(', ')}: pass the source through ownPatches in the handler that loads it`)
}

// The files cc-dazzle patches and upstream does not.
export const OWN_FILES = /beautiful-mermaid\/src\/ascii\/(grid|edge-bundling)\.ts$/
