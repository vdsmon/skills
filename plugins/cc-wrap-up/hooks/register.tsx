import type { Register } from 'claude-code'

// Set from the plugin's options each time register runs.
const cfg = { start: 500_000, step: 100_000, urgent: 920_000 }

const tokensOf = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const register: Register = (on, options) => {
  cfg.start = tokensOf(options.startTokens, 500_000)
  cfg.step = tokensOf(options.stepTokens, 100_000)
  cfg.urgent = tokensOf(options.urgentTokens, 920_000)

  on('session.start', async ($, e, next) => next(e))
}
