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
      /**
       * Per paragraph of a reply drawn by a stretch Client: the stretch the reader last asked to open
       * or close from the keyboard, numbered so each ask acts once; null before any.
       */
      stretchAsk: StateFamily<{ key: string; action: 'open' | 'close'; n: number } | null>
      /**
       * While letters show, until the next edit or other change to the prompt, a submitted prompt or
       * their chord again: whether they open or close, and each one's stretch, by paragraph member
       * and stretch key; null while none show.
       */
      stretchLetters: { action: 'open' | 'close'; targets: { letter: string; member: string; key: string }[] } | null
    }
  }
}
