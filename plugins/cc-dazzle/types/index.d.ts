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
    }
  }
}
