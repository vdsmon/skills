import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

const MIN = 60_000
const PREFIX = 400_000

const usage = (read: number, write = 0) => ({
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

const warm: ModelForkResult = { isAnswered: true, text: 'ok', usage: usage(PREFIX) }
const rewrote: ModelForkResult = { isAnswered: true, text: 'ok', usage: usage(0, PREFIX) }

// The engine beneath the plugin: a session, a clock, and a fork whose answer the test picks.
function world(on: On) {
  const clock = mock.clock(on, { now: 0 })
  const seen = { forks: 0, reply: warm }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('model.fork', async () => {
    seen.forks += 1
    return { value: seen.reply }
  })
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { ...usage(PREFIX - 1000, 1000), model: 'claude-opus-5-5' },
    }
  })
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.PostCompact', async () => ({}))
  on('classic.PostModelSwitch', async () => ({}))
  return { clock, seen }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

function keepwarm($: Engine, args = '') {
  return $.command.run({
    command: 'keepwarm',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

async function request($: Engine, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId })
  for await (const _ of stream);
}

test('a main request plans one ping 55 minutes later, and each warm ping plans the next', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await clock.advance(54 * MIN)
  expect(seen.forks).toBe(0)
  await clock.advance(1 * MIN)
  expect(seen.forks).toBe(1)
  await clock.advance(55 * MIN)
  expect(seen.forks).toBe(2)
  const r = await keepwarm($)
  expect(r.text).toContain('2 pings read 800k cached tokens and wrote 10 output tokens')
})

test('a subagent request plans nothing', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($, 'agent-1')
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(0)
})

test('a request before the ping moves the ping', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await clock.advance(50 * MIN)
  await request($)
  await clock.advance(10 * MIN)
  expect(seen.forks).toBe(0)
  await clock.advance(45 * MIN)
  expect(seen.forks).toBe(1)
})

test('two pings in a row that rewrite the cache stop the chain', async ($, on) => {
  const { clock, seen } = world(on)
  seen.reply = rewrote
  await start($)
  await request($)
  await clock.advance(110 * MIN)
  expect(seen.forks).toBe(2)
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(2)
})

test('nothing to fork stops the chain until the next request', async ($, on) => {
  const { clock, seen } = world(on)
  seen.reply = { isAnswered: false, reason: 'nothing-to-fork' }
  await start($)
  await request($)
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(1)
  seen.reply = warm
  await request($)
  await clock.advance(55 * MIN)
  expect(seen.forks).toBe(2)
})

test('a ping past the cache lifetime is held, not sent', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await keepwarm($, 'off')
  await clock.advance(70 * MIN)
  // Turning it back on 70 minutes after the last touch finds the cache gone.
  await keepwarm($, 'on')
  await clock.settle()
  expect(seen.forks).toBe(0)
  const r = await keepwarm($)
  expect(r.text).toContain('1 cold holds')
})

test('a compaction stops pinging until the next request', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(0)
  await request($)
  await clock.advance(55 * MIN)
  expect(seen.forks).toBe(1)
})

test('a model switch stops pinging until the next request', async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-fable-5-1',
    requested_model: 'fable',
    source: 'command',
    context_tokens: PREFIX,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 8,
    pricing: 'catalog',
  })
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(0)
})

test('a non-interactive session never plans a ping', async ($, on) => {
  const { clock, seen } = world(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await request($)
  await clock.advance(120 * MIN)
  expect(seen.forks).toBe(0)
})

test('the idle cap stops pinging after that long without a request', { options: { maxIdleHours: 1 } }, async ($, on) => {
  const { clock, seen } = world(on)
  await start($)
  await request($)
  await clock.advance(55 * MIN)
  expect(seen.forks).toBe(1)
  await clock.advance(55 * MIN)
  expect(seen.forks).toBe(1)
})
