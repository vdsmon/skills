import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

const SID = 'sess-1'
const DAY = 24 * 3_600_000

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }
const named = (text: string): ModelForkResult => ({ isAnswered: true, text, usage })
const failed: ModelForkResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage }
const nothing = { isAnswered: false, reason: 'nothing-to-fork' } as ModelForkResult

// The engine beneath the plugin: a session, a clock, a store, a fork whose
// answers the test picks, and the built-in /rename.
function world(on: On, entries: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 100 * DAY })
  // The plugin's store, held here so a test can read what was written.
  const store = new Map<string, unknown>(Object.entries(entries))
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...store.keys()] }))
  const seen = {
    forks: 0,
    prompts: [] as string[],
    replies: [] as ModelForkResult[],
    reply: named('pr-17-review-fixes'),
    renames: [] as string[],
    // When set, each fork waits for it.
    gate: undefined as Promise<void> | undefined,
    renameFails: false,
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: SID }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('model.fork', async (_$, e) => {
    seen.forks += 1
    seen.prompts.push(e.prompt)
    await seen.gate
    return { value: seen.replies.shift() ?? seen.reply }
  })
  on('command.run', { command: 'rename' }, async (_$, e) => {
    if (seen.renameFails) throw new Error('refused')
    seen.renames.push(e.args)
    return { text: `Session renamed to: ${e.args}` }
  })
  on('classic.UserPromptSubmit', async () => ({}))
  on('classic.SessionStart', async () => ({}))
  on('classic.PostCompact', async () => ({}))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  async function start($: Engine, isInteractive = true) {
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive })
  }

  // One prompt: returns the name the plugin applies with it, if any.
  async function prompt($: Engine, title?: string) {
    const r = await $.classic.UserPromptSubmit({ prompt: 'go on', session_title: title, session_id: SID })
    return r.sessionTitle
  }

  async function turn($: Engine, opts: { agentId?: string; reason?: 'answer' | 'aborted' } = {}) {
    const reason = opts.reason ?? 'answer'
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', agentId: opts.agentId, reason })
    await clock.advance(0)
  }

  // n prompts, each followed by its turn; returns the names applied on the way.
  async function turns($: Engine, n: number, title?: string) {
    const applied: string[] = []
    for (let i = 0; i < n; i++) {
      const t = await prompt($, applied.at(-1) ?? title)
      if (t) applied.push(t)
      await turn($)
    }
    return applied
  }

  return { clock, store, seen, start, prompt, turn, turns }
}

// A /rename typed at the prompt.
function rename($: Engine, name: string) {
  return $.command.run({
    command: 'rename',
    args: name,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

function autotitle($: Engine, args = '') {
  return $.command.run({
    command: 'autotitle',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

test('no check before turn 3; turn 3 picks a name that lands with the next prompt', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 2)
  expect(w.seen.forks).toBe(0)
  await w.turns($, 1)
  expect(w.seen.forks).toBe(1)
  expect(await w.prompt($)).toBe('pr-17-review-fixes')
  expect(w.seen.renames).toEqual([])
})

test('re-checks 10 turns after the last check, not before', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 3)
  w.seen.reply = named('google-top-10-rerun')
  const applied = await w.turns($, 9)
  expect(applied).toEqual(['pr-17-review-fixes'])
  expect(w.seen.forks).toBe(1)
  await w.turns($, 1, 'pr-17-review-fixes')
  expect(w.seen.forks).toBe(2)
  expect(w.seen.prompts[1]).toContain('The session is now named pr-17-review-fixes.')
  expect(await w.prompt($, 'pr-17-review-fixes')).toBe('google-top-10-rerun')
})

test('recheckEveryTurns 0 names the session once', { options: { recheckEveryTurns: 0 } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 30)
  expect(w.seen.forks).toBe(1)
})

test('a compaction makes the next turn check', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 4)
  expect(w.seen.forks).toBe(1)
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
  await w.turns($, 1, 'pr-17-review-fixes')
  expect(w.seen.forks).toBe(2)
})

test('a reply equal to the current name applies nothing', async ($, on) => {
  const w = world(on)
  await w.start($)
  const applied = await w.turns($, 13)
  expect(w.seen.forks).toBe(2)
  expect(applied).toEqual(['pr-17-review-fixes'])
  expect(await w.prompt($, 'pr-17-review-fixes')).toBeUndefined()
})

