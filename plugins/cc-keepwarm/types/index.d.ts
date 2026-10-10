/** The last request that touched the main thread's cached prefix. */
export type Anchor = {
  /** When that request started: a main-thread request or a ping. */
  at: number
  /** When the last main-thread request started; pings never move it. */
  lastRequestAt: number
  /** Prompt tokens that request sent, the prefix a ping should find cached. */
  prefix: number
  /** Pings in a row that found the cache gone and wrote it again. */
  rewrites: number
}

export type Stats = {
  pings: number
  /** Cached tokens the pings read. */
  read: number
  /** Tokens the pings generated, thinking included. */
  output: number
  /** Pings that found the cache gone and wrote it again. */
  rewrites: number
  /** Pings skipped because the cache was already past its lifetime. */
  holds: number
  failures: number
}

/** Why no ping is planned. */
export type Halt = 'cold' | 'idle' | 'expiring' | 'cleared' | 'compacted' | 'switched' | null

declare module 'claude-code' {
  interface PluginState {
    'cc-keepwarm': {
      anchor: Anchor | null
      halt: Halt
      stats: Stats
      isOff: boolean
    }
  }
}
