import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Park, Reading, Seen, Window, WindowKind } from '../types'

const warned = atom({ plugin: 'cc-pitstop', key: 'warned' } as const, {})
const seen = atom({ plugin: 'cc-pitstop', key: 'seen' } as const, null)
const overrideUntil = atom({ plugin: 'cc-pitstop', key: 'overrideUntil' } as const, 0)
const isOff = atom({ plugin: 'cc-pitstop', key: 'isOff' } as const, false)

const LABEL: Record<WindowKind, string> = { five_hour: '5-hour', seven_day: 'weekly' }
const RESUME_BUFFER_MS = 60_000
// One pool for all subagents of a park, so a workflow that keeps spawning cannot keep spending.
const SUBAGENT_POOL = 3

// Set from the plugin's options each time register runs.
const cfg = {
  warn: { five_hour: 90, seven_day: 96 } as Record<WindowKind, number>,
  park: { five_hour: 97, seven_day: 99 } as Record<WindowKind, number>,
  grace: 2,
}

// A -p run or an SDK session ends on its own; a resume timer must never hold it open.
let isInteractive = true
let resumeTimer: Timer | undefined
let resumeFor = 0

const GO = { go: true } as const
type Verdict = typeof GO | { go: false; text: string }

const clockTime = (ms: number, now: number) => {
  const d = new Date(ms)
  const hm = d.toTimeString().slice(0, 5)
  return ms - now > 20 * 3_600_000 ? `${d.toDateString().slice(0, 3)} ${hm}` : hm
}

const numberOr = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const windowsOf = (limits: readonly SessionRateLimit[]): Window[] =>
  limits.flatMap(l => {
    const resetsAt = l.resetsAt ? Date.parse(l.resetsAt) : Number.NaN
    return (l.kind === 'five_hour' || l.kind === 'seven_day') && Number.isFinite(resetsAt)
      ? [{ kind: l.kind, pct: l.percentUsed, resetsAt }]
      : []
  })

// The window that trips a level; for a park, the one that keeps us waiting longest.
const tripped = (windows: Window[], level: 'warn' | 'park') =>
  windows
    .filter(w => w.pct >= cfg[level][w.kind])
    .sort((a, b) => b.resetsAt - a.resetsAt)[0]

async function append($: EngineInterface, text: string, agentId?: string) {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] }, agentId })
  } catch {
    // A loop that already ended takes no note; the hard stop still holds.
  }
}

async function push($: EngineInterface, message: string) {
  try {
    await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' })
  } catch {
    // Claude Code skips it while you are at the terminal, or when pushes are off.
  }
}

// Called right after a request of this session: its usage is fresh, so it is
// the machine's newest reading.
async function record($: EngineInterface) {
  const windows = windowsOf((await $.session.usage()).rateLimits)
  if (windows.length) await $.store.set('reading', { at: await $.clock.now(), windows } satisfies Reading)
}

// The park every session obeys: from the newest reading, else one another
// session stored, until its window resets.
async function parkOf($: EngineInterface, now: number): Promise<Park | null> {
  const reading = (await $.store.get('reading')) as Reading | undefined
  const live = (reading?.windows ?? []).filter(w => w.resetsAt > now)
  const stored = (await $.store.get('park')) as Park | undefined
  const hit = tripped(live, 'park')
  if (hit) {
    const park: Park = { kind: hit.kind, pct: hit.pct, resetsAt: hit.resetsAt, at: now }
    if (stored?.resetsAt !== park.resetsAt || stored.pct !== park.pct) await $.store.set('park', park)
    return park
  }
  // Usage never drops inside a window, so a newer reading of the same window
  // under the park line means the park came from other thresholds: drop it.
  const same = live.find(w => w.kind === stored?.kind && w.resetsAt === stored.resetsAt)
  const isStale = stored && reading && same && reading.at >= stored.at && same.pct < cfg.park[same.kind]
  if (stored && stored.resetsAt > now && !isStale) return stored
  if (stored) await $.store.delete('park')
  return null
}

