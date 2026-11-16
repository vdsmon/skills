/**
 * Narrowing a drawing past its narrowest wrap, one step at a time: a row of boxes or frames splits in
 * two, its right half moving to a new row under it; a level of edge labels side by side wraps them
 * narrower, then moves its right half to a level of labels of its own under it. Both cost rows, not
 * columns. The steps do not depend on the columns, so the drawings come in one order whatever the
 * terminal's width, and the narrowest of them fits at its own width.
 */

import type { Layout, Level, Narrowing, Scope } from './layout'
import { SLOTS } from './layout'

/** The narrowest an edge label wraps to. */
const LABEL_WRAP = 8

const packed = (level: Level) => level.nodes.at(-1)?.end ?? 0
const groupOf = (key: string | null) => (key?.startsWith('g:') ? Number(key.slice(2)) : null)

/** The things of a level that lie in its right half when packed, never all of them nor none. */
const rightHalf = <T extends { start: number; end: number }>(things: T[], width: number): T[] => {
  const past = things.findIndex(n => n.start + n.end > width)
  return things.slice(Math.min(things.length - 1, Math.max(1, past === -1 ? things.length - 1 : past)))
}

/**
 * The narrowing one step past `narrowing` for the drawing `laid`, or `null` when nothing is left to
 * narrow: the widest level of the top scope that can narrow does, and a row holding one frame narrows
 * that frame's widest level. `label` is the fit's wrap for edge labels.
 *
 * Narrowing always ends. A step adds a row, which never goes away and of which there are at most as
 * many as boxes and frames; or wraps labels to 8 columns, once each; or raises the level of some labels
 * between two rows, which never lowers and stays under `SLOTS`. Each kept bounded and only growing,
 * no step repeats a narrowing already made.
 */
export function narrower(laid: Layout, narrowing: Narrowing, label: number): Narrowing | null {
  const wrapOf = (edge: number) => narrowing.labels.get(edge)?.wrap ?? label
  const subOf = (edge: number) => narrowing.labels.get(edge)?.sub ?? 0

  const inScope = (scope: number | null): Narrowing | null => {
    const s = laid.scopes.get(scope)!
    for (const level of [...s.levels].sort((a, b) => packed(b) - packed(a))) {
      const step = level.kind === 'rank' ? row(scope, s, level) : level.kind === 'label' ? labels(s, level) : null
      if (step !== null) return step
    }
    return null
  }

  const row = (scope: number | null, s: Scope, level: Level): Narrowing | null => {
    const items = level.nodes.filter(n => n.item !== null)
    if (items.length === 1) {
      const g = groupOf(items[0]!.item)
      return g === null ? null : inScope(g)
    }
    const moved = new Set(rightHalf(items, packed(level)).map(n => n.item))
    const ranks = s.ranks.map((r, i) => (moved.has(s.items[i]!) ? level.rank + 1 : r > level.rank ? r + 1 : r))
    return { ...narrowing, ranks: new Map(narrowing.ranks).set(scope, ranks) }
  }

  const labels = (s: Scope, level: Level): Narrowing | null => {
    const placed = level.nodes.filter(n => n.edge !== null)
    const next = new Map(narrowing.labels)
    const wide = placed.filter(n => wrapOf(n.edge!) > LABEL_WRAP)
    if (wide.length > 0) {
      for (const n of wide) next.set(n.edge!, { wrap: LABEL_WRAP, sub: subOf(n.edge!) })
      return { ...narrowing, labels: next }
    }
    if (placed.length < 2) return null
    // The levels of labels under this one between the same two rows move down to make room.
    const below = s.levels.filter(other => other.kind === 'label' && other.rank === level.rank && other.sub >= level.sub)
    if (Math.max(...below.map(other => other.sub)) + 2 >= SLOTS) return null
    for (const other of s.levels) {
      if (other.kind !== 'label' || other.rank !== level.rank || other.sub <= level.sub) continue
      for (const n of other.nodes) if (n.edge !== null) next.set(n.edge, { wrap: wrapOf(n.edge), sub: subOf(n.edge) + 1 })
    }
    for (const n of rightHalf(placed, packed(level))) next.set(n.edge!, { wrap: wrapOf(n.edge!), sub: level.sub + 1 })
    return { ...narrowing, labels: next }
  }

  return inScope(null)
}
