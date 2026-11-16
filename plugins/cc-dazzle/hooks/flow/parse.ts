// From grok-mermaid 0.2.3 (Apache-2.0, see NOTICE), changed by cc-dazzle.

/**
 * Source text to diagram model. `parseFlow` returns `null` when the source is neither a flowchart
 * nor a state diagram; a graph over a cap comes back with `overCap` set.
 */

import { Graph, type Head, type LineKind, type Shape } from './graph'
import { asciiLower, cleanLabel, isIdChar, srcLines, stripControls } from './labels'

// ---------------------------------------------------------------- statements

function flushStatement(cur: string, out: string[]): string {
  const trimmed = cur.trim()
  if (trimmed !== '') out.push(trimmed)
  return ''
}

/**
 * Split one source line into statements on `;`, stopping at a `%%` comment.
 *
 * Quoted spans are opaque, so a label may contain `;` and `%%`.
 */
export function splitStatements(line: string, out: string[]): void {
  // An accessible title or description runs to the end of its line, `;` and all.
  if (ACCESSIBLE_LINE.test(line)) {
    flushStatement(line, out)
    return
  }
  const chars = [...line]
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (inQuotes) {
      if (c === '"') inQuotes = false
      cur += c
    } else if (c === '"') {
      inQuotes = true
      cur += c
    } else if (c === '%' && chars[i + 1] === '%') {
      break
    } else if (c === ';') {
      cur = flushStatement(cur, out)
    } else {
      cur += c
    }
  }
  flushStatement(cur, out)
}

/** All statements in a source block, in order. */
export function statementsOf(src: string): string[] {
  const out: string[] = []
  for (const line of srcLines(src)) splitStatements(line, out)
  return out
}

const firstWord = (s: string): string => s.split(/\s+/).filter((w) => w !== '')[0] ?? ''

/** Split on the first occurrence of `sep`, Rust's `split_once`. */
function splitOnce(s: string, sep: string): [string, string] | null {
  const i = s.indexOf(sep)
  return i === -1 ? null : [s.slice(0, i), s.slice(i + sep.length)]
}

const nonEmpty = (s: string): string | null => (s === '' ? null : s)

/** Whether a direction, as a flowchart's header or a `direction` statement names it, runs sideways. */
const sideways = (direction: string | undefined) => direction === 'LR' || direction === 'RL' || direction === '>' || direction === '<'

/** Diagram kind from the header statement, lowercased. */
function headerKind(statements: string[]): string | null {
  const header = statements[0]
  if (header === undefined) return null
  const kind = firstWord(header)
  return kind === '' ? null : asciiLower(kind)
}

