export type Stats = {
  /** Forks that asked for a name. */
  checks: number
  /** Names applied to the session. */
  renames: number
  /** Forks that failed or gave a reply that is not a name. */
  failures: number
}

/** One session's naming state; `lastSet` and `pinned` are also kept in the store. */
export type State = {
  /** The session the state belongs to; a new id (a resume, a /clear) loads its own. */
  sessionId: string | null
  /** Main-thread turns answered since the state was loaded. */
  turns: number
  /** The turn at which the next check is due; null when no check is planned. */
  nextAt: number | null
  /** A compaction happened since the last check. */
  compacted: boolean
  /** A picked name that waits for the next prompt. */
  pending: string | null
  /** Pin the session once `pending` lands (the /autotitle fallback). */
  pinOnApply: boolean
  /** Take the next prompt's name as `lastSet` instead of pinning it (after /autotitle on). */
  adopt: boolean
  /** The last name this plugin gave the session. */
  lastSet: string | null
  /** The session's name as the last prompt saw it. */
  lastSeen: string | null
  /** Someone else named the session: no more automatic names. */
  pinned: boolean
  /** Failed checks in a row. */
  failures: number
  isOff: boolean
  stats: Stats
}

/** What the store keeps per session, under `s:<session id>`. */
export type Saved = {
  lastSet: string | null
  pinned: boolean
  /** When it was written, for pruning. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'cc-autotitle': {
      state: State
    }
  }
}
