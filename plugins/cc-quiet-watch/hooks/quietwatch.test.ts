import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000

// The engine beneath the plugin: a job whose status the test sets, a judge
// that reads DONE / FAIL from it (NEWS for a tracker), and the prompts the plugin submits.
function world(on: On, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  mock.store(on, store)
  const seen = { status: 'running 10/500', checks: 0, judged: 0, prompts: [] as string[], judgePrompts: [] as string[], refuse: false, broken: false, judgeDown: false }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 's1' }))
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__cc-quiet-watch__${e.name}` } }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('mcp.call', async () => {
    seen.checks += 1
    if (seen.refuse) return { deny: 'refused: the server-side auto mode classifier gave no verdict' }
    if (seen.broken) return { value: { content: [{ type: 'text', text: 'HTTP 502' }], isError: true } } as never
    return { value: { content: [{ type: 'text', text: `{"status":"${seen.status}","updatedAt":"2026-10-10T12:0${seen.checks % 10}:00Z"}` }], isError: false } } as never
  })
  on('model.complete', async (_$, e) => {
    seen.judged += 1
    seen.judgePrompts.push(String(e.prompt))
    if (seen.judgeDown) return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
    const out = String(e.prompt).split('Latest output:\n')[1] ?? ''
    const tracker = String(e.system).includes('"tell"')
    // A tracker's judge tells only on a NEWS item the previous output did not hold.
    const prev = String(e.prompt).split('Previous output:\n')[1]?.split('\nLatest output:\n')[0] ?? ''
    const fresh = (out.match(/NEWS \w+/g) ?? []).some(m => !prev.includes(m))
    const status = tracker ? (fresh ? 'tell' : 'quiet') : out.includes('DONE') ? 'done' : out.includes('FAIL') ? 'failed' : 'running'
    const line = out.slice(0, 40)
    return { value: { isAnswered: true, text: JSON.stringify({ status, line }), usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('prompt.submit', async (_$, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  return { clock, seen }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

async function arm($: Engine, extra: Record<string, unknown> = {}) {
  return $.tool.call({
    tool: 'mcp__cc-quiet-watch__watch',
    name: 'qa-74',
    server: 'revelo-pipelines',
    mcpTool: 'get_batch_run',
    args: { pipelineId: 19, batchRunId: 74 },
    goal: 'done when the batch status is DONE; failed if it is FAIL',
    everyMinutes: 10,
    onWake: 'rerun the failed tasks',
    ...extra,
  } as never)
}

test('unchanged output is never judged; only a change is', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($)
  expect(seen.judged).toBe(1)
  await clock.advance(30 * MIN)
  expect(seen.checks).toBe(4)
  expect(seen.judged).toBe(1)
  seen.status = 'running 50/500'
  await clock.advance(10 * MIN)
  expect(seen.judged).toBe(2)
  expect(seen.prompts.length).toBe(0)
})

test('a finished job wakes the session once, with the line and what to do', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($)
  seen.status = 'DONE 500/500'
  await clock.advance(10 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('"qa-74" is done')
  expect(seen.prompts[0]).toContain('rerun the failed tasks')
  await clock.advance(60 * MIN)
  expect(seen.prompts.length).toBe(1)
})

test('output that stops changing wakes the session as stuck', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($, { stuckAfterMinutes: 30 })
  await clock.advance(40 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('is stuck')
})

test('a check that keeps failing wakes the session after three tries', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($)
  seen.broken = true
  await clock.advance(30 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('not checkable any more')
})

test('a judge that keeps failing hands the output to the session', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($)
  seen.judgeDown = true
  seen.status = 'running 60/500'
  await clock.advance(30 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('could not be judged')
  expect(seen.prompts[0]).toContain('running 60/500')
})

test('arming fails at once, naming the allow rule, when the MCP call is refused', async ($, on) => {
  const { seen } = world(on)
  seen.refuse = true
  await start($)
  const r = await arm($)
  expect(JSON.stringify(r)).toContain('mcp__revelo-pipelines__get_batch_run')
})

test('a job that is already done is not armed', async ($, on) => {
  const { clock, seen } = world(on)
  seen.status = 'DONE 500/500'
  await start($)
  const r = await arm($)
  expect(JSON.stringify(r)).toContain('Not armed')
  await clock.advance(60 * MIN)
  expect(seen.checks).toBe(1)
})

test('unwatch stops the checks', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await arm($)
  await $.tool.call({ tool: 'mcp__cc-quiet-watch__unwatch', name: 'qa-74' } as never)
  await clock.advance(60 * MIN)
  expect(seen.checks).toBe(1)
})

test('/watches lists the watches with their line', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await arm($)
  const r = await $.command.run({ command: 'watches', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(r.text).toContain('qa-74')
  expect(seen.checks).toBe(1)
})

async function track($: Engine, extra: Record<string, unknown> = {}) {
  return arm($, { name: 'thread', goal: 'tell me when someone replies with NEWS', keep: true, everyMinutes: undefined, onWake: undefined, ...extra })
}

test('a tracker wakes on news, stays listed, and wakes again on later news', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  const r = (await track($)) as { result: string }
  expect(r.result).toContain('Tracking "thread"')
  expect(seen.judged).toBe(0)
  seen.status = 'NEWS one'
  await clock.advance(2 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('"thread" has news')
  expect(seen.prompts[0]).toContain('only the user stops it')
  const list = await $.command.run({ command: 'watches', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(list.text).toContain('thread (tracker)')
  await clock.advance(10 * MIN)
  expect(seen.prompts.length).toBe(1)
  seen.status = 'NEWS two'
  await clock.advance(2 * MIN)
  expect(seen.prompts.length).toBe(2)
})

test('a quiet change does not wake a tracker; unchanged output calls no model', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await track($)
  await clock.advance(10 * MIN)
  expect(seen.checks).toBe(6)
  expect(seen.judged).toBe(0)
  seen.status = 'edited'
  await clock.advance(2 * MIN)
  expect(seen.judged).toBe(1)
  await clock.advance(10 * MIN)
  expect(seen.judged).toBe(1)
  expect(seen.prompts.length).toBe(0)
})

test('a tracker whose check fails wakes once at the third failure and keeps running', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await track($)
  seen.broken = true
  await clock.advance(6 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('cannot be checked')
  await clock.advance(10 * MIN)
  expect(seen.prompts.length).toBe(1)
  seen.broken = false
  await clock.advance(2 * MIN)
  seen.broken = true
  await clock.advance(6 * MIN)
  expect(seen.prompts.length).toBe(2)
  const list = await $.command.run({ command: 'watches', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(list.text).toContain('thread (tracker)')
})

test('a tracker checks at most every 30 seconds; a job watch every 2 minutes', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  const r = (await track($, { everyMinutes: 0.1 })) as { result: string }
  expect(r.result).toContain('every 30 s')
  await arm($, { everyMinutes: 1 })
  await clock.advance(2 * MIN)
  expect(seen.checks).toBe(2 + 4 + 1)
})

test('a watch saved without keep is a job watch', async ($, on) => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const saved = {
    name: 'old',
    probe: { kind: 'mcp', server: 'revelo-pipelines', tool: 'get_batch_run', args: {} },
    goal: 'done when the batch status is DONE',
    onWake: '',
    everyMs: 10 * MIN,
    stuckAfterMs: 0,
    createdAt: now,
    nextAt: now + 10 * MIN,
    lastHash: '1',
    lastChangeAt: now,
    line: 'running',
    errors: 0,
    judgeErrors: 0,
  }
  const { clock, seen } = world(on, { 'watches:s1': [saved] })
  await start($)
  seen.status = 'DONE 500/500'
  await clock.advance(10 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('"old" is done')
  expect(seen.prompts[0]).not.toContain('tracker')
  await clock.advance(60 * MIN)
  expect(seen.checks).toBe(1)
})

test('a tracker judges only what is new: news already there does not wake it again', async ($, on) => {
  const { clock, seen } = world(on)
  seen.status = 'NEWS one'
  await start($)
  await track($)
  seen.status = 'NEWS one, reacted'
  await clock.advance(2 * MIN)
  expect(seen.judged).toBe(1)
  expect(seen.judgePrompts[0]).toContain('Previous output:\n{"status":"NEWS one"')
  expect(seen.judgePrompts[0]).toContain('Latest output:\n{"status":"NEWS one, reacted"')
  expect(seen.prompts.length).toBe(0)
})