async function warnIfNeeded($: EngineInterface, now: number) {
  const reading = (await $.store.get('reading')) as Reading | undefined
  const live = (reading?.windows ?? []).filter(w => w.resetsAt > now)
  const hit = tripped(live, 'warn')
  if (!hit) return
  const done = await read($, warned)
  if (done[hit.kind] === hit.resetsAt) return
  await update($, warned, w => ({ ...w, [hit.kind]: hit.resetsAt }))
  const at = clockTime(hit.resetsAt, now)
  $.ui.toast(`pitstop: ${LABEL[hit.kind]} usage at ${hit.pct}%, pauses at ${cfg.park[hit.kind]}%`)
  await append(
    $,
    `[pitstop] Usage is at ${hit.pct}% of the ${LABEL[hit.kind]} window (it resets at ${at}; pitstop pauses every session at ${cfg.park[hit.kind]}%). Bring the current work to a clean stopping point soon: finish the step you are on and avoid starting large new work.`,
  )
}

function scheduleResume($: EngineInterface, resetsAt: number, now: number) {
  if (!isInteractive || (resumeTimer && resumeFor === resetsAt)) return
  resumeTimer?.cancel()
  resumeFor = resetsAt
  resumeTimer = $.clock.after(Math.max(0, resetsAt + RESUME_BUFFER_MS - now), () => void resume($, resetsAt))
}

async function resume($: EngineInterface, resetsAt: number) {
  resumeTimer = undefined
  const stored = (await $.store.get('park')) as Park | undefined
  if (stored?.resetsAt === resetsAt) await $.store.delete('park')
  const s = await read($, seen)
  await update($, seen, () => null)
  const at = clockTime(resetsAt, await $.clock.now())
  if (s?.resetsAt === resetsAt && s.interrupted && !(await read($, isOff))) {
    await $.prompt.submit({ text: `[pitstop] The usage window reset at ${at}. Continue the work that was paused.` })
    await push($, `Usage window reset at ${at}: resuming the paused session.`)
  } else {
    $.ui.toast(`pitstop: the usage window reset at ${at}`)
  }
}

async function judge($: EngineInterface, agentId: string | undefined): Promise<Verdict> {
  if (await read($, isOff)) return GO
  const now = await $.clock.now()
  const park = await parkOf($, now)
  if (!park) {
    if (agentId === undefined) await warnIfNeeded($, now)
    return GO
  }
  if ((await read($, overrideUntil)) >= park.resetsAt) return GO

  const at = clockTime(park.resetsAt, now)
  const label = LABEL[park.kind]
  const prev = await read($, seen)
  const isNew = prev?.resetsAt !== park.resetsAt
  const s: Seen = isNew
    ? { resetsAt: park.resetsAt, grace: { main: cfg.grace + 1, subagents: SUBAGENT_POOL }, noted: [], interrupted: false }
    : { ...prev, grace: { ...prev.grace }, noted: [...(prev.noted ?? [])] }
  if (isNew) {
    scheduleResume($, park.resetsAt, now)
    $.ui.toast(`pitstop: ${label} usage at ${park.pct}%, pausing until ${at}`)
    await push($, `Claude Code paused: ${label} usage at ${park.pct}%. Resumes at ${at}.`)
  }

  // The main thread's count has one extra: a note reaches the model from the
  // loop's next request, not the one in flight.
  const key = agentId === undefined ? 'main' : 'subagents'
  const loop = agentId ?? 'main'
  if (!s.noted.includes(loop)) {
    s.noted.push(loop)
    await append(
      $,
      agentId === undefined
        ? `[pitstop] STOP: usage is at ${park.pct}% of the ${label} window. Pitstop pauses this session after ${cfg.grace} more requests and resumes it after the reset at ${at}. Use them to save state: commit or write a short note of where you are, stop any background job that calls the API, then end your turn. Do not start new work.`
        : `[pitstop] STOP: usage is at ${park.pct}% of the ${label} window. Finish this step and return what you have now. Do not start new work or spawn agents.`,
      agentId,
    )
  }
  const left = s.grace[key] ?? 0
  if (left > 0) {
    s.grace[key] = left - 1
    await update($, seen, () => s)
    return GO
  }
  await update($, seen, () => ({ ...s, interrupted: true }))
  return {
    go: false,
    text: `pitstop: paused. ${label} usage is at ${park.pct}%. It resets at ${at}, and this session resumes on its own then. /pitstop go continues now.`,
  }
}

