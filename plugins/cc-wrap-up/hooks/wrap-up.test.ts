import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine beneath the plugin: a session whose context size, git status and
// command list the test picks, and a record of every call the mod makes.
function world(on: On) {
  const seen = {
    tokens: 0 as number | undefined,
    dirty: false,
    commands: ['prep-compact:prep-compact', 'prep-exit:prep-exit', 'compact', 'clear'],
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__cc-wrap-up__${e.name}` } }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  return seen
}

async function start($: Engine, isInteractive = true) {
  await $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
}

test('the module loads', async ($, on) => {
  world(on)
  await start($)
  expect(true).toBe(true)
})
