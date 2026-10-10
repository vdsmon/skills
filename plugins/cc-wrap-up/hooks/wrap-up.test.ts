import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const KEPT = [{ role: 'user' as const, text: 'summary', toolUses: [] }]

// The engine beneath the plugin: a session whose context size, git status and
// command list the test picks, and a record of every call the mod makes.
function world(on: On) {
  const seen = {
    tokens: 0 as number | undefined,
    isDirty: false,
    commands: ['prep-compact:prep-compact', 'prep-exit:prep-exit', 'compact', 'clear'],
    gitRuns: 0,
    notified: 0,
    toasts: [] as string[],
    compactions: [] as { trigger: string; instructions?: string }[],
    submits: [] as { text: string; asUser?: boolean }[],
    ran: [] as { command: string; args: string }[],
    fills: [] as string[],
    copies: [] as string[],
    sends: [] as { to: string; text: string }[],
    isCopyRefused: false,
    isCompactSkipped: false,
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__cc-wrap-up__${e.name}` } }))
  on('command.list', async () => ({
    value: seen.commands.map(name => ({ name, description: name, source: 'builtin' as const })),
  }))
  on('session.usage', async () => ({
    value: { startedAt: 0, context: { tokens: seen.tokens, window: 1_000_000 }, rateLimits: [] },
  }))
  on('process.run', async () => {
    seen.gitRuns += 1
    const stdout = seen.isDirty ? ' M src/a.ts\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.notify', async () => {
    seen.notified += 1
    return { value: { isSent: true as const, channel: 'terminal_bell' as const } }
  })
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
  on('classic.PreToolUse', async () => ({}))
  on('tool.call', async (_$, e) =>
    e.tool === 'Bash' && e.command.includes('fail')
      ? { isError: true as const, result: 'nothing to commit', text: 'nothing to commit' }
      : { result: { stdout: '', stderr: '', interrupted: false } },
  )
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('session.compact', async (_$, e) => {
    seen.compactions.push({ trigger: e.trigger, instructions: e.instructions })
    return seen.isCompactSkipped ? { skip: 'a hook said no' } : { messages: KEPT }
  })
  on('prompt.submit', async (_$, e) => {
    seen.submits.push({ text: e.text, asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined })
    return { text: e.text }
  })
  on('command.run', async (_$, e) => {
    seen.ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('prompt.fill', async (_$, e) => {
    seen.fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.copy', async (_$, e) => {
    seen.copies.push(e.text)
    return { value: seen.isCopyRefused ? { isCopied: false as const, reason: 'no-clipboard' as const } : { isCopied: true as const } }
  })
  on('session.send', async (_$, e) => {
    seen.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true as const }
  })
  return seen
}

async function start($: Engine, isInteractive = true) {
  await $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
}

function band($: Engine) {
  return $.ui.mount({ plugin: 'cc-wrap-up', surface: 'terminal', component: 'AbovePrompt', props: BAND })
}

let toolUses = 0

// One main-thread turn that ends with the context at `tokens`.
async function turn(
  $: Engine,
  seen: ReturnType<typeof world>,
  tokens: number | undefined,
  opts: { commit?: 'ok' | 'fail'; agentId?: string; reason?: 'answer' | 'aborted' } = {},
) {
  seen.tokens = tokens
  if (opts.commit) {
    toolUses += 1
    const command = opts.commit === 'ok' ? 'git commit -m "wip"' : 'git commit -m fail'
    await $.tool.call({ tool: 'Bash', tool_use_id: `toolu_${toolUses}`, command })
  }
  const reason = opts.reason ?? 'answer'
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: `turn_${toolUses}`,
    agentId: opts.agentId,
    reason,
  })
}

async function lineText(ui: Awaited<ReturnType<typeof band>>) {
  return (await ui.find({ type: 'Text' }))?.text
}

async function buttons(ui: Awaited<ReturnType<typeof band>>) {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key)
}

test('below the start line the band stays empty and git is not asked', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 400_000)
  expect(await buttons(ui)).toEqual([])
  expect(seen.gitRuns).toBe(0)
})

test('past the line with no seam, the mod waits and asks git once per turn', async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect(await buttons(ui)).toEqual([])
  expect(seen.gitRuns).toBe(1)
})

test('a commit in the turn is a seam, and git is not asked', async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000, { commit: 'ok' })
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
  expect(await lineText(ui)).toContain('520k')
  expect(seen.gitRuns).toBe(0)
})

test('a failed commit is no seam', async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000, { commit: 'fail' })
  expect(await buttons(ui)).toEqual([])
})

test('a clean tree is a seam', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})

test('with no seam inside a step, the cue shows anyway', async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  await turn($, seen, 590_000)
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 600_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})

test('Later moves the line one step past the current size', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 530_000)
  await ui.press({ key: 'later' })
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 600_000)
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 630_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})

test('urgent shows without a seam and notifies once per crossing', async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 930_000)
  expect(await lineText(ui)).toContain('auto-compact')
  expect(seen.notified).toBe(1)
  await ui.press({ key: 'later' })
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 940_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
  expect(seen.notified).toBe(1)
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  await turn($, seen, 100_000)
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 930_000)
  expect(seen.notified).toBe(2)
})

test('a compaction clears the cue and puts the line back at the start', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 530_000)
  await ui.press({ key: 'later' })
  await $.session.compact({ trigger: 'manual', messages: KEPT })
  await turn($, seen, 510_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
  await $.session.compact({ trigger: 'manual', messages: KEPT })
  expect(await buttons(ui)).toEqual([])
})

test('subagent, aborted and token-less turns do not count', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 600_000, { agentId: 'agent_1' })
  await turn($, seen, 600_000, { reason: 'aborted' })
  await turn($, seen, undefined)
  expect(await buttons(ui)).toEqual([])
  expect(seen.gitRuns).toBe(0)
})

test('a non-interactive session never cues', async ($, on) => {
  const seen = world(on)
  await start($, false)
  const ui = await band($)
  await turn($, seen, 930_000)
  expect(await buttons(ui)).toEqual([])
  expect(seen.notified).toBe(0)
})

test('the settings move the lines', { options: { startTokens: 100_000, stepTokens: 10_000, urgentTokens: 200_000 } }, async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 105_000)
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 110_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})
