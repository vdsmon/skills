import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Saved, State } from '../types'

const COMMAND = 'autotitle'
// 2 to 10 parts: the prompt asks for 2 to 6 words, and a handle like pr-31 is two parts.
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+){1,9}$/
const MAX_CHARS = 40
// Three failed checks in a row wait for the next scheduled check instead of forking every turn.
const MAX_FAILURES = 3
const KEEP_MS = 60 * 24 * 3_600_000

const PROMPT = `[autotitle] Automated request from the cc-autotitle plugin, not a message from the user. Do not continue the conversation and do not think. Reply with one session name and nothing else.

Name this whole session the way a person would search for it in /resume weeks from now. Weigh where the work went and what came out of it (a PR, a fix, a decision, a report), not the last turn.
- Lead with the subject, then the action or result: pr-17-review-fixes, feed-cursor-off-by-one-fix.
- Keep the handles a person searches for: ticket keys, PR numbers, batch, pipeline or dataset ids, feature and file names.
- Drop filler words (session, chat, help, work, stuff, misc, question, claude) and the repo name.
- Lowercase English, only letters, digits and hyphens, 2 to 6 words, at most 40 characters, even when the conversation is in another language.`

const FRESH: State = {
  sessionId: null,
  turns: 0,
  nextAt: 3,
  compacted: false,
  pending: null,
  pinOnApply: false,
  lastSet: null,
  lastSeen: null,
  pinned: false,
  failures: 0,
  isOff: false,
  stats: { checks: 0, renames: 0, failures: 0 },
}

const state = atom({ plugin: 'cc-autotitle', key: 'state' } as const, FRESH)

// Set from the plugin's options each time register runs.
const cfg = { first: 3, recheck: 10 }

// A -p run or an SDK session is never named.
let isInteractive = true

// One check at a time; a turn that ends while one runs does not start another.
let inFlight = false

const turnsOf = (value: unknown, fallback: number, min: number) => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= min ? n : fallback
}

const later = (turn: number) => (cfg.recheck > 0 ? turn + cfg.recheck : null)

const due = (s: State) => !s.isOff && !s.pinned && (s.compacted || (s.nextAt !== null && s.turns >= s.nextAt))

function prompt(current: string | null, hint?: string) {
  const parts = [PROMPT]
  if (current) parts.push(`The session is now named ${current}. If that name still fits the main work, reply with it unchanged.`)
  if (hint) parts.push(`The user asks: ${hint}`)
  return parts.join('\n\n')
}

