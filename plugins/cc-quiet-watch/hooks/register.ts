import type { EngineInterface, Register, Timer } from 'claude-code'

import type { News, Probe, Status, Watch } from '../types'

const MIN = 60_000
const MAX_WATCHES = 10
const MAX_ERRORS = 3
const OUTPUT_CAP = 6000
const JUDGE_MODEL = 'claude-haiku-5-5'
const JUDGE_SYSTEM =
  'You judge a watched job from the latest output of its status check. Reply with JSON only, no prose: ' +
  '{"status": "running" | "done" | "failed" | "needs_you", "line": "<one short line a person reads at a glance, with the key numbers>"}. ' +
  '"done": the goal is met. "failed": the goal can no longer be met (the job errored, was aborted, or the goal\'s failure condition holds). ' +
  '"needs_you": the job waits for a human decision or input. Otherwise "running".'
const TRACK_SYSTEM =
  'You judge changed output from a tracked source (a thread, a channel, a pull request, a page) against what the user wants to hear about. Reply with JSON only, no prose: ' +
  '{"status": "quiet" | "tell", "line": "<one short line a person reads at a glance: who, what>"}. ' +
  '"tell": the change holds something the goal says the user wants to hear about. ' +
  '"quiet": anything else (edits, reactions, noise, nothing new that the goal asks for).'

// One timer per watch, rebuilt from $.store on every session start or reload.
const timers = new Map<string, Timer>()
let isInteractive = true

const keyOf = async ($: EngineInterface) => `watches:${await $.session.id()}`

async function load($: EngineInterface): Promise<Watch[]> {
  // Watches saved by 1.0.0 have no `keep`: they are job watches.
  const saved = ((await $.store.get(await keyOf($))) as Array<Omit<Watch, 'keep'> & { keep?: boolean }> | undefined) ?? []
  return saved.map(w => ({ ...w, keep: w.keep ?? false }))
}

async function save($: EngineInterface, watches: Watch[]) {
  await $.store.set(await keyOf($), watches)
}

async function patch($: EngineInterface, name: string, fn: (w: Watch) => Watch | null) {
  const watches = await load($)
  const next = watches.flatMap(w => (w.name === name ? (fn(w) ?? []) : [w]))
  await save($, next)
  return next.find(w => w.name === name) ?? null
}

// Timestamps and durations change on every check; they must not count as change.
const normalize = (text: string) =>
  text
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
    .replace(/"(updatedAt|lastSeen|now|elapsed\w*|duration\w*|age\w*)"\s*:\s*[^,}\]]+/gi, '"$1":<v>')

const hashOf = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return String(h >>> 0)
}

const cap = (text: string, n = OUTPUT_CAP) =>
  text.length <= n ? text : `${text.slice(0, n / 2)}\n[...]\n${text.slice(-n / 2)}`

const clockTime = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

const interval = (ms: number) => (ms < MIN ? `${Math.round(ms / 1000)} s` : `${ms / MIN} min`)

const describe = (p: Probe) => (p.kind === 'mcp' ? `${p.server} ${p.tool} ${JSON.stringify(p.args)}` : p.argv.join(' '))

