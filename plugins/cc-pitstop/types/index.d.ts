export type WindowKind = 'five_hour' | 'seven_day'

/** One rate-limit window as last reported. */
export type Window = { kind: WindowKind; pct: number; resetsAt: number }

/** The freshest reading any session on the machine took, kept in $.store. */
export type Reading = { at: number; windows: Window[] }

/** The park in force for every session, kept in $.store until its window resets. */
export type Park = { kind: WindowKind; pct: number; resetsAt: number; at: number }

/** How this session handles the current park. */
export type Seen = {
  resetsAt: number
  /** Requests left: 'main' for the main thread, 'subagents' shared by every subagent. */
  grace: Record<string, number>
  /** Loops (agent ids, 'main') that already got the stop note. */
  noted: string[]
  /** A request was refused, so work was cut off and the reset should resume it. */
  interrupted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'cc-pitstop': {
      /** Per window kind, the reset time of the window already warned about. */
      warned: Record<string, number>
      seen: Seen | null
      /** /pitstop go lifts parks whose window resets at or before this time. */
      overrideUntil: number
      isOff: boolean
    }
  }
}
