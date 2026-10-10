/** How long a call ran, in ms. */
export type Took = number

declare module 'claude-code' {
  interface PluginState {
    'cc-rich-rows': {
      /** How long each Bash or MCP call ran, by its tool_use_id. */
      took: StateFamily<Took>
    }
  }
}
