import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Payload, Phase, PrepKind, Wrap } from '../types'

const AUTO_COMPACT_AT = '967k'
const TOOL = 'ready'
const TOOL_NAME = `mcp__cc-wrap-up__${TOOL}`
const SKILL: Record<PrepKind, string> = { compact: 'prep-compact', handoff: 'prep-exit' }

const IDLE: Wrap = {
  phase: 'idle',
  line: null,
  tokens: null,
  payload: null,
  prepKind: null,
  isOff: false,
  isNotified: false,
}

const wrap = atom({ plugin: 'cc-wrap-up', key: 'wrap' } as const, IDLE)

// Set from the plugin's options each time register runs.
const cfg = { start: 500_000, step: 100_000, urgent: 920_000 }

// A -p run or an SDK session has nobody to press a button.
let isInteractive = true

// A commit landed since the last answered main-thread turn.
let isCommitSeen = false

const BUSY: readonly Phase[] = ['prepping', 'ready-compact', 'ready-handoff']
const COMMIT = /\bgit\b[^\n;&|]*\bcommit\b/

const tokensOf = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const lineOf = (w: Wrap) => w.line ?? cfg.start

/** Whether deciding this turn needs to know if it ended at a seam. */
function needsSeam(w: Wrap, tokens: number) {
  return (
    !w.isOff &&
    !BUSY.includes(w.phase) &&
    w.phase !== 'cue' &&
    w.phase !== 'urgent' &&
    tokens < cfg.urgent &&
    tokens >= lineOf(w) &&
    tokens < lineOf(w) + cfg.step
  )
}

/** The cue rules, applied after an answered main-thread turn. */
function decide(w: Wrap, tokens: number, isSeam: boolean): { next: Wrap; isNotify: boolean } {
  const seen = { ...w, tokens }
  if (w.isOff || BUSY.includes(w.phase)) return { next: seen, isNotify: false }
  if (tokens >= cfg.urgent) {
    if (w.phase === 'urgent') return { next: seen, isNotify: false }
    return { next: { ...seen, phase: 'urgent', isNotified: true }, isNotify: !w.isNotified }
  }
  const below = { ...seen, isNotified: false }
  if (w.phase === 'cue' || w.phase === 'urgent') return { next: below, isNotify: false }
  const line = lineOf(w)
  if (tokens < line) return { next: { ...below, phase: 'idle' }, isNotify: false }
  if (tokens >= line + cfg.step || isSeam) return { next: { ...below, phase: 'cue' }, isNotify: false }
  return { next: { ...below, phase: 'armed' }, isNotify: false }
}

async function isTreeClean($: EngineInterface) {
  try {
    const r = await $.process.run(['git', 'status', '--porcelain'])
    return r.exitCode === 0 && r.stdout.trim() === ''
  } catch {
    return false
  }
}

async function onAnswer($: EngineInterface) {
  const isCommit = isCommitSeen
  isCommitSeen = false
  const tokens = (await $.session.usage()).context.tokens
  // No figure yet (a new or just-compacted session): stay silent, the next turn checks again.
  if (tokens === undefined) return
  const w = await read($, wrap)
  const isSeam = needsSeam(w, tokens) && (isCommit || (await isTreeClean($)))
  const { next, isNotify } = decide(w, tokens, isSeam)
  await update($, wrap, () => next)
  if (isNotify) {
    await $.ui.notify(`${formatTokens(tokens)} tokens: wrap up before auto-compact runs at ${AUTO_COMPACT_AT}.`)
  }
}

/** Back to the start: after a compaction, a /clear, or a finished wrap-up. */
async function reset($: EngineInterface) {
  await update($, wrap, w => ({ ...IDLE, isOff: w.isOff }))
}

/** Not now: hide the band and look again one step past the current size. */
const dismissed = (w: Wrap): Wrap => ({
  ...w,
  phase: 'idle',
  payload: null,
  prepKind: null,
  line: w.phase === 'urgent' ? w.line : (w.tokens ?? cfg.start) + cfg.step,
})

async function later($: EngineInterface) {
  await update($, wrap, dismissed)
}

/** Which prep skill a command name runs, if any (plugin skills are namespaced). */
function prepKindOf(command: string): PrepKind | null {
  for (const kind of ['compact', 'handoff'] as const) {
    if (command === SKILL[kind] || command.endsWith(`:${SKILL[kind]}`)) return kind
  }
  return null
}

/** The installed command that runs the prep skill of this kind, if any. */
async function findPrep($: EngineInterface, kind: PrepKind) {
  try {
    return (await $.command.list()).find(c => prepKindOf(c.name) === kind)?.name ?? null
  } catch {
    return null
  }
}

