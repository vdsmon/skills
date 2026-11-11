/** Where the wrap-up flow stands in this session. */
export type Phase = 'idle' | 'armed' | 'cue' | 'urgent' | 'prepping' | 'ready-compact' | 'ready-handoff'

export type PrepKind = 'compact' | 'handoff'

/** What better-compact or handoff handed over through the `ready` tool. */
export type Payload =
  /** `now`: compact when the turn ends, with no press. */
  | { kind: 'compact'; message: string; followUp: string; openQuestion: boolean; now: boolean }
  | { kind: 'handoff'; resumePrompt: string; handoffPath: string; openQuestion: boolean }

export type Wrap = {
  phase: Phase
  /** Where the mod watches for a seam from; null means the start line. */
  line: number | null
  /** Context tokens after the last answered main-thread turn. */
  tokens: number | null
  payload: Payload | null
  /** Which skill the band started, while it runs. */
  prepKind: PrepKind | null
  isOff: boolean
  /** The urgent notification of the current crossing went out. */
  isNotified: boolean
  /**
   * The automatic wrap-up of the current crossing of the auto line: `running` from
   * the stopped turn until its prep ends, `spent` from there, or from a compaction,
   * until the context is seen under the line.
   */
  auto: 'idle' | 'running' | 'spent'
}

declare module 'claude-code' {
  interface PluginState {
    'cc-wrap-up': {
      wrap: Wrap
    }
  }
}