const ACCESSIBLE_LINE = /^\s*acc(Title|Descr)\s*:/i
/** An accessible description over several lines, `accDescr {` to `}`. */
const ACCESSIBLE_BLOCK = /^accDescr\s*\{/i

/**
 * Whether `st` opens or is part of a statement that draws nothing: an accessible title or description.
 * `open` is set while a block description runs, and the result says whether it still does.
 */
function accessible(st: string, open: boolean): { skip: boolean; open: boolean } {
  if (open) return { skip: true, open: !st.includes('}') }
  if (ACCESSIBLE_LINE.test(st)) return { skip: true, open: false }
  if (ACCESSIBLE_BLOCK.test(st)) return { skip: true, open: !st.includes('}') }
  return { skip: false, open: false }
}

/** A Mermaid source without its front matter (`---` lines around a title or config), which draws nothing. */
export const withoutFrontMatter = (src: string) => src.replace(/^\s*---[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*---[ \t]*(\r?\n|$)/, '')

/** A markdown string, "`…`", may run over several lines; each line break is a break in the label. */
const joinMarkdownLines = (src: string) => src.replace(/"`[^`"]*`"/g, md => md.replace(/[ \t]*\r?\n[ \t]*/g, '<br>'))

/** The flowchart or state diagram `src` holds, or `null` for any other kind. */
export function parseFlow(src: string): Graph | null {
  src = joinMarkdownLines(withoutFrontMatter(stripControls(src)))
  const kind = headerKind(statementsOf(src))
  if (kind === 'graph' || kind === 'flowchart') return parseGraph(src)
  if (kind?.startsWith('statediagram')) return parseState(src)
  return null
}

// ----------------------------------------------------------------- flowchart

function parseGraph(src: string): Graph {
  const statements = statementsOf(src)
  const graph = new Graph()
  graph.sideways = sideways(statements[0]!.split(/\s+/)[1])
  let depth = 0
  let describing = false
  // Ids given to edges, as in `A e1@--> B`; `e1@{ … }` then sets the edge's look, not a box's.
  const edgeIds = new Set<string>()

  for (const st of statements.slice(1)) {
    const acc = accessible(st, describing)
    describing = acc.open
    if (acc.skip) continue
    // Mermaid's keywords are case-sensitive: `End` and `Style` are boxes.
    switch (firstWord(st)) {
      case 'subgraph': {
        const [id, label] = parseSubgraphDecl(st.slice('subgraph'.length).trim())
        if (graph.openGroup(id, label, depth) === null) return graph
        depth++
        continue
      }
      case 'end':
        if (depth > 0) depth--
        graph.closeGroup()
        continue
      case 'classDef':
      case 'class':
      case 'style':
      case 'linkStyle':
      case 'click':
      case 'direction':
        continue
      default:
        break
    }
    const data = /^([^\s"[\](){}|@]+)@\{/.exec(st)
    if (data !== null && edgeIds.has(data[1]!)) continue
    parseStatement(st, graph, edgeIds)
    if (graph.overCap) return graph
  }
  return graph
}

/** `subgraph id[Title]`, `subgraph "Title"`, or a bare title. */
function parseSubgraphDecl(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1)
    if (close !== -1) {
      const label = rest.slice(1, close)
      return [label, cleanLabel(rest.slice(0, close + 1))]
    }
  }
  const open = rest.indexOf('[')
  if (open !== -1) {
    const id = rest.slice(0, open).trim()
    const label = cleanLabel(
      rest
        .slice(open + 1)
        .replace(/\]+$/, '')
        .trim(),
    )
    if (id !== '' && label !== '') return [id, label]
  }
  return [rest, cleanLabel(rest)]
}

/**
 * A chain of `node link node link node ...`, each link fanning out over `&`.
 *
 * Parses as far as it can and keeps the prefix, matching upstream and
 * mermaid.js. Whatever it could not read is recorded in `graph.warnings` rather
 * than failing the diagram — see the note on that field.
 */
function parseStatement(st: string, graph: Graph, edgeIds: Set<string>): void {
  const chars = [...st]
  let i = 0

  const head = parseNodeGroup(chars, i, graph)
  if (!head) {
    graph.warnings.push(`dropped, does not start with a node: "${st}"`)
    return
  }
  let prev = head.group
  i = head.next

  for (;;) {
    i = skipSpaces(chars, i)
    if (i >= chars.length) break
    const edgeId = /^([^\s"[\](){}|]+)@(?=[^{"])/.exec(chars.slice(i).join(''))
    if (edgeId !== null) {
      edgeIds.add(edgeId[1]!)
      i += [...edgeId[0]].length
    }
    const link = parseLink(chars, i)
    if (!link) {
      graph.warnings.push(`dropped, expected a link: "${chars.slice(i).join('')}"`)
      break
    }
    i = skipSpaces(chars, link.next)
    const target = parseNodeGroup(chars, i, graph)
    if (!target) {
      graph.warnings.push(`dropped, link has no target: "${st}"`)
      break
    }
    i = target.next
    // An invisible link only places its boxes.
    if (link.invisible) {
      prev = target.group
      continue
    }
    for (const f of prev) {
      for (const t of target.group) {
        // `A <-- B` reads right-to-left: swap the endpoints so the arrow that
        // was written on the left becomes a normal forward head.
        const reversed = link.left === 'arrow' && link.right !== 'arrow'
        const pushed = graph.pushEdge({
          from: reversed ? t : f,
          to: reversed ? f : t,
          label: link.label,
          headTo: reversed ? 'arrow' : link.right,
          headFrom: reversed ? link.right : link.left,
          line: link.line,
        })
        if (!pushed) return
      }
    }
    prev = target.group
  }
}

/** One or more nodes joined by `&`, which fan out into a cross product. */
function parseNodeGroup(
  chars: string[],
  start: number,
  graph: Graph,
): { group: number[]; next: number } | null {
  const first = parseNode(chars, start, graph)
  if (!first) return null
  const group = [first.index]
  let i = first.next
  for (;;) {
    const j = skipSpaces(chars, i)
    if (chars[j] !== '&') break
    const next = parseNode(chars, j + 1, graph)
    if (!next) return null
    group.push(next.index)
    i = next.next
  }
  return { group, next: i }
}

function skipSpaces(chars: string[], i: number): number {
  while (i < chars.length && (chars[i] === ' ' || chars[i] === '\t')) i++
  return i
}

function parseNode(
  chars: string[],
  start: number,
  graph: Graph,
): { index: number; next: number } | null {
  let i = skipSpaces(chars, start)
  const idStart = i
  // A hyphen joins an id, as in `cc-wrap-up`, unless it starts a link (`--`, `-.`, `->`).
  while (i < chars.length && (isIdChar(chars[i]!) || (chars[i] === '-' && i > idStart && !'-.>'.includes(chars[i + 1] ?? '-')))) i++
  if (i === idStart) return null
  const id = chars.slice(idStart, i).join('')

  const shaped = chars[i] === '@' && chars[i + 1] === '{' ? readShapeData(chars, i + 2) : readShapeAt(chars, i)
  if (shaped.unclosed !== undefined) {
    graph.warnings.push(`node "${id}": label is missing its closing \`${shaped.unclosed}\``)
  }
  const index = graph.nodeIndex(id, shaped.label, shaped.shape)
  if (index === null) return null

  // `id:::name` (after any shape) attaches a style class; swallow it so the
  // statement keeps parsing — upstream drops the rest of the line here.
  let next = shaped.after
  if (chars[next] === ':' && chars[next + 1] === ':' && chars[next + 2] === ':') {
    let k = next + 3
    while (k < chars.length && (isIdChar(chars[k]) || chars[k] === '-')) k++
    // A name never ends in `-`: back off so `A:::x-->B` keeps its link.
    while (k > next + 3 && chars[k - 1] === '-') k--
    if (k > next + 3) next = k
  }
  return { index, next }
}

