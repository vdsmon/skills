// Claude Code releases that first accept what cc-dazzle would draw; older ones drop the whole row.
export const CLICKABLE_MARKS_FROM = [2, 1, 295]

export const releaseFrom = (from: readonly number[]) => (base?: string): boolean => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '')
  if (!m) return false
  const version = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = version.findIndex((n, i) => n !== from[i])
  return at === -1 || version[at]! > from[at]!
}

export const takesClickableMarks = releaseFrom(CLICKABLE_MARKS_FROM)