test('a reply that is not a name applies nothing and the next turn tries again', async ($, on) => {
  const w = world(on)
  await w.start($)
  for (const bad of ['Sure! pr-17-fixes', 'fixes', 'a-b-c-d-e-f-g-h-i-j-k', 'a-very-long-session-name-that-runs-past-40', 'PR-17-fixes']) {
    w.seen.replies.push(named(bad))
  }
  await w.turns($, 3)
  expect(await w.prompt($)).toBeUndefined()
  await w.turn($)
  expect(await w.prompt($)).toBeUndefined()
  await w.turn($)
  expect(w.seen.forks).toBe(3)
  // Three failures in a row: wait for the next scheduled check.
  await w.turns($, 9)
  expect(w.seen.forks).toBe(3)
  await w.turns($, 1)
  expect(w.seen.forks).toBe(4)
})

test('a failed fork counts as a failure; nothing to fork starts the count again', async ($, on) => {
  const w = world(on)
  await w.start($)
  w.seen.replies.push(failed, nothing)
  await w.turns($, 3)
  expect(w.seen.forks).toBe(1)
  await w.turns($, 1)
  expect(w.seen.forks).toBe(2)
  await w.turns($, 2)
  expect(w.seen.forks).toBe(2)
  await w.turns($, 1)
  expect(w.seen.forks).toBe(3)
  expect(await w.prompt($)).toBe('pr-17-review-fixes')
  expect((await autotitle($, 'status')).text).toContain('3 checks, 1 renames, 1 failures')
})

test('a /rename typed by hand pins the session', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 1)
  await rename($, 'My Own Name')
  expect(w.store.get(`s:${SID}`)).toMatchObject({ lastSet: null, pinned: true })
  await w.turns($, 30, 'My Own Name')
  expect(w.seen.forks).toBe(0)
})

test('a kebab-case name the plugin did not set pins (a job renamed from the jobs list)', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 1)
  await w.turns($, 30, 'my-job-name')
  expect(w.seen.forks).toBe(0)
})

test("the desktop app's own sentence-case title is replaced at the first check", async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 3, 'Open PRs and marketplace update')
  expect(w.seen.forks).toBe(1)
  expect(w.seen.prompts[0]).not.toContain('The session is now named')
  expect(await w.prompt($, 'Open PRs and marketplace update')).toBe('pr-17-review-fixes')
})

test('a resumed session with a name the plugin has no record of stays pinned', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.classic.SessionStart({ source: 'resume', session_title: 'Old Desktop Title', session_id: SID })
  await w.turns($, 30, 'Old Desktop Title')
  expect(w.seen.forks).toBe(0)
})

test('a name set by hand after an automatic one pins too', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 3)
  expect(await w.prompt($)).toBe('pr-17-review-fixes')
  await w.turn($)
  await w.turns($, 20, 'manual-name')
  expect(w.seen.forks).toBe(1)
})

test('/autotitle picks a name now, renames and pins', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 1)
  w.seen.reply = named('pr-17-exit-handling')
  const r = await autotitle($, 'focus on the PR part')
  expect(r.text).toBe('Named this session pr-17-exit-handling.')
  await w.clock.advance(0)
  expect(w.seen.renames).toEqual(['pr-17-exit-handling'])
  expect(w.seen.prompts[0]).toContain('The user asks for a name that follows this: focus on the PR part.')
  expect(w.seen.prompts[0]).not.toContain('reply with it unchanged')
  await w.turns($, 30, 'pr-17-exit-handling')
  expect(w.seen.forks).toBe(1)
  expect(w.store.get(`s:${SID}`)).toMatchObject({ lastSet: 'pr-17-exit-handling', pinned: true })
})

test('a refused /autotitle rename lands with the next prompt and pins', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.turns($, 1, 'manual-name')
  w.seen.renameFails = true
  w.seen.reply = named('pr-17-exit-handling')
  await autotitle($)
  await w.clock.advance(0)
  expect(w.seen.renames).toEqual([])
  expect(await w.prompt($, 'manual-name')).toBe('pr-17-exit-handling')
  await w.turn($)
  await w.turns($, 30, 'pr-17-exit-handling')
  expect(w.seen.forks).toBe(1)
})

test('/autotitle with nothing to fork says so', async ($, on) => {
  const w = world(on)
  await w.start($)
  w.seen.reply = nothing
  expect((await autotitle($)).text).toBe('Nothing to name yet.')
  expect(w.seen.renames).toEqual([])
})

