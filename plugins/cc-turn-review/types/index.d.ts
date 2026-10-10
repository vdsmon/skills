export type ReviewStatus = 'running' | 'findings' | 'clean' | 'failed'

/** The last turn's review. */
export type Review = {
  id: string
  status: ReviewStatus
  /** Changed files, as `~/repo/path`. */
  files: string[]
  changedLines: number
  findings: string[]
  inputTokens: number
  outputTokens: number
  error: string
  /** Epoch ms when the review started. */
  at: number
  /** The band no longer shows it: dismissed, fixed, or the user moved on. */
  isDismissed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cc-turn-review': {
      review: Review | null
      isOff: boolean
    }
  }
}