// When unsure, keep the current name: you search /resume by name, so a wrong
// name costs more than an old one. Anything but a bare kebab-case name is dropped.
function parse(text: string) {
  const t = text.trim().replace(/^`([^`]*)`$/, '$1')
  return t.length <= MAX_CHARS && NAME.test(t) ? t : undefined
}

type Pick = { isNamed: true; name: string } | { isNamed: false; reason: string }

async function pick($: EngineInterface, current: string | null, hint?: string): Promise<Pick> {
  const reply = await $.model.fork({ prompt: prompt(current, hint) })
  if (!reply.isAnswered) return { isNamed: false, reason: reply.reason }
  const name = parse(reply.text)
  return name ? { isNamed: true, name } : { isNamed: false, reason: 'not-a-name' }
}

async function save($: EngineInterface) {
  const s = await read($, state)
  if (!s.sessionId) return
  const saved: Saved = { lastSet: s.lastSet, pinned: s.pinned, at: await $.clock.now() }
  await $.store.set(`s:${s.sessionId}`, saved)
}

// Loads the session's saved name on its first prompt, after a resume, or
// when /clear moved to a new session id.
async function ensure($: EngineInterface, id: string) {
  if ((await read($, state)).sessionId === id) return
  const saved = (await $.store.get(`s:${id}`)) as Partial<Saved> | undefined
  const lastSet = typeof saved?.lastSet === 'string' ? saved.lastSet : null
  await update($, state, cur => ({
    ...FRESH,
    isOff: cur.isOff,
    stats: cur.stats,
    sessionId: id,
    lastSet,
    pinned: saved?.pinned === true,
    nextAt: lastSet ? later(0) : cfg.first,
  }))
}

async function prune($: EngineInterface) {
  const cutoff = (await $.clock.now()) - KEEP_MS
  for (const key of await $.store.keys()) {
    if (!key.startsWith('s:')) continue
    const saved = (await $.store.get(key)) as Partial<Saved> | undefined
    if (typeof saved?.at !== 'number' || saved.at < cutoff) await $.store.delete(key)
  }
}

async function check($: EngineInterface) {
  if (inFlight) return
  inFlight = true
  try {
    const s = await read($, state)
    if (!due(s)) return
    const current = s.lastSeen ?? s.lastSet
    const r = await pick($, current)
    await update($, state, cur => {
      if (cur.sessionId !== s.sessionId) return cur
      const stats = { ...cur.stats, checks: cur.stats.checks + 1 }
      if (r.isNamed) {
        const pending = r.name !== current ? r.name : null
        return { ...cur, pending, nextAt: later(cur.turns), compacted: false, failures: 0, stats }
      }
      if (r.reason === 'nothing-to-fork') return { ...cur, turns: 0, nextAt: cfg.first, stats }
      stats.failures += 1
      const failures = cur.failures + 1
      return failures >= MAX_FAILURES
        ? { ...cur, failures: 0, compacted: false, nextAt: later(cur.turns), stats }
        : { ...cur, failures, stats }
    })
  } finally {
    inFlight = false
  }
}

// Returns the name to apply with this prompt, if any.
async function apply($: EngineInterface, title: string | null) {
  let name: string | undefined
  const before = await read($, state)
  await update($, state, s => {
    name = undefined
    const seen = { ...s, lastSeen: title }
    // A name /autotitle could not apply at once: you asked for it, so it lands
    // over whatever the session is called.
    if (s.pinOnApply && s.pending) {
      name = s.pending
      return { ...seen, lastSeen: s.pending, pending: null, pinned: true, pinOnApply: false }
    }
    // Someone else named the session (/rename, another surface, an old name):
    // it is theirs from now on.
    if (title && title !== s.lastSet) return { ...seen, pinned: true, pending: null }
    if (!s.pending || s.pinned || s.isOff || s.pending === title) return seen
    name = s.pending
    return {
      ...seen,
      lastSet: s.pending,
      lastSeen: s.pending,
      pending: null,
      stats: { ...s.stats, renames: s.stats.renames + 1 },
    }
  })
  const after = await read($, state)
  if (after.lastSet !== before.lastSet || after.pinned !== before.pinned) await save($)
  return name
}

async function nameNow($: EngineInterface, hint?: string) {
  const s = await read($, state)
  const r = await pick($, s.lastSeen ?? s.lastSet, hint)
  if (!r.isNamed) {
    await update($, state, cur => ({ ...cur, stats: { ...cur.stats, checks: cur.stats.checks + 1, failures: cur.stats.failures + 1 } }))
    return r.reason === 'nothing-to-fork' ? 'Nothing to name yet.' : `No name this time (${r.reason}). Try again.`
  }
  const name = r.name
  await update($, state, cur => ({
    ...cur,
    lastSet: name,
    lastSeen: name,
    pending: null,
    pinned: true,
    stats: { ...cur.stats, checks: cur.stats.checks + 1, renames: cur.stats.renames + 1 },
  }))
  await save($)
  // The host refuses a command run from inside a command hook, so the rename
  // runs from a timer once this one has answered.
  $.clock.after(0, () => void rename($, name))
  return `Named this session ${name}.`
}

async function rename($: EngineInterface, name: string) {
  try {
    await $.command.run({ command: 'rename', args: name })
  } catch {
    // Refused here too: the name lands with the next prompt instead.
    await update($, state, cur => ({ ...cur, pending: name, pinOnApply: true }))
  }
}

async function report($: EngineInterface) {
  const s = await read($, state)
  const next = s.compacted ? 'the next turn' : s.nextAt === null ? 'none planned' : `after turn ${s.nextAt}`
  const status = s.isOff
    ? 'Off in this session.'
    : s.pinned
      ? `Pinned: ${s.lastSeen ?? s.lastSet ?? 'this name'} was set by hand, so it is not renamed. /${COMMAND} on lets it follow the work again.`
      : `${s.lastSet ? `Last name set: ${s.lastSet}.` : 'No name set yet.'} Next check ${next}.`
  const recheck = cfg.recheck > 0 ? `every ${cfg.recheck} turns` : 'never'
  return [
    status,
    `This session: turn ${s.turns}; ${s.stats.checks} checks, ${s.stats.renames} renames, ${s.stats.failures} failures.`,
    `Settings: first name after turn ${cfg.first}, re-check ${recheck}. /${COMMAND} names it now, /${COMMAND} off pauses it here.`,
  ].join('\n')
}

export const register: Register = (on, options) => {
  cfg.first = turnsOf(options.firstAfterTurns, 3, 1)
  cfg.recheck = turnsOf(options.recheckEveryTurns, 10, 0)

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'autotitle',
      description: 'Names this session now (an optional hint steers it); off, on or status control the automatic names.',
      argumentHint: '[hint|off|on|status]',
    })
    // Off the start path; a store that cannot be pruned still names sessions.
    $.clock.after(0, () => void prune($).catch(() => {}))
    return next(e)
  })

  on('command.run', { command: 'autotitle' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    await ensure($, await $.session.id())
    const word = arg.toLowerCase()
    if (word === 'off') {
      await update($, state, s => ({ ...s, isOff: true }))
      return { text: await report($) }
    }
    if (word === 'on') {
      // Take the current name as the base, so the next prompt does not pin it again.
      await update($, state, s => {
        const base = s.lastSeen ?? s.lastSet
        return { ...s, isOff: false, pinned: false, lastSet: base, nextAt: base ? later(s.turns) : cfg.first }
      })
      await save($)
      return { text: await report($) }
    }
    if (word === 'status') return { text: await report($) }
    return { text: await nameNow($, arg || undefined) }
  })

  on('turn.complete', async ($, e, next) => {
    if (isInteractive && e.agentId === undefined && e.reason === 'answer') {
      try {
        await update($, state, s => ({ ...s, turns: s.turns + 1 }))
        // From a timer, so the fork is not tied to this turn and the turn ends at once.
        if (due(await read($, state)) && !inFlight) $.clock.after(0, () => void check($))
      } catch {
        // Never let bookkeeping break the turn it rides on.
      }
    }
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    let name: string | undefined
    if (isInteractive) {
      try {
        await ensure($, e.session_id)
        name = await apply($, e.session_title || null)
      } catch {
        // Never let bookkeeping break the prompt it rides on.
      }
    }
    const result = await next(e)
    return name ? { ...result, sessionTitle: name } : result
  })

  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) await update($, state, s => ({ ...s, compacted: true }))
    return next(e)
  })
}