async function startPrep($: EngineInterface, kind: PrepKind) {
  const command = await findPrep($, kind)
  if (command === null) {
    if (kind === 'compact') await compactNow($, undefined, undefined)
    return
  }
  // The mod's own command.run never reaches its own hook, so mark the prep here.
  await update($, wrap, w => ({ ...w, phase: 'prepping', prepKind: kind, payload: null }))
  try {
    await $.command.run({ command })
  } catch (err) {
    await update($, wrap, dismissed)
    await $.ui.toast(`${SKILL[kind]} did not start: ${String(err)}`)
  }
}

/** Compacts with the message, then sends the follow-up as the user's next prompt. */
async function compactNow($: EngineInterface, message: string | undefined, followUp: string | undefined) {
  let r: Awaited<ReturnType<EngineInterface['session']['compact']>>
  try {
    r = await $.session.compact(message === undefined ? {} : { instructions: message })
  } catch (err) {
    await $.ui.toast(`Compaction did not run: ${String(err)}`)
    return
  }
  if (r.skip !== undefined) {
    await $.ui.toast(`Compaction skipped: ${r.skip}`)
    return
  }
  // The mod's own compaction never reaches its own session.compact hook.
  await reset($)
  if (followUp !== undefined) void $.prompt.submit({ text: followUp, asUser: true })
}

/** /clear, then the resume prompt as the new session's first message. */
async function freshSession($: EngineInterface, resumePrompt: string) {
  try {
    await $.command.run({ command: 'clear' })
  } catch (err) {
    await $.ui.toast(`/clear did not run: ${String(err)}`)
    return
  }
  // The module lives across /clear (experiment #21), so this closure still holds the prompt.
  await reset($)
  void $.prompt.submit({ text: resumePrompt, asUser: true })
}

async function copyPrompt($: EngineInterface, text: string, surface: RenderSurface) {
  const r = await $.ui.copy({ text, surface })
  await $.ui.toast(
    r.isCopied ? 'Copied the resume prompt.' : `Copy failed (${r.reason}); the resume prompt is also in the transcript.`,
  )
}

const TOOL_SPEC = {
  name: TOOL,
  description:
    'Hands the result of prep-compact or prep-exit to the wrap-up band, which offers the user to compact or to deliver the resume prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { enum: ['compact', 'handoff'] },
      message: { type: 'string', description: 'compact: the focus message, without the /compact prefix' },
      followUp: { type: 'string', description: 'compact: the next action, sent as a prompt after compaction' },
      resumePrompt: { type: 'string', description: 'handoff: the first message for the next session' },
      handoffPath: { type: 'string', description: 'handoff: absolute path of HANDOFF.md' },
      openQuestion: { type: 'boolean', description: 'true when a question was held back for the user' },
    },
    required: ['kind'],
  },
  isDeferred: true,
}

/** The tool's input as a payload, or why it is refused. */
function payloadOf(e: Record<string, unknown>): Payload | string {
  const text = (k: string) => (typeof e[k] === 'string' && (e[k] as string).trim() !== '' ? (e[k] as string) : '')
  const missing = (keys: string[]) => keys.filter(k => text(k) === '')
  const openQuestion = e.openQuestion === true
  if (e.kind === 'compact') {
    const gone = missing(['message', 'followUp'])
    if (gone.length > 0) return `missing ${gone.join(' and ')}`
    return { kind: 'compact', message: text('message').replace(/^\/compact\s+/, ''), followUp: text('followUp'), openQuestion }
  }
  if (e.kind === 'handoff') {
    const gone = missing(['resumePrompt', 'handoffPath'])
    if (gone.length > 0) return `missing ${gone.join(' and ')}`
    return { kind: 'handoff', resumePrompt: text('resumePrompt'), handoffPath: text('handoffPath'), openQuestion }
  }
  return 'kind must be compact or handoff'
}

async function onTurnEnd($: EngineInterface, reason: string) {
  const w = await read($, wrap)
  if (w.phase === 'prepping') {
    await update($, wrap, cur => (cur.phase === 'prepping' ? dismissed(cur) : cur))
    const skill = SKILL[w.prepKind ?? 'compact']
    await $.ui.toast(`${skill} finished without handing its result to wrap-up; use the printed blocks.`)
  }
  if (reason === 'answer') await onAnswer($)
}