/** What a shape bracket yielded. `closer` is set when the bracket never closed. */
interface Shaped {
  shape: Shape
  label: string | null
  after: number
  /** The closing token that was expected but never found. */
  unclosed?: string
}

const ROUND_SHAPES = new Set(['rounded', 'event', 'stadium', 'pill', 'terminal', 'circle', 'circ', 'sm-circ', 'small-circle', 'start', 'dbl-circ', 'double-circle', 'fr-circ', 'framed-circle', 'stop', 'f-circ', 'filled-circle', 'junction', 'cyl', 'cylinder', 'database', 'db'])
const DIAMOND_SHAPES = new Set(['diamond', 'diam', 'decision', 'question', 'hex', 'hexagon', 'prepare'])

/**
 * The shape data of `id@{ shape: …, label: "…" }`, read from just inside its brace: its label, else
 * none, and a shape near the one named.
 */
function readShapeData(chars: string[], start: number): Shaped {
  let i = start
  let inQuotes = false
  for (; i < chars.length && (inQuotes || chars[i] !== '}'); i++) if (chars[i] === '"') inQuotes = !inQuotes
  const body = chars.slice(start, i).join('')
  const after = Math.min(chars.length, i + 1)
  const field = (name: string) => new RegExp(`(?:^|[,{\\s])${name}\\s*:\\s*("(?:[^"]*)"|[^,}]*)`).exec(body)?.[1]?.trim()
  const label = field('label')
  const shape = asciiLower(field('shape') ?? '')
  const shaped: Shaped = { shape: DIAMOND_SHAPES.has(shape) ? 'diamond' : ROUND_SHAPES.has(shape) ? 'round' : 'rect', label: label === undefined ? null : cleanLabel(label), after }
  return i < chars.length ? shaped : { ...shaped, unclosed: '}' }
}

/** Dispatch on the bracket following an id to pick shape and closing token. */
function readShapeAt(chars: string[], i: number): Shaped {
  const c = chars[i]
  const n = chars[i + 1]
  if (c === '[') {
    if (n === '[') return readShape(chars, i + 2, ']]', 'rect')
    if (n === '(') return readShape(chars, i + 2, ')]', 'round')
    if (n === '/' || n === '\\') return readShape(chars, i + 2, ['/]', '\\]'], 'rect')
    return readShape(chars, i + 1, ']', 'rect')
  }
  if (c === '(') {
    if (n === '(' && chars[i + 2] === '(') return readShape(chars, i + 3, ')))', 'round')
    if (n === '(') return readShape(chars, i + 2, '))', 'round')
    if (n === '[') return readShape(chars, i + 2, '])', 'round')
    return readShape(chars, i + 1, ')', 'round')
  }
  if (c === '{') {
    if (n === '{') return readShape(chars, i + 2, '}}', 'diamond')
    return readShape(chars, i + 1, '}', 'diamond')
  }
  if (c === '>') return readShape(chars, i + 1, ']', 'rect')
  return { shape: 'rect', label: null, after: i }
}

