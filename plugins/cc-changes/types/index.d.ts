export type FileStatus = 'added' | 'modified' | 'deleted'

/** One file this session changed, against the text it held when the session first changed it. */
export type FileChange = {
  /** Absolute. */
  path: string
  status: FileStatus
  /** Lines added and removed in all; null when the file could not be read or diffed. */
  added: number | null
  removed: number | null
  /** Epoch ms of the last change. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'cc-changes': {
      files: FileChange[]
      /** The text a file held before this session first changed it, by `<epoch>:<path>`; null for a file the session created. */
      original: StateFamily<string | null>
      /** The file whose diff the pane shows; null for the list. */
      selected: string | null
      isOpen: boolean
      /** Bumped by /clear, so originals from before it are not used again. */
      epoch: number
    }
  }
}
