import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
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

// The test's clock: the band starts long work from a timer, so a press settles it.
let clock: MockClock

// The engine beneath the plugin: a session whose context size, git status and
// command list the test picks, and a record of every call the mod makes.
function world(on: On) {
  clock = mock.clock(on, { now: 0 })
  const seen = {
    tokens: 0 as number | undefined,
    isDirty: false,
    commands: ['better-compact:better-compact', 'handoff:handoff', 'compact', 'clear'],
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
    isRunRefused: false,
    registered: [] as { name: string; isDeferred: unknown }[],
    order: [] as string[],
    slash: [] as string[],
    aborts: [] as string[],
  }
  on('turn.abort', async (_$, e) => {
    seen.aborts.push(e.turnId)
    return { value: undefined }
  })
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async (_$, e) => {
    seen.slash.push(e.name)
    return { value: { command: e.name } }
  })
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
    seen.order.push('submit')
    return { text: e.text }
  })
  on('command.run', async (_$, e) => {
    seen.ran.push({ command: e.command, args: e.args })
    seen.order.push(`run ${e.command}`)
    if (seen.isRunRefused) throw new Error('a turn is running')
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
  opts: { commit?: 'ok' | 'fail'; agentId?: string; reason?: 'answer' | 'aborted'; turnId?: string } = {},
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
    turnId: opts.turnId ?? `turn_${toolUses}`,
    agentId: opts.agentId,
    reason,
  })
}

const LIVE = 'turn_live'

// One model request inside the running main-thread turn, with the context at `tokens`.
async function step($: Engine, seen: ReturnType<typeof world>, tokens: number | undefined, agentId?: string) {
  seen.tokens = tokens
  let isDone = false
  const done = (async () => {
    for await (const _ of $.turn.step({ turnId: LIVE, index: 1, model: 'claude-opus-5-5', messageCount: 3, agentId }));
    isDone = true
  })()
  // The mod holds the request until its abort timer has run.
  for (let i = 0; i < 100 && !isDone; i++) await clock.settle()
  await done
}

// The turn the mod stopped ends, and the prep it starts from a timer runs.
async function stopped($: Engine, seen: ReturnType<typeof world>, tokens: number) {
  await turn($, seen, tokens, { reason: 'aborted', turnId: LIVE })
  await clock.settle()
}

async function press(ui: Awaited<ReturnType<typeof band>>, key: string) {
  await ui.press({ key })
  await clock.settle()
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
  await press(ui, 'later')
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
  await turn($, seen, 760_000)
  expect(await lineText(ui)).toContain('better-compact runs by itself at 800k')
  expect(seen.notified).toBe(1)
  await press(ui, 'later')
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 770_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
  expect(seen.notified).toBe(1)
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  await turn($, seen, 100_000)
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 760_000)
  expect(seen.notified).toBe(2)
})

test('with the automatic wrap-up off, urgent warns of auto-compaction', { options: { autoTokens: 0 } }, async ($, on) => {
  const seen = world(on)
  seen.isDirty = true
  await start($)
  const ui = await band($)
  await turn($, seen, 930_000)
  expect(await lineText(ui)).toContain('auto-compact runs at 967k')
})

test('a compaction clears the cue and puts the line back at the start', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 530_000)
  await press(ui, 'later')
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
  await typed($, 'better-compact:better-compact')
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
  await typed($, 'handoff:handoff')
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

test('Compact runs better-compact and shows the prep as running', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  await press(ui, 'compact')
  expect(seen.ran).toEqual([{ command: 'better-compact:better-compact', args: '' }])
  expect(await lineText(ui)).toContain('Preparing to compact')
})

