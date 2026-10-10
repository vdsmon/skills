import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase, Wrap } from '../types'

const AUTO_COMPACT_AT = '967k'

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

async function later($: EngineInterface) {
  await update($, wrap, w => ({
    ...w,
    phase: 'idle',
    payload: null,
    prepKind: null,
    line: w.phase === 'urgent' ? w.line : (w.tokens ?? cfg.start) + cfg.step,
  }))
}

export const register: Register = (on, options) => {
  cfg.start = tokensOf(options.startTokens, 500_000)
  cfg.step = tokensOf(options.stepTokens, 100_000)
  cfg.urgent = tokensOf(options.urgentTokens, 920_000)

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && COMMIT.test(e.command)) isCommitSeen = true
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (isInteractive && e.agentId === undefined && e.reason === 'answer') {
      try {
        await onAnswer($)
      } catch {
        // Fails silent: a missed cue comes back on the next turn.
      }
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const r = await next(e)
    if (r.skip === undefined && e.trigger !== 'precompute') await reset($)
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const w = await read($, wrap)
    if (e.props.hasSurvey || e.props.isWorking || e.props.view.agentId !== undefined) return next(e)
    if (w.phase !== 'cue' && w.phase !== 'urgent') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const size = w.tokens === null ? 'This session' : `${formatTokens(w.tokens)} tokens`
    const text =
      w.phase === 'urgent'
        ? `${size} · auto-compact runs at ${AUTO_COMPACT_AT}, with no audit`
        : `${size} · good moment to wrap up`
    return (
      <Box key="wrap-up" flexDirection="row" gap={1}>
        <Text color={w.phase === 'urgent' ? 'warning' : undefined}>
          {text}
        </Text>
        <Button key="compact" label="Compact" onPress={() => undefined} />
        <Button key="handoff" label="Hand off" onPress={() => undefined} />
        <Button key="later" label="Later" onPress={() => later($)} />
      </Box>
    )
  })
}
