import type { Inline } from './markdown'
import { inlineText } from './markdown'

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F1E6}-\u{1F1FF}\u{20000}-\u{3FFFD}\u20E3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

export const graphemes = (s: string): string[] => (segmenter ? [...segmenter.segment(s)].map(g => g.segment) : [...s])

export const cells = (s: string): string[] => (/^[ -~]*$/.test(s) ? [...s] : graphemes(s).flatMap(g => (WIDE.test(g) ? [g, ''] : [g])))

export const width = (s: string): number =>
  /^[ -~]*$/.test(s) ? s.length
  : s.length === 1 ? (/\p{M}/u.test(s) ? 0 : WIDE.test(s) ? 2 : 1)
  : graphemes(s).reduce((w, g) => (/^\p{M}+$/u.test(g) ? w : w + (WIDE.test(g) ? 2 : 1)), 0)

export const wrapRanges = (text: string, w: number): [number, number][] => {
  if (width(text) <= w) return [[0, text.length]]
  const out: [number, number][] = []
  let line: [number, number] | undefined
  let used = 0
  for (const word of text.matchAll(/\S+/g)) {
    let start = word.index
    const end = start + word[0].length
    let size = width(word[0])
    if (size > w) {
      if (line) out.push(line)
      line = undefined
      let cut = start
      let taken = 0
      for (const g of graphemes(text.slice(start, end))) {
        const step = width(g)
        if (cut > start && taken + step > w) {
          out.push([start, cut])
          start = cut
          size -= taken
          taken = 0
          if (size <= w) break
        }
        cut += g.length
        taken += step
      }
    }
    if (start === end) continue
    const joined = line ? used + width(text.slice(line[1], start)) + size : Infinity
    if (line && joined <= w) {
      line = [line[0], end]
      used = joined
    } else {
      if (line) out.push(line)
      line = [start, end]
      used = size
    }
  }
  if (line) out.push(line)
  return out.length ? out : [[0, 0]]
}

const sliceInline = (nodes: Inline[], from: number, to: number): Inline[] => {
  const out: Inline[] = []
  let at = 0
  for (const n of nodes) {
    const length = inlineText([n]).length
    const a = Math.max(from - at, 0)
    const b = Math.min(to - at, length)
    at += length
    if (a >= b) continue
    if ('children' in n) out.push({ ...n, children: sliceInline(n.children, a, b) })
    else out.push({ ...n, text: n.text.slice(a, b) })
  }
  return out
}

export const hasLink = (nodes: Inline[]): boolean => nodes.some(n => n.kind === 'link' || ('children' in n && hasLink(n.children)))

export const mostLines = (text: string, w: number): number => (text.match(/\S+/g)?.length ?? 0) + Math.ceil(width(text) / w)

export const wrapInline = (nodes: Inline[], w: number): Inline[][] => {
  const text = inlineText(nodes)
  return width(text) <= w ? [nodes] : wrapRanges(text, w).map(([a, b]) => sliceInline(nodes, a, b))
}

export const longestWord = (text: string): number => Math.max(0, ...text.split(/\s+/).map(width))

export const remember = <T,>(cache: Map<string, T>, key: string, make: () => T, limit = 200): T => {
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const value = make()
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value!)
  return value
}