test('without better-compact installed, Compact compacts at once with no message', async ($, on) => {
  const seen = world(on)
  seen.commands = ['compact', 'clear']
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect((await ui.find({ key: 'compact' }))?.text).toContain('Compact now')
  expect(await buttons(ui)).toEqual(['compact', 'later'])
  await press(ui, 'compact')
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
  await press(ui, 'compact-now')
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
  await press(ui, 'compact-now')
  expect(seen.toasts.join('\n')).toContain('a hook said no')
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('a payload with now compacts when the turn ends, then sends the follow-up, with no press', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  const r = await ready($, { ...COMPACT, now: true })
  expect(String(r.result)).toContain('compacts with this message when your turn ends')
  expect(seen.compactions).toEqual([])
  await turn($, seen, 700_000)
  await clock.settle()
  expect(seen.compactions.map(c => c.instructions)).toEqual([COMPACT.message])
  expect(seen.submits).toEqual([{ text: COMPACT.followUp, asUser: true }])
  expect(await buttons(ui)).toEqual([])
})

test('now with an open question waits for a press', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  const r = await ready($, { ...COMPACT, now: true, openQuestion: true })
  expect(String(r.result)).toContain('Print your usual blocks')
  await turn($, seen, 700_000)
  await clock.settle()
  expect(seen.compactions).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('now on an aborted turn waits for a press', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, { ...COMPACT, now: true })
  await turn($, seen, 700_000, { reason: 'aborted' })
  await clock.settle()
  expect(seen.compactions).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('a prompt the user sends before the compaction starts calls it off', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, { ...COMPACT, now: true })
  await turn($, seen, 700_000)
  await said($, 'wait, one more thing')
  await clock.settle()
  expect(seen.compactions).toEqual([])
  expect(seen.submits.map(s => s.text)).toEqual(['wait, one more thing'])
  expect(await buttons(ui)).toEqual([])
})

test('a skipped compaction with now keeps the band and sends nothing', async ($, on) => {
  const seen = world(on)
  seen.isCompactSkipped = true
  await start($)
  const ui = await band($)
  await ready($, { ...COMPACT, now: true })
  await turn($, seen, 700_000)
  await clock.settle()
  expect(seen.toasts.join('\n')).toContain('a hook said no')
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('Edit puts /compact with the message in the prompt box and keeps the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await press(ui, 'edit')
  expect(seen.fills).toEqual([`/compact ${COMPACT.message}`])
  expect(seen.compactions).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('Not now closes the band and drops the message', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await press(ui, 'not-now')
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
  await typed($, 'better-compact:better-compact')
  expect(await lineText(working)).toContain('Preparing to compact')
})

test('Hand off runs handoff and shows the prep as running', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  await press(ui, 'handoff')
  expect(seen.ran).toEqual([{ command: 'handoff:handoff', args: '' }])
  expect(await lineText(ui)).toContain('Preparing the handoff')
})

test('without handoff installed, there is no Hand off button', async ($, on) => {
  const seen = world(on)
  seen.commands = ['better-compact:better-compact', 'compact', 'clear']
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect(await buttons(ui)).toEqual(['compact', 'later'])
})

test('Fresh session here clears, then sends the resume prompt as the first message', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, HANDOFF)
  await press(ui, 'fresh')
  expect(seen.order).toEqual(['run clear', 'submit'])
  expect(seen.submits).toEqual([{ text: HANDOFF.resumePrompt, asUser: true }])
  expect(await buttons(ui)).toEqual([])
})

test('Copy prompt copies the resume prompt and keeps the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, HANDOFF)
  await press(ui, 'copy')
  expect(seen.copies).toEqual([HANDOFF.resumePrompt])
  expect(seen.toasts.join('\n')).toContain('Copied')
  expect(await buttons(ui)).toEqual(['fresh', 'copy', 'done'])
})

test('a refused copy says why and keeps the band', async ($, on) => {
  const seen = world(on)
  seen.isCopyRefused = true
  await start($)
  const ui = await band($)
  await ready($, HANDOFF)
  await press(ui, 'copy')
  expect(seen.toasts.join('\n')).toContain('no-clipboard')
  expect(await buttons(ui)).toEqual(['fresh', 'copy', 'done'])
})

test('Done closes the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, HANDOFF)
  await press(ui, 'done')
  expect(await buttons(ui)).toEqual([])
  expect(seen.submits).toEqual([])
})

test("the user's bare /compact gets the pending message, then the follow-up is sent", async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await $.session.compact({ trigger: 'manual', messages: KEPT })
  expect(seen.compactions).toEqual([{ trigger: 'manual', instructions: COMPACT.message }])
  expect(seen.submits).toEqual([{ text: COMPACT.followUp, asUser: true }])
  expect(await buttons(ui)).toEqual([])
})

test("the user's own /compact text is kept, and the follow-up still goes", async ($, on) => {
  const seen = world(on)
  await start($)
  await ready($, COMPACT)
  await $.session.compact({ trigger: 'manual', instructions: 'my own words', messages: KEPT })
  expect(seen.compactions).toEqual([{ trigger: 'manual', instructions: 'my own words' }])
  expect(seen.submits).toEqual([{ text: COMPACT.followUp, asUser: true }])
})

