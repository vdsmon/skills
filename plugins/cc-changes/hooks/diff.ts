export type Op = { kind: ' ' | '-' | '+'; text: string }

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: readonly string[]
}

/** Above this many cells the middle of a diff is one block of removes then adds, not an LCS. */
const MAX_CELLS = 4_000_000

export const linesOf = (text: string | null): string[] => (text === null || text === '' ? [] : text.replace(/\n$/, '').split('\n'))

/** A line diff: the common head and tail are trimmed, then an LCS over what is left. */
export function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const same = (from: readonly string[]) => from.map((text): Op => ({ kind: ' ', text }))
  return [...same(a.slice(0, head)), ...diffMiddle(midA, midB), ...same(a.slice(a.length - tail))]
}

function diffMiddle(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
    return [...a.map((text): Op => ({ kind: '-', text })), ...b.map((text): Op => ({ kind: '+', text }))]
  }
  // lcs[i][j] is the LCS length of a[i..] and b[j..], flattened.
  const width = m + 1
  const lcs = new Uint32Array((n + 1) * width)
  const cell = (i: number, j: number) => lcs[i * width + j] ?? 0
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[i] === b[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] ?? '' })
      i += 1
      j += 1
    } else if (j >= m || (i < n && cell(i + 1, j) >= cell(i, j + 1))) {
      ops.push({ kind: '-', text: a[i] ?? '' })
      i += 1
    } else {
      ops.push({ kind: '+', text: b[j] ?? '' })
      j += 1
    }
  }
  return ops
}

export function counts(ops: readonly Op[]) {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === '+') added += 1
    else if (op.kind === '-') removed += 1
  }
  return { added, removed }
}

/** A unified diff with `context` lines around each change; empty when nothing changed. */
export function unified(path: string, ops: readonly Op[], context = 3): string {
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]))
  if (changed.length === 0) return ''
  // Runs of ops that are changes or within `context` of one, merged when they touch.
  const runs: [number, number][] = []
  for (const index of changed) {
    const from = Math.max(0, index - context)
    const to = Math.min(ops.length - 1, index + context)
    const last = runs[runs.length - 1]
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else runs.push([from, to])
  }
  // The 1-based old and new line number each op starts at.
  const oldAt: number[] = []
  const newAt: number[] = []
  let oldLine = 1
  let newLine = 1
  for (const op of ops) {
    oldAt.push(oldLine)
    newAt.push(newLine)
    if (op.kind !== '+') oldLine += 1
    if (op.kind !== '-') newLine += 1
  }
  const out = [`--- a/${path}`, `+++ b/${path}`]
  for (const [from, to] of runs) {
    const body = ops.slice(from, to + 1)
    const oldLines = body.filter(op => op.kind !== '+').length
    const newLines = body.filter(op => op.kind !== '-').length
    const oldStart = (oldAt[from] ?? 1) - (oldLines === 0 ? 1 : 0)
    const newStart = (newAt[from] ?? 1) - (newLines === 0 ? 1 : 0)
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`)
    for (const op of body) out.push(`${op.kind}${op.text}`)
  }
  return out.join('\n')
}

/** The text before a change, rebuilt from the text after it and the change's hunks. */
export function unapply(after: string, hunks: readonly Hunk[]): string {
  const current = linesOf(after)
  const before: string[] = []
  let at = 0
  for (const hunk of [...hunks].sort((x, y) => x.newStart - y.newStart)) {
    // A hunk that adds to an empty spot names the line before it as its start.
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1
    before.push(...current.slice(at, Math.max(at, start)))
    at = Math.max(at, start)
    for (const line of hunk.lines) {
      const kind = line[0]
      if (kind === ' ') {
        before.push(line.slice(1))
        at += 1
      } else if (kind === '-') before.push(line.slice(1))
      else if (kind === '+') at += 1
    }
  }
  before.push(...current.slice(at))
  return before.length === 0 ? '' : `${before.join('\n')}\n`
}

/** The whole text a hunk list removed: what a deleted file held. */
export const removedText = (hunks: readonly Hunk[]) => {
  const lines = hunks.flatMap(hunk => hunk.lines.filter(line => line[0] === '-' || line[0] === ' ').map(line => line.slice(1)))
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