/**
 * Read label text up to `closer`.
 *
 * Quoting is decided by the first non-space character: inside a quoted label
 * the closer is ignored until the quote closes, so `A["a] b"]` is one node.
 * An unquoted label ends at the first closer, so `A[5" pipe]` keeps its quote.
 */
function readShape(chars: string[], start: number, closers: string | string[], shape: Shape): Shaped {
  const closer = (at: number) => [closers].flat().find(c => chars.slice(at, at + c.length).join('') === c)
  let j = start
  while (chars[j] === ' ' || chars[j] === '\t') j++
  const quoted = chars[j] === '"'

  let i = start
  let text = ''
  let inQuotes = false
  while (i < chars.length) {
    const c = chars[i]
    if (quoted && c === '"') {
      inQuotes = !inQuotes
      text += c
      i++
      continue
    }
    const closed = inQuotes ? undefined : closer(i)
    if (closed !== undefined) return { shape, label: cleanLabel(text), after: i + closed.length }
    text += c
    i++
  }
  // Ran off the end still looking for the closer: everything after the opening
  // bracket became label text, so any link operator in it was swallowed.
  return { shape, label: cleanLabel(text), after: chars.length, unclosed: [closers].flat()[0] }
}

const isLinkChar = (c: string | undefined): boolean =>
  c === '-' || c === '.' || c === '=' || c === '<' || c === '>'

interface Link {
  left: Head
  right: Head
  line: LineKind
  label: string | null
  next: number
  /** `~~~`: the boxes are placed as if linked, with no edge between them. */
  invisible?: boolean
}

/**
 * Read a link operator and its label.
 *
 * Labels come in two forms: `-->|text|` and the inline `-- text -->`, the
 * latter only when the first operator carried no head.
 */
function parseLink(chars: string[], start: number): Link | null {
  let i = skipSpaces(chars, start)
  if (chars[i] === '~' && chars[i + 1] === '~' && chars[i + 2] === '~') {
    while (chars[i] === '~') i++
    return { left: 'none', right: 'none', line: 'solid', label: null, next: i, invisible: true }
  }
  let left: Head = 'none'
  // A leading `o`/`x` decorates the tail, but only directly before an operator.
  if (
    (chars[i] === 'o' || chars[i] === 'x') &&
    (chars[i + 1] === '-' || chars[i + 1] === '.' || chars[i + 1] === '=')
  ) {
    left = chars[i] === 'o' ? 'circle' : 'cross'
    i++
  }

  const opStart = i
  while (i < chars.length && isLinkChar(chars[i])) i++
  if (i === opStart) return null
  const op1 = chars.slice(opStart, i).join('')
  if (left === 'none' && op1.startsWith('<')) left = 'arrow'

  let line = lineKind(op1)
  let right: Head = op1.includes('>') ? 'arrow' : 'none'
  if (right === 'none') {
    const trailing = trailingHead(chars, i)
    if (trailing) {
      right = trailing.head
      i = trailing.next
    }
  }

  if (chars[skipSpaces(chars, i)] === '|') {
    i = skipSpaces(chars, i) + 1
    const lStart = i
    while (i < chars.length && chars[i] !== '|') i++
    const label = cleanLabel(chars.slice(lStart, i).join(''))
    if (chars[i] === '|') i++
    return { left, right, line, label: nonEmpty(label), next: i }
  }

  // Only an opening `--`, `-.` or `==` takes inline text; a hyphen or dot inside the text, as in
  // `-- re-run -->`, is part of it, and the text ends at the next whole operator.
  const opens = right === 'none' && /^<?(--|-\.|==)$/.test(op1)
  for (let j = skipSpaces(chars, i), textStart = j; opens && j < chars.length; ) {
    if (!isLinkChar(chars[j]!)) {
      j++
      continue
    }
    const op2Start = j
    while (j < chars.length && isLinkChar(chars[j]!)) j++
    const op2 = chars.slice(op2Start, j).join('')
    if (op2Start === textStart || op2.startsWith('<') || (op2.length < 2 && !op2.includes('>'))) continue
    const text = chars.slice(textStart, op2Start).join('')
    if (op2.includes('>')) {
      right = 'arrow'
    } else {
      const trailing = trailingHead(chars, j)
      if (trailing) {
        right = trailing.head
        j = trailing.next
      }
    }
    if (line === 'solid') line = lineKind(op2)
    return { left, right, line, label: nonEmpty(cleanLabel(text)), next: j }
  }

  return { left, right, line, label: null, next: i }
}

