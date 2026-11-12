/** A read-only check: an MCP tool call, or a command run as argv. */
export type Probe =
  | { kind: 'mcp'; server: string; tool: string; args: Record<string, unknown> }
  | { kind: 'argv'; argv: string[] }

export type Status = 'running' | 'done' | 'failed' | 'needs_you'

/** A tracker's verdict on changed output. */
export type News = 'quiet' | 'tell'

/** One watch, kept in $.store under the session id. */
export type Watch = {
  name: string
  probe: Probe
  goal: string
  onWake: string
  /** A tracker: wakes on news and keeps running until the user stops it. */
  keep: boolean
  everyMs: number
  /** 0 = never flag the job as stuck; always 0 for a tracker. */
  stuckAfterMs: number
  createdAt: number
  nextAt: number
  /** Hash of the last output a judgment was made on. */
  lastHash: string
  /** Tracker only: that output as captured, so the judge sees what is new. */
  prev?: string
  lastChangeAt: number
  line: string
  /** Checks in a row that failed to run. */
  errors: number
  /** Changed outputs in a row the small model could not judge. */
  judgeErrors: number
}
