/** A read-only check: an MCP tool call, or a command run as argv. */
export type Probe =
  | { kind: 'mcp'; server: string; tool: string; args: Record<string, unknown> }
  | { kind: 'argv'; argv: string[] }

export type Status = 'running' | 'done' | 'failed' | 'needs_you'

/** One watch, kept in $.store under the session id. */
export type Watch = {
  name: string
  probe: Probe
  goal: string
  onWake: string
  everyMs: number
  /** 0 = never flag the job as stuck. */
  stuckAfterMs: number
  createdAt: number
  nextAt: number
  /** Hash of the last output a judgment was made on. */
  lastHash: string
  lastChangeAt: number
  line: string
  /** Checks in a row that failed to run. */
  errors: number
  /** Changed outputs in a row the small model could not judge. */
  judgeErrors: number
}