function lineKind(op: string): LineKind {
  if (op.includes('=')) return 'thick'
  if (op.includes('.')) return 'dotted'
  return 'solid'
}

/**
 * A trailing `o`/`x` head, written right after the operator. As in Mermaid, it belongs to the link
 * even when a name follows it at once: `A---oB` is a circle link to `B`.
 */
function trailingHead(chars: string[], i: number): { head: Head; next: number } | null {
  const head: Head | null = chars[i] === 'o' ? 'circle' : chars[i] === 'x' ? 'cross' : null
  return head === null ? null : { head, next: i + 1 }
}

// --------------------------------------------------------------------- state

/**
 * A state diagram. A composite state (`state X {`) opens a group, drawn as a frame like a
 * subgraph; a statement it cannot read is dropped with a warning, as a flowchart's is.
 */
function parseState(src: string): Graph {
  const graph = new Graph()
  // A note over several lines: the state it is on and its lines so far.
  let note: { on: string; lines: string[] } | null = null
  let describing = false
  let depth = 0
  // Concurrent regions of a composite state, split by `--`, each have their own start and end.
  const regions = new Map<number | null, number>()

  for (let st of statementsOf(src).slice(1)) {
    if (note !== null) {
      if (asciiLower(st) !== 'end note') note.lines.push(st)
      else {
        addNote(graph, note.on, note.lines)
        note = null
      }
      if (graph.overCap) return graph
      continue
    }
    const acc = accessible(st, describing)
    describing = acc.open
    if (acc.skip) continue
    st = dropStyleTags(st)
    const first = asciiLower(firstWord(st))
    let read: 'open' | true | null = true
    if (first === 'note') {
      const on = /^note\s+(?:left|right)\s+of\s+([^\s:]+)\s*(?::(.*))?$/i.exec(st)
      if (on === null) read = null
      else if (on[2] === undefined) note = { on: on[1]!, lines: [] }
      else addNote(graph, on[1]!, [on[2]])
    } else if (first === 'state') {
      read = parseStateDecl(st, graph, depth)
      if (read === 'open') depth++
    } else if (st === '}') {
      if (depth > 0) depth--
      graph.closeGroup()
    } else if (first === '--') {
      regions.set(graph.curGroup, (regions.get(graph.curGroup) ?? 0) + 1)
    } else if (first === 'direction') {
      // Inside a composite state it sets only that state's direction, which the drawer does not follow.
      if (depth === 0) graph.sideways = sideways(st.split(/\s+/)[1]?.toUpperCase())
    } else if (['classdef', 'class', 'style', 'hide', 'scale'].includes(first)) {
      // Styling carries no layout meaning here.
    } else if (st.includes('-->')) {
      read = parseTransition(st, graph, regions.get(graph.curGroup) ?? 0)
    } else {
      read = parseStateDesc(st, graph)
    }
    if (graph.overCap) return graph
    if (read === null) graph.warnings.push(`dropped, unreadable: "${st}"`)
  }
  // A note still open when the source ends, as while a reply streams, draws what it has so far.
  if (note !== null) addNote(graph, note.on, note.lines)
  return graph
}

/** A note: a box of its own holding its text, one line per line, joined to its state by a dotted line. */
function addNote(graph: Graph, on: string, lines: string[]): void {
  const state = graph.nodeIndex(on, null, 'round')
  const text = lines.map(cleanLabel).filter(l => l !== '').join('\n')
  if (state === null || text === '') return
  const box = graph.nodeIndex(`note@${graph.nodes.length}`, text, 'rect')
  if (box !== null) graph.pushEdge({ from: state, to: box, label: null, headTo: 'none', headFrom: 'none', line: 'dotted' })
}