test('/autotitle off stops checks; on resumes them and takes the current name', async ($, on) => {
  const w = world(on)
  await w.start($)
  await autotitle($, 'off')
  await w.turns($, 5)
  expect(w.seen.forks).toBe(0)
  await w.prompt($, 'manual-name')
  await autotitle($, 'on')
  expect(await w.prompt($, 'manual-name')).toBeUndefined()
  await w.turn($)
  await w.turns($, 8, 'manual-name')
  expect(w.seen.forks).toBe(0)
  await w.turns($, 1, 'manual-name')
  expect(w.seen.forks).toBe(1)
  expect(w.seen.prompts[0]).toContain('The session is now named manual-name.')
})

test('/autotitle status says what it is doing', async ($, on) => {
  const w = world(on)
  await w.start($)
  expect((await autotitle($, 'status')).text).toContain('No name set yet. Next check after turn 3.')
  await w.turns($, 3)
  expect((await autotitle($, 'status')).text).toContain('No name set yet. Picked pr-17-review-fixes; it lands with your next message. Next check after turn 13.')
  await w.prompt($)
  expect((await autotitle($, 'status')).text).toContain('Last name set: pr-17-review-fixes. Next check after turn 13.')
  await autotitle($, 'off')
  expect((await autotitle($, 'status')).text).toContain('Off in this session.')
})

test('a non-interactive session never checks', async ($, on) => {
  const w = world(on)
  await w.start($, false)
  await w.turns($, 20)
  expect(w.seen.forks).toBe(0)
})

test('subagent turns and interrupted turns do not count', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.prompt($)
  for (let i = 0; i < 5; i++) await w.turn($, { agentId: 'agent-1' })
  for (let i = 0; i < 5; i++) await w.turn($, { reason: 'aborted' })
  expect(w.seen.forks).toBe(0)
})

test('a resumed session keeps following its automatic name', async ($, on) => {
  const w = world(on, { [`s:${SID}`]: { lastSet: 'old-auto-name', pinned: false, at: 99 * DAY } })
  await w.start($)
  expect(await w.prompt($, 'old-auto-name')).toBeUndefined()
  await w.turn($)
  await w.turns($, 9, 'old-auto-name')
  expect(w.seen.forks).toBe(1)
  expect(await w.prompt($, 'old-auto-name')).toBe('pr-17-review-fixes')
})

test('a resumed pinned session stays pinned', async ($, on) => {
  const w = world(on, { [`s:${SID}`]: { lastSet: 'picked-by-hand', pinned: true, at: 99 * DAY } })
  await w.start($)
  await w.turns($, 30, 'picked-by-hand')
  expect(w.seen.forks).toBe(0)
})

test('/autotitle on right after a resume adopts the name the next prompt brings', async ($, on) => {
  const w = world(on, { [`s:${SID}`]: { lastSet: 'old-auto-name', pinned: true, at: 99 * DAY } })
  await w.start($)
  expect((await autotitle($, 'status')).text).toContain('Pinned: its name was set by hand')
  await autotitle($, 'on')
  expect(w.store.get(`s:${SID}`)).toMatchObject({ pinned: false })
  expect(await w.prompt($, 'named-by-hand')).toBeUndefined()
  await w.turn($)
  await w.turns($, 9, 'named-by-hand')
  expect(w.seen.forks).toBe(1)
  expect(w.seen.prompts[0]).toContain('The session is now named named-by-hand.')
  expect(await w.prompt($, 'named-by-hand')).toBe('pr-17-review-fixes')
})

test('store entries older than 60 days are pruned at session start', async ($, on) => {
  const w = world(on, { 's:old': { lastSet: 'x', pinned: false, at: 30 * DAY }, 's:new': { lastSet: 'y', pinned: false, at: 90 * DAY } })
  await w.start($)
  await w.clock.advance(0)
  expect(w.store.get('s:old')).toBeUndefined()
  expect(w.store.get('s:new')).toMatchObject({ lastSet: 'y' })
})

test('a second check never starts while one runs', async ($, on) => {
  const w = world(on)
  let release = () => {}
  w.seen.gate = new Promise<void>(r => {
    release = r
  })
  await w.start($)
  await w.turns($, 3)
  await w.turns($, 2)
  release()
  await w.clock.advance(0)
  expect(w.seen.forks).toBe(1)
})