export const register: Register = (on, options) => {
  cfg.start = tokensOf(options.startTokens, 500_000)
  cfg.step = tokensOf(options.stepTokens, 100_000)
  cfg.urgent = tokensOf(options.urgentTokens, 920_000)

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.tool.register(TOOL_SPEC)
    return next(e)
  })

  on('tool.call', { tool: TOOL_NAME }, async ($, e) => {
    const payload = payloadOf(e)
    if (typeof payload === 'string') {
      return { deny: `cc-wrap-up: ${payload}. Nothing was handed over; print your usual blocks.` }
    }
    await update($, wrap, w => ({
      ...w,
      phase: payload.kind === 'compact' ? 'ready-compact' : 'ready-handoff',
      payload,
      prepKind: null,
    }))
    return { result: 'The wrap-up band now offers this to the user. Print your usual blocks too.' }
  }).catch(() => ({ deny: 'cc-wrap-up failed to take the result. Print your usual blocks.' }))

  // A prep the user typed: show it as running, so a prep that hands nothing over is noticed.
  on('command.run', async ($, e, next) => {
    const kind = prepKindOf(e.command)
    if (kind !== null) await update($, wrap, w => ({ ...w, phase: 'prepping', prepKind: kind, payload: null }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A ready result describes the session when the skill ran. The user's own next
  // words make it stale, except the answer to a question the skill held back.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      await update($, wrap, w => {
        if (w.payload === null || (w.phase !== 'ready-compact' && w.phase !== 'ready-handoff')) return w
        if (w.payload.openQuestion) return { ...w, payload: { ...w.payload, openQuestion: false } }
        return dismissed(w)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && COMMIT.test(e.command)) isCommitSeen = true
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (isInteractive && e.agentId === undefined) {
      try {
        await onTurnEnd($, e.reason)
      } catch {
        // Fails silent: a missed cue comes back on the next turn.
      }
    }
    return next(e)
  })

  // The user's own /compact (after Edit, or typed): it gets the pending message when
  // it has none, and the follow-up goes once it stands. The mod's own compaction never
  // reaches this hook.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const w = await read($, wrap)
    const pending = w.phase === 'ready-compact' && w.payload?.kind === 'compact' ? w.payload : null
    if (e.trigger === 'precompute') {
      // A summary computed now, without the prep's message, could stand in for the real one.
      return w.phase === 'prepping' || pending !== null ? { skip: 'cc-wrap-up: a prep result is pending' } : next(e)
    }
    const isFilled = e.trigger === 'manual' && pending !== null && (e.instructions ?? '').trim() === ''
    const r = await next(isFilled ? { ...e, instructions: pending.message } : e)
    if (r.skip !== undefined) return r
    await reset($)
    // Not awaited: the follow-up's turn starts only after this compaction finishes.
    if (e.trigger === 'manual' && pending !== null) void $.prompt.submit({ text: pending.followUp, asUser: true })
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const w = await read($, wrap)
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    // While a turn runs the band would offer what cannot run yet; a prep shows as running.
    if (e.props.isWorking && w.phase !== 'prepping') return next(e)
    if (w.phase === 'idle' || w.phase === 'armed') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const row = (line: string, color: 'warning' | undefined, ...actions: ReturnType<typeof Button>[]) => {
      const note = w.payload?.openQuestion ? (
        <Text dimColor>1 question still open above; answer it before you go on.</Text>
      ) : null
      return (
        <Box key="wrap-up" flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={color} wrap="truncate-end">
              {line}
            </Text>
            {actions}
          </Box>
          {note}
        </Box>
      )
    }

    if (w.phase === 'prepping') {
      return row(w.prepKind === 'handoff' ? 'Preparing the handoff…' : 'Preparing to compact…', undefined)
    }
    if (w.phase === 'ready-compact' && w.payload?.kind === 'compact') {
      const { message, followUp } = w.payload
      return row(
        `Compact message ready: ${message.split('\n')[0]}`,
        undefined,
        <Button key="compact-now" label="Compact now" variant="primary" onPress={() => compactNow($, message, followUp)} />,
        <Button key="edit" label="Edit" onPress={() => $.prompt.fill({ text: `/compact ${message}` })} />,
        <Button key="not-now" label="Not now" onPress={() => later($)} />,
      )
    }
    if (w.phase === 'ready-handoff' && w.payload?.kind === 'handoff') {
      const { resumePrompt } = w.payload
      return row(
        `Handoff at ${w.payload.handoffPath}`,
        undefined,
        <Button key="fresh" label="Fresh session here" variant="primary" onPress={() => freshSession($, resumePrompt)} />,
        <Button key="copy" label="Copy prompt" onPress={p => copyPrompt($, resumePrompt, p.surface)} />,
        <Button key="done" label="Done" onPress={() => later($)} />,
      )
    }
    if (w.phase !== 'cue' && w.phase !== 'urgent') return next(e)

    const size = w.tokens === null ? 'This session' : `${formatTokens(w.tokens)} tokens`
    const hasCompactPrep = (await findPrep($, 'compact')) !== null
    const hasHandoffPrep = (await findPrep($, 'handoff')) !== null
    const handoff = hasHandoffPrep ? [<Button key="handoff" label="Hand off" onPress={() => startPrep($, 'handoff')} />] : []
    return row(
      w.phase === 'urgent'
        ? `${size} · auto-compact runs at ${AUTO_COMPACT_AT}, with no audit`
        : `${size} · good moment to wrap up`,
      w.phase === 'urgent' ? 'warning' : undefined,
      <Button key="compact" label={hasCompactPrep ? 'Compact' : 'Compact now'} onPress={() => startPrep($, 'compact')} />,
      ...handoff,
      <Button key="later" label="Later" onPress={() => later($)} />,
    )
  })
}