test('a skipped /compact sends no follow-up and keeps the band', async ($, on) => {
  const seen = world(on)
  seen.isCompactSkipped = true
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await $.session.compact({ trigger: 'manual', messages: KEPT })
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('an auto compaction gets the pending message and sends nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  expect(seen.compactions).toEqual([{ trigger: 'auto', instructions: COMPACT.message }])
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual([])
})

test('an auto compaction with nothing pending passes unchanged', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  expect(seen.compactions).toEqual([{ trigger: 'auto', instructions: undefined }])
})

test('past the auto line inside a turn, the turn stops and better-compact runs unattended, then compacts', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await step($, seen, 799_000)
  expect(seen.aborts).toEqual([])
  await step($, seen, 805_000)
  expect(seen.aborts).toEqual([LIVE])
  expect(seen.ran).toEqual([])
  await stopped($, seen, 805_000)
  expect(seen.toasts.join('\n')).toContain('Stopped the turn to run better-compact')
  expect(seen.ran).toEqual([{ command: 'better-compact:better-compact', args: '--unattended' }])
  expect(await lineText(ui)).toContain('Preparing to compact')
  await ready($, { ...COMPACT, now: true })
  await turn($, seen, 830_000)
  await clock.settle()
  expect(seen.compactions.map(c => c.instructions)).toEqual([COMPACT.message])
  expect(seen.submits).toEqual([{ text: COMPACT.followUp, asUser: true }])
  // A compaction that leaves the context over the line does not stop the next turn;
  // the next crossing from under it does.
  await step($, seen, 806_000)
  expect(seen.aborts).toEqual([LIVE])
  await step($, seen, 100_000)
  await step($, seen, 806_000)
  expect(seen.aborts).toEqual([LIVE, LIVE])
})

test('the automatic wrap-up leaves subagents, a session with no size yet, a pending prep and an off session alone', async ($, on) => {
  const seen = world(on)
  await start($)
  await step($, seen, 950_000, 'agent_1')
  await step($, seen, undefined)
  await ready($, COMPACT)
  await step($, seen, 950_000)
  await press(await band($), 'not-now')
  await typed($, 'wrap-up', 'off')
  await step($, seen, 950_000)
  expect(seen.aborts).toEqual([])
  await typed($, 'wrap-up', 'on')
  await step($, seen, 950_000)
  expect(seen.aborts).toEqual([LIVE])
})

test('a non-interactive session never stops a turn', async ($, on) => {
  const seen = world(on)
  await start($, false)
  await step($, seen, 950_000)
  expect(seen.aborts).toEqual([])
})

test('without better-compact installed, no turn is stopped', async ($, on) => {
  const seen = world(on)
  seen.commands = ['compact', 'clear']
  await start($)
  await step($, seen, 950_000)
  expect(seen.aborts).toEqual([])
})

test('autoTokens moves the auto line, and 0 turns it off', { options: { autoTokens: 50_000 } }, async ($, on) => {
  const seen = world(on)
  await start($)
  await step($, seen, 49_000)
  expect(seen.aborts).toEqual([])
  await step($, seen, 51_000)
  expect(seen.aborts).toEqual([LIVE])
})

test('autoTokens 0 never stops a turn', { options: { autoTokens: 0 } }, async ($, on) => {
  const seen = world(on)
  await start($)
  await step($, seen, 990_000)
  expect(seen.aborts).toEqual([])
})

test('an automatic prep that hands nothing over sends the task on, and is not tried again', async ($, on) => {
  const seen = world(on)
  await start($)
  await step($, seen, 905_000)
  await stopped($, seen, 905_000)
  await turn($, seen, 910_000)
  expect(seen.toasts.join('\n')).toContain('use the printed blocks')
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0]?.text).toContain('Carry on with the task')
  expect(seen.submits[0]?.asUser).toBeUndefined()
  await step($, seen, 915_000)
  expect(seen.aborts).toEqual([LIVE])
})

test('an automatic prep that does not start sends the task on', async ($, on) => {
  const seen = world(on)
  seen.isRunRefused = true
  await start($)
  await step($, seen, 905_000)
  await stopped($, seen, 905_000)
  expect(seen.toasts.join('\n')).toContain('did not start')
  expect(seen.submits.map(s => s.text)).toEqual([expect.stringContaining('Carry on with the task')])
})

