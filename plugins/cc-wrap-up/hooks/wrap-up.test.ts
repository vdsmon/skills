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
    registered: [] as { name: string; isDeferred: unknown }[],
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => {
    seen.registered.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__cc-wrap-up__${e.name}` } }
  })
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

const COMPACT = {
  kind: 'compact',
  message: 'Hotfix for the 503 on hotfix/rate-limit. Fix committed as 4e1a9c2.\nSkip the repro.',
  followUp: 'Add the regression test for the backoff in src/limiter.ts.',
  openQuestion: false,
}

const HANDOFF = {
  kind: 'handoff',
  resumePrompt: 'Resume from /repo/.git/handoff/HANDOFF.md: the 503 fix is committed. First: add the regression test.',
  handoffPath: '/repo/.git/handoff/HANDOFF.md',
  openQuestion: false,
}

function ready($: Engine, input: Record<string, unknown>) {
  toolUses += 1
  return $.tool.call({ tool: 'mcp__cc-wrap-up__ready', tool_use_id: `toolu_${toolUses}`, ...input })
}

function typed($: Engine, command: string, args = '') {
  return $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

function said($: Engine, text: string, kind: 'composer' | 'bridge' = 'composer') {
  return $.prompt.submit({ text, wait: false, origin: { kind } })
}

async function texts(ui: Awaited<ReturnType<typeof band>>) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
}

test('the ready tool is registered deferred at session start', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.registered).toEqual([{ name: 'ready', isDeferred: true }])
})

test('a compact payload opens the band with the message and its buttons', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  const r = await ready($, COMPACT)
  expect(r.isError).toBeUndefined()
  expect(await lineText(ui)).toContain('Hotfix for the 503')
  expect(await texts(ui)).not.toContain('Skip the repro')
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('a handoff payload opens the band with the path and its buttons', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  await ready($, HANDOFF)
  expect(await lineText(ui)).toContain('Handoff at /repo/.git/handoff/HANDOFF.md')
  expect(await buttons(ui)).toEqual(['fresh', 'copy', 'done'])
})

test('a payload with an open question says so', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  await ready($, { ...COMPACT, openQuestion: true })
  expect(await texts(ui)).toContain('question still open')
})

test('a payload with a missing field is refused by name and changes nothing', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  const r = await ready($, { kind: 'compact', message: 'only the message' })
  expect(r.deny).toContain('followUp')
  const h = await ready($, { kind: 'handoff', resumePrompt: 'go' })
  expect(h.deny).toContain('handoffPath')
  expect(await buttons(ui)).toEqual([])
})

test('a prep the user typed shows as preparing, and one that hands nothing over says so', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await typed($, 'prep-compact:prep-compact')
  expect(await lineText(ui)).toContain('Preparing to compact')
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 300_000)
  expect(seen.toasts.join('\n')).toContain('use the printed blocks')
  expect(await lineText(ui)).toBeUndefined()
})

test('a prep that hands over its result leaves the band ready after its turn', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await typed($, 'prep-exit:prep-exit')
  expect(await lineText(ui)).toContain('Preparing the handoff')
  await ready($, HANDOFF)
  await turn($, seen, 700_000)
  expect(await buttons(ui)).toEqual(['fresh', 'copy', 'done'])
  expect(seen.toasts).toEqual([])
})

test('the next prompt of the user drops a payload, and a slash command does not', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await typed($, 'help')
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
  await said($, 'actually, one more thing', 'bridge')
  expect(await buttons(ui)).toEqual([])
})

test('with an open question, the answer keeps the payload and the next prompt drops it', async ($, on) => {
  world(on)
  await start($)
  const ui = await band($)
  await ready($, { ...COMPACT, openQuestion: true })
  await said($, 'yes, commit the env example too')
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
  expect(await texts(ui)).not.toContain('question still open')
  await said($, 'and now something else')
  expect(await buttons(ui)).toEqual([])
})

test('Compact runs prep-compact and shows the prep as running', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  await ui.press({ key: 'compact' })
  expect(seen.ran).toEqual([{ command: 'prep-compact:prep-compact', args: '' }])
  expect(await lineText(ui)).toContain('Preparing to compact')
})

test('without prep-compact installed, Compact compacts at once with no message', async ($, on) => {
  const seen = world(on)
  seen.commands = ['compact', 'clear']
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect((await ui.find({ key: 'compact' }))?.text).toContain('Compact now')
  expect(await buttons(ui)).toEqual(['compact', 'later'])
  await ui.press({ key: 'compact' })
  expect(seen.ran).toEqual([])
  expect(seen.compactions.map(c => c.instructions)).toEqual([undefined])
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual([])
})

test('Compact now compacts with the message, then sends the follow-up as the user', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await ui.press({ key: 'compact-now' })
  expect(seen.compactions.map(c => c.instructions)).toEqual([COMPACT.message])
  expect(seen.submits).toEqual([{ text: COMPACT.followUp, asUser: true }])
  expect(await buttons(ui)).toEqual([])
})

test('a skipped compaction keeps the band and sends nothing', async ($, on) => {
  const seen = world(on)
  seen.isCompactSkipped = true
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await ui.press({ key: 'compact-now' })
  expect(seen.toasts.join('\n')).toContain('a hook said no')
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('Edit puts /compact with the message in the prompt box and keeps the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await ui.press({ key: 'edit' })
  expect(seen.fills).toEqual([`/compact ${COMPACT.message}`])
  expect(seen.compactions).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('Not now closes the band and drops the message', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await ui.press({ key: 'not-now' })
  expect(await buttons(ui)).toEqual([])
  expect(seen.compactions).toEqual([])
})

test('while a turn runs, the band offers nothing but a running prep', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, seen, 520_000)
  const working = await $.ui.mount({
    plugin: 'cc-wrap-up',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND, isWorking: true },
  })
  expect(await buttons(working)).toEqual([])
  await typed($, 'prep-compact:prep-compact')
  expect(await lineText(working)).toContain('Preparing to compact')
})