/** `state "Label" as id`, `state id <<choice>>`, or `state id {`, which opens a group. */
function parseStateDecl(st: string, graph: Graph, depth: number): 'open' | true | null {
  const body = st.slice('state'.length).trim()
  const opens = body.endsWith('{')
  const rest = body.replace(/\{$/, '').trim()
  if (rest === '') return null
  const declared = (id: string, label: string, made: number | null) => {
    if (made === null) return null
    return opens ? (graph.openGroup(id, label, depth) === null ? null : 'open') : true
  }

  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1)
    if (close === -1) return null
    const label = cleanLabel(rest.slice(0, close + 1))
    const after = rest.slice(close + 1).trim()
    const id = after.startsWith('as') ? after.slice(2).trim() : label
    return declared(id, label, graph.nodeLabel(id, label))
  }

  let shape: Shape = 'round'
  let id = rest
  let stereotyped = false
  const pos = rest.indexOf('<<')
  if (pos !== -1) {
    const stereo = rest
      .slice(pos + 2)
      .replace(/>>$/, '')
      .trim()
    if (stereo === 'choice') shape = 'diamond'
    id = rest.slice(0, pos).trim()
    stereotyped = true
  }
  if (id === '' || /\s/.test(id)) return null
  const made = graph.nodeIndex(id, stereotyped ? id : null, shape)
  return declared(id, made === null ? id : graph.nodes[made]!.label, made)
}

/** `A --> B: label`, including chains `A --> B --> C`. */
function parseTransition(st: string, graph: Graph, region: number): true | null {
  let rest = st
  let prev: number | null = null

  for (;;) {
    const split = splitOnce(rest, '-->')
    if (!split) break
    const [lhs, rhs] = split

    const fromId = lhs.trimEnd().replace(/-+$/, '').trim()
    let from: number
    if (prev !== null) {
      // Mid-chain: the source is the previous target, so nothing may precede.
      if (fromId !== '') return null
      from = prev
    } else {
      if (fromId === '') return null
      const f = stateEndpoint(graph, fromId, true, region)
      if (f === null) return null
      from = f
    }

    const nextArrow = rhs.indexOf('-->')
    const toPartRaw = nextArrow === -1 ? rhs : rhs.slice(0, nextArrow)
    const tail = nextArrow === -1 ? '' : rhs.slice(nextArrow)

    const colon = splitOnce(toPartRaw, ':')
    const toPart = colon ? colon[0] : toPartRaw
    const label = colon ? nonEmpty(cleanLabel(colon[1])) : null

    const toId = toPart.trimStart().replace(/^>+/, '').trimEnd().replace(/-+$/, '').trim()
    if (toId === '') return null
    const to = stateEndpoint(graph, toId, false, region)
    if (to === null) return null

    if (!graph.pushEdge({ from, to, label, headTo: 'arrow', headFrom: 'none', line: 'solid' })) {
      return true
    }
    prev = to
    rest = tail
  }
  return true
}

/**
 * Remove every `:::name` style tag from a statement, parsed with the same
 * name scan as the flowchart shorthand. State and class statements are read
 * by string splits, and the `:` label split would cut inside a `:::`, so tags
 * are dropped before dispatch rather than at each id.
 */
function dropStyleTags(st: string): string {
  const chars = [...st]
  const out: string[] = []
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === ':' && chars[i + 1] === ':' && chars[i + 2] === ':') {
      let k = i + 3
      while (k < chars.length && (isIdChar(chars[k]) || chars[k] === '-')) k++
      while (k > i + 3 && chars[k - 1] === '-') k--
      if (k > i + 3) {
        i = k
        continue
      }
    }
    out.push(chars[i]!)
    i++
  }
  return out.join('')
}

/**
 * `[*]` is start or end depending on which side of the arrow it sits, one of each per composite state
 * and per concurrent region of it.
 */
function stateEndpoint(graph: Graph, id: string, isSource: boolean, region: number): number | null {
  if (id === '[*]') return graph.nodeIndex(`[*]${isSource ? 'start' : 'end'}@${graph.curGroup ?? ''}#${region}`, '●', 'round')
  return graph.nodeIndex(id, null, 'round')
}

/** `id: description`, or a bare state name. */
function parseStateDesc(st: string, graph: Graph): true | null {
  const split = splitOnce(st, ':')
  if (split) {
    const id = split[0].trim()
    const desc = split[1].trim()
    if (id === '' || /\s/.test(id) || desc === '') return null
    return graph.nodeLabel(id, cleanLabel(desc)) === null ? null : true
  }
  if (/\s/.test(st)) return null
  return graph.nodeIndex(st, null, 'round') === null ? null : true
}