test('an automatic wrap-up whose compaction is skipped sends the task on, and a later auto-compaction gets the message', async ($, on) => {
  const seen = world(on)
  seen.isCompactSkipped = true
  await start($)
  await step($, seen, 905_000)
  await stopped($, seen, 905_000)
  await ready($, { ...COMPACT, now: true })
  await turn($, seen, 930_000)
  await clock.settle()
  expect(seen.toasts.join('\n')).toContain('a hook said no')
  expect(seen.submits.map(s => s.text)).toEqual([expect.stringContaining('Carry on with the task')])
  await step($, seen, 940_000)
  expect(seen.aborts).toEqual([LIVE])
  seen.isCompactSkipped = false
  await $.session.compact({ trigger: 'auto', messages: KEPT })
  expect(seen.compactions.at(-1)).toEqual({ trigger: 'auto', instructions: COMPACT.message })
})

test('an automatic prep the user interrupts sends nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  await step($, seen, 905_000)
  await stopped($, seen, 905_000)
  await turn($, seen, 910_000, { reason: 'aborted' })
  expect(seen.submits).toEqual([])
})

test('an automatic prep that ends on a question notifies and waits for a press', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await step($, seen, 905_000)
  await stopped($, seen, 905_000)
  await ready($, { ...COMPACT, openQuestion: true })
  await turn($, seen, 910_000)
  await clock.settle()
  expect(seen.notified).toBe(1)
  expect(seen.compactions).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
  await step($, seen, 915_000)
  expect(seen.aborts).toEqual([LIVE])
})

test('a precompute is skipped while a prep result is pending, and runs otherwise', async ($, on) => {
  const seen = world(on)
  await start($)
  const idle = await $.session.compact({ trigger: 'precompute', messages: KEPT })
  expect(idle.skip).toBeUndefined()
  await ready($, COMPACT)
  const pending = await $.session.compact({ trigger: 'precompute', messages: KEPT })
  expect(pending.skip).toContain('cc-wrap-up')
  expect(seen.compactions).toEqual([{ trigger: 'precompute', instructions: undefined }])
})

test("a subagent's compaction is left alone", async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await ready($, COMPACT)
  await $.session.compact({ trigger: 'auto', agentId: 'agent_1', messages: KEPT })
  expect(seen.submits).toEqual([])
  expect(await buttons(ui)).toEqual(['compact-now', 'edit', 'not-now'])
})

test('/wrap-up is registered at session start', async ($, on) => {
  const seen = world(on)
  await start($)
  expect(seen.slash).toEqual(['wrap-up'])
})

test('/wrap-up opens the band at any size, even when the cue is off', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 300_000)
  await typed($, 'wrap-up', 'off')
  const r = await typed($, 'wrap-up')
  expect(r.text).toContain('wrap-up band')
  expect(await lineText(ui)).toContain('300k tokens')
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})

test('/wrap-up off stops the cue and hides it, and /wrap-up on resumes it', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, seen, 520_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
  const off = await typed($, 'wrap-up', 'off')
  expect(off.text).toContain('off')
  expect(await buttons(ui)).toEqual([])
  await turn($, seen, 700_000)
  expect(await buttons(ui)).toEqual([])
  await typed($, 'wrap-up', 'on')
  await turn($, seen, 710_000)
  expect(await buttons(ui)).toEqual(['compact', 'handoff', 'later'])
})

test('/wrap-up send hands the resume prompt to another session', async ($, on) => {
  const seen = world(on)
  await start($)
  await ready($, HANDOFF)
  const r = await typed($, 'wrap-up', 'send peer-1')
  expect(seen.sends).toEqual([{ to: 'peer-1', text: HANDOFF.resumePrompt }])
  expect(r.text).toContain('peer-1')
})

test('/wrap-up send without a handoff or a name sends nothing and says why', async ($, on) => {
  const seen = world(on)
  await start($)
  const none = await typed($, 'wrap-up', 'send peer-1')
  expect(none.text).toContain('No handoff')
  await ready($, HANDOFF)
  const noName = await typed($, 'wrap-up', 'send')
  expect(noName.text).toContain('send <name>')
  expect(seen.sends).toEqual([])
})

test('/wrap-up with an unknown argument says how to use it', async ($, on) => {
  world(on)
  await start($)
  const r = await typed($, 'wrap-up', 'sideways')
  expect(r.text).toContain('/wrap-up off')
})