async function runProbe($: EngineInterface, p: Probe): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    if (p.kind === 'mcp') {
      const r = await $.mcp.call(p.server, p.tool, p.args)
      const text = r.content.map(b => ('text' in b && typeof b.text === 'string' ? b.text : JSON.stringify(b))).join('\n')
      return r.isError ? { ok: false, error: cap(text, 600) } : { ok: true, text: cap(text) }
    }
    const r = await $.process.run(p.argv, { timeoutMs: 60_000 })
    const text = `exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\nstderr:\n${r.stderr}` : ''}`
    return { ok: true, text: cap(text) }
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 600) }
  }
}

async function judge($: EngineInterface, w: Pick<Watch, 'goal' | 'line' | 'keep'>, output: string): Promise<{ status: Status | News; line: string } | null> {
  const r = await $.model.complete({
    model: JUDGE_MODEL,
    effort: 'low',
    maxTokens: 1024,
    timeoutMs: 60_000,
    system: w.keep ? TRACK_SYSTEM : JUDGE_SYSTEM,
    prompt: `Goal: ${w.goal}\nPrevious line: ${w.line || '(none yet)'}\nLatest output:\n${output}`,
  })
  if (!r.isAnswered) return null
  try {
    const v = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)) as { status?: string; line?: string }
    const statuses: readonly (Status | News)[] = w.keep ? ['quiet', 'tell'] : ['running', 'done', 'failed', 'needs_you']
    const status = statuses.find(s => s === v.status)
    return status && v.line ? { status, line: v.line.trim().replace(/[.!\s]+$/, '').slice(0, 300) } : null
  } catch {
    return null
  }
}

async function send($: EngineInterface, w: Watch, state: string, line: string, output: string) {
  const parts = [
    `[quiet-watch] "${w.name}" ${w.keep ? '' : 'is '}${state}: ${line}`,
    `Goal: ${w.goal}`,
    w.onWake ? `What to do now: ${w.onWake}` : '',
    `Check: ${describe(w.probe)}`,
    output ? `Latest output (trimmed):\n${cap(output, 2000)}` : '',
    w.keep ? `This tracker keeps running; only the user stops it (/watches stop ${w.name}).` : '',
  ]
  try {
    await $.prompt.submit({ text: parts.filter(Boolean).join('\n\n') })
    return true
  } catch {
    return false
  }
}

async function reschedule($: EngineInterface, name: string, now: number, fn: (w: Watch) => Watch = w => w) {
  const next = await patch($, name, x => ({ ...fn(x), nextAt: now + x.everyMs }))
  if (next) schedule($, next, now)
}

// A job watch ends once the session hears about it.
async function wake($: EngineInterface, w: Watch, state: string, line: string, output: string) {
  timers.get(w.name)?.cancel()
  timers.delete(w.name)
  if (await send($, w, state, line, output)) await patch($, w.name, () => null)
  // Not sent: keep the watch, and try again at the next check.
  else await reschedule($, w.name, await $.clock.now())
}

// A tracker goes on after telling; `after` records what was told. Not sent:
// leave the tracker as it was, so the next check tells it again.
async function tell($: EngineInterface, w: Watch, now: number, state: string, line: string, output: string, after: (x: Watch) => Watch) {
  const sent = await send($, w, state, line, output)
  await reschedule($, w.name, now, sent ? after : undefined)
}

function schedule($: EngineInterface, w: Watch, now: number) {
  timers.get(w.name)?.cancel()
  timers.set(w.name, $.clock.after(Math.max(0, w.nextAt - now), () => void check($, w.name)))
}

async function check($: EngineInterface, name: string) {
  timers.delete(name)
  const w = (await load($)).find(x => x.name === name)
  if (!w) return
  const now = await $.clock.now()
  const out = await runProbe($, w.probe)
  if (!out.ok) {
    if (w.keep) {
      // Tell once at the third failure in a row; a success resets the count.
      const failed = (x: Watch) => ({ ...x, errors: x.errors + 1 })
      if (w.errors + 1 !== MAX_ERRORS) return reschedule($, name, now, failed)
      return tell($, w, now, 'cannot be checked', `the check failed ${MAX_ERRORS} times in a row: ${out.error}`, '', failed)
    }
    if (w.errors + 1 >= MAX_ERRORS) return wake($, w, 'not checkable any more', `the check failed ${MAX_ERRORS} times in a row: ${out.error}`, '')
    const next = await patch($, name, x => ({ ...x, errors: x.errors + 1, nextAt: now + x.everyMs }))
    if (next) schedule($, next, now)
    return
  }
  const hash = hashOf(normalize(out.text))
  if (hash === w.lastHash) {
    if (w.stuckAfterMs > 0 && now - w.lastChangeAt >= w.stuckAfterMs) {
      return wake($, w, 'stuck', `no change since ${clockTime(w.lastChangeAt)} (${w.line})`, out.text)
    }
    const next = await patch($, name, x => ({ ...x, errors: 0, nextAt: now + x.everyMs }))
    if (next) schedule($, next, now)
    return
  }
  const verdict = await judge($, w, out.text)
  const told = (x: Watch) => ({ ...x, errors: 0, judgeErrors: 0, lastHash: hash, lastChangeAt: now, line: verdict?.line ?? x.line })
  // No verdict: keep the old hash, so the next check judges this output again,
  // and hand the output to Opus once the judge failed too often.
  if (!verdict && w.judgeErrors + 1 >= MAX_ERRORS) {
    const [state, line] = ['changed, but could not be judged', `the small model failed ${MAX_ERRORS} times; read the output below`]
    return w.keep ? tell($, w, now, state, line, out.text, told) : wake($, w, state, line, out.text)
  }
  if (w.keep && verdict?.status === 'tell') return tell($, w, now, 'has news', verdict.line, out.text, told)
  if (!w.keep && verdict && verdict.status !== 'running') {
    return wake($, w, verdict.status === 'needs_you' ? 'waiting for you' : verdict.status, verdict.line, out.text)
  }
  const next = await patch($, name, x =>
    verdict
      ? { ...x, errors: 0, judgeErrors: 0, lastHash: hash, lastChangeAt: now, line: verdict.line, nextAt: now + x.everyMs }
      : { ...x, errors: 0, judgeErrors: (x.judgeErrors ?? 0) + 1, nextAt: now + x.everyMs },
  )
  if (next) schedule($, next, now)
}

type ArmInput = {
  name?: string
  server?: string
  // Not `tool`: a tool's arguments arrive beside the envelope's own `tool` field.
  mcpTool?: string
  args?: Record<string, unknown>
  command?: string[]
  goal?: string
  everyMinutes?: number
  stuckAfterMinutes?: number
  onWake?: string
  keep?: boolean
}

async function arm($: EngineInterface, input: ArmInput): Promise<{ result: string } | { deny: string }> {
  const name = (input.name ?? '').trim().slice(0, 60)
  if (!name) return { deny: 'Give the watch a short name.' }
  const keep = input.keep === true
  if (!input.goal?.trim()) return { deny: keep ? 'Say in words what news to wake on (goal).' : 'Say in words what done and failed look like (goal).' }
  const probe: Probe | null =
    input.server && input.mcpTool
      ? { kind: 'mcp', server: input.server, tool: input.mcpTool, args: input.args ?? {} }
      : Array.isArray(input.command) && input.command.length > 0
        ? { kind: 'argv', argv: input.command.map(String) }
        : null
  if (!probe) return { deny: 'Give a check: either server + mcpTool (+ args) for an MCP read tool, or command as an argv array.' }
  const watches = await load($)
  if (!watches.some(w => w.name === name) && watches.length >= MAX_WATCHES) {
    return { deny: `This session already has ${MAX_WATCHES} watches. Stop one first (unwatch).` }
  }

  // Run the check once now, so a check that cannot run fails here, not quietly later.
  const out = await runProbe($, probe)
  if (!out.ok) {
    const rule = probe.kind === 'mcp' ? `mcp__${probe.server}__${probe.tool}` : ''
    const hint = /refused|permission|classifier|denied/i.test(out.error) && rule
      ? ` The mod's MCP calls need an allow rule: ask the user to add "${rule}" to permissions.allow in ~/.claude/settings.json, then arm again.`
      : ''
    return { deny: `The check failed when run once: ${out.error}${hint}` }
  }
  const everyMs = keep
    ? Math.round(Math.max(0.5, input.everyMinutes ?? 2) * MIN)
    : Math.max(2, Math.round(input.everyMinutes ?? 10)) * MIN
  const stuckAfterMs = !keep && input.stuckAfterMinutes ? Math.max(1, input.stuckAfterMinutes) * MIN : 0
  // A tracker takes what is there now as its baseline: only what comes after is news.
  const verdict = keep ? null : await judge($, { goal: input.goal, line: '', keep }, out.text)
  if (verdict && verdict.status !== 'running') {
    return { result: `Not armed: the job is already ${verdict.status}: ${verdict.line}` }
  }
  const now = await $.clock.now()
  const w: Watch = {
    name,
    probe,
    goal: input.goal.trim(),
    onWake: (input.onWake ?? '').trim(),
    keep,
    everyMs,
    stuckAfterMs,
    createdAt: now,
    nextAt: now + everyMs,
    lastHash: keep || verdict ? hashOf(normalize(out.text)) : '',
    lastChangeAt: now,
    line: verdict?.line ?? '',
    errors: 0,
    judgeErrors: 0,
  }
  await save($, [...watches.filter(x => x.name !== name), w])
  schedule($, w, now)
  if (keep) {
    return {
      result: `Tracking "${name}", checked every ${interval(everyMs)}. It wakes you when what the goal asks for happens, and keeps running until the user stops it with /watches stop ${name}. End your turn now; do not poll it yourself.`,
    }
  }
  return {
    result: `Watching "${name}"${w.line ? `: ${w.line}` : ''}. The mod checks every ${everyMs / MIN} min and judges only changed output. You get a new prompt only when it is done, failed, waiting for the user${stuckAfterMs ? ', stuck' : ''}, or the check keeps failing. End your turn now; do not poll it yourself.`,
  }
}

