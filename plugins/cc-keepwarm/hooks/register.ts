import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, Timer } from 'claude-code'

import type { Anchor, Halt, Stats } from '../types'

const COMMAND = 'keepwarm'
const PROMPT =
  '[keepwarm] Automated prompt-cache refresh, not a message from the user. Answer at once, without thinking, with the single word: ok'
const RETRY_MS = 2 * 60_000
// Two pings in a row that had to rewrite the cache mean it lives shorter than we ping.
const MAX_REWRITES = 2
const ZERO: Stats = { pings: 0, read: 0, output: 0, rewrites: 0, holds: 0, failures: 0 }

const anchor = atom({ plugin: 'cc-keepwarm', key: 'anchor' } as const, null)
const halt = atom({ plugin: 'cc-keepwarm', key: 'halt' } as const, null)
const stats = atom({ plugin: 'cc-keepwarm', key: 'stats' } as const, ZERO)
const isOff = atom({ plugin: 'cc-keepwarm', key: 'isOff' } as const, false)

// Set from the plugin's options each time register runs.
const cfg = { pingAfterMs: 55 * 60_000, ttlMs: 60 * 60_000, maxIdleMs: 0 }

// A -p run or an SDK session ends on its own; a pending ping must never hold it open.
let isInteractive = true

// One timer per session, always planned from the state, so a hot reload or a
// request that lands mid-ping simply plans again.
let timer: Timer | undefined

const promptTokens = (u: ModelUsage) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const clockTime = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

const minutesOf = (value: unknown, fallback: number) => {
  const n = Number(value)
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 60_000
}

async function plan($: EngineInterface) {
  timer?.cancel()
  timer = undefined
  const a = await read($, anchor)
  if (isInteractive && a && !(await read($, halt)) && !(await read($, isOff))) {
    const wait = Math.max(0, a.at + cfg.pingAfterMs - (await $.clock.now()))
    timer = $.clock.after(wait, () => void ping($))
  }
}

async function stopFor($: EngineInterface, why: Halt) {
  await update($, halt, () => why)
  await plan($)
}

async function count($: EngineInterface, delta: Partial<Stats>) {
  await update($, stats, s => ({
    pings: s.pings + (delta.pings ?? 0),
    read: s.read + (delta.read ?? 0),
    output: s.output + (delta.output ?? 0),
    rewrites: s.rewrites + (delta.rewrites ?? 0),
    holds: s.holds + (delta.holds ?? 0),
    failures: s.failures + (delta.failures ?? 0),
  }))
}

// Moves the anchor only if no real request moved it while the ping ran.
async function moveIf($: EngineInterface, from: Anchor, to: Partial<Anchor>) {
  await update($, anchor, cur => (cur && cur.at === from.at ? { ...cur, ...to } : cur))
}

async function ping($: EngineInterface) {
  timer = undefined
  const a = await read($, anchor)
  if (!a || (await read($, halt)) || (await read($, isOff))) return
  const at = await $.clock.now()

  // A timer that fires past the lifetime (the Mac slept) would pay a full
  // rewrite to warm a session nobody is at: hold until a real request.
  if (at - a.at >= cfg.ttlMs) {
    await count($, { holds: 1 })
    return stopFor($, 'cold')
  }
  if (cfg.maxIdleMs > 0 && at - a.lastRequestAt >= cfg.maxIdleMs) return stopFor($, 'idle')

  const reply = await $.model.fork({ prompt: PROMPT })
  if ((await read($, anchor))?.at !== a.at) return
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') return stopFor($, 'cleared')

  const cached = reply.usage.cache_read_input_tokens
  if (cached > 0 && cached >= a.prefix / 2) {
    await count($, { pings: 1, read: cached, output: reply.usage.output_tokens })
    await moveIf($, a, { at, rewrites: 0 })
    return plan($)
  }
  if (reply.usage.cache_creation_input_tokens > 0) {
    await count($, { pings: 1, rewrites: 1, output: reply.usage.output_tokens })
    await moveIf($, a, { at, rewrites: a.rewrites + 1 })
    return a.rewrites + 1 >= MAX_REWRITES ? stopFor($, 'expiring') : plan($)
  }

  // Nothing reached the cache (API error, empty reply, aborted): retry while
  // a retry can still land inside the lifetime.
  await count($, { failures: 1 })
  if (at + RETRY_MS < a.at + cfg.ttlMs - 60_000) {
    timer = $.clock.after(RETRY_MS, () => void ping($))
    return
  }
  return stopFor($, 'cold')
}

async function touch($: EngineInterface, at: number, usage: ModelUsage) {
  await update($, anchor, () => ({ at, lastRequestAt: at, prefix: promptTokens(usage), rewrites: 0 }))
  await update($, halt, () => null)
  await plan($)
}

async function report($: EngineInterface) {
  const a = await read($, anchor)
  const h = await read($, halt)
  const s = await read($, stats)
  const state = (await read($, isOff))
    ? 'off in this session'
    : !a
      ? 'waiting for the first request'
      : h === null
        ? `warm, next ping at ${clockTime(a.at + cfg.pingAfterMs)} (last touch ${clockTime(a.at)})`
        : h === 'cold'
          ? `cold, the next turn rewrites about ${tokens(a.prefix)} tokens`
          : h === 'idle'
            ? `stopped by the idle cap, cache cold after ${clockTime(a.at + cfg.ttlMs)}`
            : h === 'expiring'
              ? 'stopped: two pings in a row found the cache already gone'
              : 'waiting for the next request'
  const idle = cfg.maxIdleMs > 0 ? `${cfg.maxIdleMs / 3_600_000}h` : 'off'
  return [
    `${state[0]!.toUpperCase()}${state.slice(1)}.`,
    `This session: ${s.pings} pings read ${tokens(s.read)} cached tokens and wrote ${tokens(s.output)} output tokens; ${s.rewrites} rewrites, ${s.holds} cold holds, ${s.failures} failures.`,
    `Settings: ping after ${cfg.pingAfterMs / 60_000}m, lifetime ${cfg.ttlMs / 60_000}m, idle cap ${idle}. /${COMMAND} off pauses it here, /${COMMAND} on resumes.`,
  ].join('\n')
}

export const register: Register = (on, options) => {
  cfg.pingAfterMs = minutesOf(options.pingAfterMinutes, 55)
  cfg.ttlMs = minutesOf(options.ttlMinutes, 60)
  cfg.maxIdleMs = Math.max(0, Number(options.maxIdleHours) || 0) * 3_600_000

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'keepwarm',
      description: 'Shows the prompt-cache keepwarm state; off or on pauses or resumes it in this session.',
      argumentHint: '[on|off]',
    })
    await plan($)
    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOff, () => arg === 'off')
      await plan($)
    } else if (arg !== '' && arg !== 'status') {
      return { text: `Unknown argument "${arg}". Use /${COMMAND}, /${COMMAND} on or /${COMMAND} off.` }
    }
    return { text: await report($) }
  })

  // Every main-thread request touches the cache: it is the clock the ping runs on.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const at = await $.clock.now()
    const result = yield* next(e)
    if (result.usage) {
      try {
        await touch($, at, result.usage)
      } catch {
        // Never let bookkeeping break the request it rides on.
      }
    }
    return result
  })

  // After a compaction or a model switch the cached prefix is dead; the next
  // request writes the new one and plans again.
  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) await stopFor($, 'compacted')
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    if (e.agent_id === undefined) await stopFor($, 'switched')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await stopFor($, 'cleared')
    return next(e)
  })
}
