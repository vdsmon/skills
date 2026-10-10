import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionAppendInput, SessionRateLimit } from 'claude-code'

const MIN = 60_000
// Pinned, so the tests do not follow the manifest's defaults.
const OPTS = { options: { warn5h: 90, park5h: 97, warnWeekly: 96, parkWeekly: 99, graceRequests: 2 } }
const NOW = Date.parse('2026-10-10T03:00:00Z')
const RESET = NOW + 120 * MIN

const fiveHour = (pct: number, resetsAt = RESET): SessionRateLimit => ({
  kind: 'five_hour',
  percentUsed: pct,
  resetsAt: new Date(resetsAt).toISOString(),
})

// The engine beneath the plugin: usage the test sets, requests it counts, and
// the notes, pushes and prompts the plugin sends.
function world(on: On, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  const session = mock.session(on)
  const seen = {
    limits: [] as SessionRateLimit[],
    requests: 0,
    pushes: [] as string[],
    prompts: [] as string[],
    toasts: [] as string[],
  }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', async () => ({ value: { startedAt: NOW, context: {}, rateLimits: seen.limits } as never }))
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('tool.call', async (_$, e) => {
    if (e.tool === 'PushNotification') seen.pushes.push(e.message)
    return { result: { pushSent: true } } as never
  })
  on('prompt.submit', async (_$, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    seen.requests += 1
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'model reply',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' },
    }
  })
  const notes = () => session.appended().map((row: SessionAppendInput) => JSON.stringify(row.message.content))
  return { clock, seen, notes }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

// Sends one request and returns the text the reply streamed, if any.
async function request($: Engine, agentId?: string) {
  let text = ''
  for await (const chunk of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId })) {
    if (chunk.kind === 'text') text += chunk.text
  }
  return text
}

function pitstop($: Engine, args = '') {
  return $.command.run({
    command: 'pitstop',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

test('the warn tier sends one note per window', OPTS, async ($, on) => {
  const { seen, notes } = world(on)
  seen.limits = [fiveHour(91)]
  await start($)
  await request($)
  await request($)
  await request($)
  expect(seen.requests).toBe(3)
  expect(notes().filter(n => n.includes('Usage is at 91%')).length).toBe(1)
})

test('the park tier warns, allows the grace requests, then answers without a request', OPTS, async ($, on) => {
  const { seen, notes } = world(on)
  seen.limits = [fiveHour(97)]
  await start($)
  await request($) // records the reading
  await request($) // sees the park: stop note, in flight
  await request($) // grace 1
  await request($) // grace 2
  expect(seen.requests).toBe(4)
  const text = await request($)
  expect(seen.requests).toBe(4)
  expect(text).toContain('pitstop: paused')
  expect(notes().some(n => n.includes('STOP: usage is at 97%'))).toBe(true)
  expect(seen.pushes.length).toBe(1)
})

test('all subagents share one small pool, however many a workflow spawns', OPTS, async ($, on) => {
  const { seen, notes } = world(on)
  seen.limits = [fiveHour(98)]
  await start($)
  await request($)
  for (let i = 0; i < 20; i++) await request($, `agent-${i}`)
  // 1 request before the park, then the pool of 3.
  expect(seen.requests).toBe(4)
  expect(await request($, 'agent-99')).toContain('pitstop: paused')
  expect(notes().filter(n => n.includes('Finish this step and return')).length).toBe(21)
})

test('a park another session stored holds here too', OPTS, async ($, on) => {
  const { seen } = world(on, { park: { kind: 'five_hour', pct: 97, resetsAt: RESET, at: NOW } })
  await start($)
  await request($)
  await request($)
  await request($)
  expect(seen.requests).toBe(3)
  expect(await request($)).toContain('pitstop: paused')
})

test('the reset resumes a session whose work was cut off', OPTS, async ($, on) => {
  const { clock, seen } = world(on)
  seen.limits = [fiveHour(97)]
  await start($)
  for (let i = 0; i < 5; i++) await request($)
  expect(seen.requests).toBe(4)
  await clock.advance(121 * MIN)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('Continue the work that was paused')
  seen.limits = [fiveHour(2, RESET + 300 * MIN)]
  await request($)
  expect(seen.requests).toBe(5)
})

test('the reset sends no prompt when nothing was cut off', OPTS, async ($, on) => {
  const { clock, seen } = world(on)
  seen.limits = [fiveHour(97)]
  await start($)
  await request($)
  await request($)
  await clock.advance(121 * MIN)
  expect(seen.prompts.length).toBe(0)
})

test('/pitstop go continues through the park', OPTS, async ($, on) => {
  const { seen } = world(on)
  seen.limits = [fiveHour(99)]
  await start($)
  for (let i = 0; i < 5; i++) await request($)
  expect(seen.requests).toBe(4)
  const r = await pitstop($, 'go')
  expect(r.text).toContain('Continuing. Pitstop will not pause this session again')
  await request($)
  expect(seen.requests).toBe(5)
})

test('a reading whose window already reset is ignored', OPTS, async ($, on) => {
  const { seen } = world(on)
  seen.limits = [fiveHour(99, NOW - MIN)]
  await start($)
  for (let i = 0; i < 6; i++) await request($)
  expect(seen.requests).toBe(6)
})

test('a stored park from a lower park line is dropped by a newer reading', OPTS, async ($, on) => {
  const { seen } = world(on, { park: { kind: 'five_hour', pct: 5, resetsAt: RESET, at: NOW - MIN } })
  seen.limits = [fiveHour(5)]
  await start($)
  await request($) // a newer reading of the same window: 5% is under the 97% line
  for (let i = 0; i < 5; i++) await request($)
  expect(seen.requests).toBe(6)
})

test('/pitstop off stops enforcing in this session', OPTS, async ($, on) => {
  const { seen } = world(on)
  seen.limits = [fiveHour(99)]
  await start($)
  await pitstop($, 'off')
  for (let i = 0; i < 6; i++) await request($)
  expect(seen.requests).toBe(6)
})

test('/pitstop shows the windows and the state', OPTS, async ($, on) => {
  const { seen } = world(on)
  seen.limits = [fiveHour(42)]
  await start($)
  await request($)
  const r = await pitstop($)
  expect(r.text).toContain('Running.')
  expect(r.text).toContain('5-hour: 42% used')
})