async function list($: EngineInterface) {
  const watches = await load($)
  if (!watches.length) return 'No watches in this session.'
  return watches
    .map(w => `- ${w.name}${w.keep ? ' (tracker)' : ''}: ${w.line || 'no reading yet'}. Every ${interval(w.everyMs)}, next check ${clockTime(w.nextAt)}.`)
    .join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    if (!isInteractive) return next(e)
    await $.tool.register({
      name: 'watch',
      description:
        'Watch a long job without waking this session for every check. Use it instead of CronCreate, Monitor or sleep loops when you wait for a pipeline run, batch, CI check or any job to finish. ' +
        'Give a read-only check (server + mcpTool + args for an MCP read tool, or command as an argv array that prints the current status) and the goal in words: what done and what failed look like. ' +
        'The mod runs the check every everyMinutes, and asks a small model to judge only when the output changed. You get a new prompt only when the job is done, failed, waiting for the user, stuck (stuckAfterMinutes), or the check keeps failing. ' +
        'onWake says what you should do then. Set keep for a tracker instead, when the user asks to track, follow or keep an eye on something. After arming, end your turn; do not poll. If arming fails, tell the user why (for a refused MCP call, which allow rule to add) and fall back to your usual way of waiting (CronCreate or Monitor).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short unique name, e.g. "qa-batch-74".' },
          server: { type: 'string', description: 'MCP server name for an MCP check, e.g. "revelo-pipelines".' },
          mcpTool: { type: 'string', description: 'MCP tool name on that server, e.g. "get_batch_run".' },
          args: { type: 'object', description: 'Arguments for the MCP tool.' },
          command: { type: 'array', items: { type: 'string' }, description: 'Command as argv, for a command check, e.g. ["gh", "pr", "checks", "57"].' },
          goal: { type: 'string', description: 'What done and failed look like, in words; for a tracker, what news to wake on.' },
          everyMinutes: { type: 'number', description: 'Minutes between checks; default 10, minimum 2. For a tracker: default 2, minimum 0.5.' },
          stuckAfterMinutes: { type: 'number', description: 'Wake as stuck if the output does not change for this long.' },
          onWake: { type: 'string', description: 'What to do when woken, e.g. "rerun the failed tasks".' },
          keep: {
            type: 'boolean',
            description:
              'true makes a tracker, for something with no end (a Slack thread or channel, a pull request\'s comments, a page): it wakes the session each time the goal\'s kind of news appears and runs until the user stops it.',
          },
        },
        required: ['name', 'goal'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'unwatch',
      description: 'Stop a watch this session armed, by name. Stop a tracker only when the user asks for it.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      isDeferred: false,
    })
    await $.command.register({
      name: 'watches',
      description: 'Lists this session\'s watches; stop <name> or check <name> acts on one.',
      argumentHint: '[stop|check <name>]',
    })
    const now = await $.clock.now()
    for (const w of await load($)) schedule($, w, now)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__cc-quiet-watch__watch' }, async ($, e) => arm($, e as unknown as ArmInput) as never)

  on('tool.call', { tool: 'mcp__cc-quiet-watch__unwatch' }, async ($, e) => {
    const name = String((e as unknown as { name?: string }).name ?? '')
    timers.get(name)?.cancel()
    timers.delete(name)
    const had = (await load($)).some(w => w.name === name)
    await patch($, name, () => null)
    return { result: had ? `Stopped watching "${name}".` : `No watch named "${name}".` } as never
  })

  on('command.run', { command: 'watches' }, async ($, e) => {
    const [verb, ...rest] = (e.args ?? '').trim().split(/\s+/)
    const name = rest.join(' ')
    if (verb === 'stop' && name) {
      timers.get(name)?.cancel()
      timers.delete(name)
      await patch($, name, () => null)
      return { text: `Stopped "${name}".\n\n${await list($)}` }
    }
    if (verb === 'check' && name) {
      await check($, name)
      return { text: await list($) }
    }
    return { text: await list($) }
  })
}