async function report($: EngineInterface, headline?: string) {
  const now = await $.clock.now()
  const reading = (await $.store.get('reading')) as Reading | undefined
  const live = (reading?.windows ?? []).filter(w => w.resetsAt > now)
  const park = await parkOf($, now)
  const state = headline
    ? headline
    : (await read($, isOff))
      ? 'Pitstop is off in this session.'
      : !park
        ? 'Running. No pause in force.'
        : (await read($, overrideUntil)) >= park.resetsAt
          ? `Paused for other sessions, but this one continues (/pitstop go) until ${clockTime(park.resetsAt, now)}.`
          : `Paused until ${clockTime(park.resetsAt, now)}: ${LABEL[park.kind]} usage is at ${park.pct}%.`
  const windows = live.length
    ? live.map(w => `- ${LABEL[w.kind]}: ${w.pct}% used, resets ${clockTime(w.resetsAt, now)}. Warns at ${cfg.warn[w.kind]}%, pauses at ${cfg.park[w.kind]}%.`)
    : ['- No usage reading yet. One arrives with the next request.']
  return [state, windows.join('\n'), '`/pitstop go` keeps this session working through a pause. `/pitstop off` and `/pitstop on` switch pitstop for this session.'].join('\n\n')
}

export const register: Register = (on, options) => {
  cfg.warn = { five_hour: numberOr(options.warn5h, 90), seven_day: numberOr(options.warnWeekly, 96) }
  cfg.park = { five_hour: numberOr(options.park5h, 97), seven_day: numberOr(options.parkWeekly, 99) }
  cfg.grace = Math.max(0, Math.round(numberOr(options.graceRequests, 2)))

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'pitstop',
      description: 'Shows usage and whether a pause is in force; go keeps working through a pause, off and on switch it for this session.',
      argumentHint: '[go|off|on]',
    })
    const now = await $.clock.now()
    const park = (await $.store.get('park')) as Park | undefined
    if (park && park.resetsAt > now) scheduleResume($, park.resetsAt, now)
    return next(e)
  })

  on('command.run', { command: 'pitstop' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOff, () => arg === 'off')
    } else if (arg === 'go') {
      const park = await parkOf($, await $.clock.now())
      if (!park) return { text: 'Nothing is paused.' }
      await update($, overrideUntil, () => park.resetsAt)
      return { text: await report($, `Continuing. Pitstop will not pause this session again before the ${LABEL[park.kind]} window resets at ${clockTime(park.resetsAt, await $.clock.now())}.`) }
    } else if (arg !== '' && arg !== 'status') {
      return { text: `Unknown argument "${arg}". Use /pitstop, /pitstop go, /pitstop off or /pitstop on.` }
    }
    return { text: await report($) }
  })

  on('session.measure', async ($, e, next) => {
    try {
      if (e.changed.includes('rateLimits')) await record($)
    } catch {
      // A missed reading is taken again after the next request.
    }
    return next(e)
  })

  // Every request, main thread and subagents, passes here: the one place a park is enforced.
  on('turn.step', async function* ($, e, next) {
    let verdict: Verdict = GO
    try {
      verdict = await judge($, e.agentId)
    } catch {
      // Fail open: a broken guard must never stop work it cannot explain.
    }
    if (verdict.go) {
      const result = yield* next(e)
      try {
        if (result.usage) await record($)
      } catch {
        // Same: the next request records again.
      }
      return result
    }
    yield { kind: 'text' as const, index: 0, text: verdict.text }
    return { turnId: e.turnId, index: e.index, answer: verdict.text, toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
}
