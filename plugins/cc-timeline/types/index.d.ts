/** One tool call, timed by the mod around the tool's own run. */
export type Call = {
  id: string
  tool: string
  /** A short form of the input: a file name, a command, a pattern. */
  label: string
  /** The loop it ran in: absent on the main loop. */
  agentId?: string
  /** The Agent call that started that loop, when the mod could tell. */
  parentId?: string
  /** For an Agent call: the description, to match the subagent's loop to it. */
  description?: string
  start: number
  /** Null while it runs. */
  end: number | null
  isError: boolean
}

export type Turn = {
  id: string
  /** 1 for the session's first turn. */
  n: number
  prompt: string
  start: number
  /** Null while it runs. */
  end: number | null
  calls: Call[]
}

declare module 'claude-code' {
  interface PluginState {
    'cc-timeline': {
      /** The last turns, oldest first. */
      turns: Turn[]
      /** The turn the pane shows, by id; null for the latest. */
      selected: string | null
      /** The time a running bar is drawn to; a 1 s tick moves it while a call runs. */
      now: number
      isOpen: boolean
    }
  }
}
