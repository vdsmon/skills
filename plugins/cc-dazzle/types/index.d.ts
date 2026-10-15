/** A prompt the user sent, keyed by its folded text. */
export type Sent = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'cc-dazzle': {
      unfolded: string[]
      sent: Sent[]
      queued: string[]
      drawn: StateFamily<number>
      took: StateFamily<number>
      /** Per paragraph of a reply drawn by a stretch Client: the keys of the stretches open in it. */
      stretchOpen: StateFamily<string[]>
      /** Short forms of the stretches the reader opened since their last prompt. */
      stretchSeen: string[]
      /** Per reply: the count each open stretch was opened at, which picks its colour, and the next count. */
      stretchOrder: StateFamily<{ order: Record<string, number>; count: number }>
      /** The request id of the reply in which a stretch was opened last, until the next prompt. */
      stretchNewest: string
    }
  }
}
