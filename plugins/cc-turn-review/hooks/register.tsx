import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, ProcessRunResult, Register, RenderElement } from 'claude-code'

import type { Review } from '../types'
import {
  SYSTEM,
  capped,
  changedLines,
  errorText,
  fixMessage,
  foldersUp,
  parseFindings,
  pathsOf,
  plural,
  promptFor,
  slug,
  tilde,
  withoutLockfiles,
} from './review'

const COMMAND = 'turnreview'
const PANE = 'cc-turn-review'
const MODEL = 'claude-haiku-5-5'
const REVIEW_TOKENS = 4_000
const REVIEW_TIMEOUT_MS = 90_000
const GIT_TIMEOUT_MS = 10_000
const MAX_ASKS = 3
const STALE_DAYS = 7

const reviewAtom = atom({ plugin: 'cc-turn-review', key: 'review' } as const, null)
const isOffAtom = atom({ plugin: 'cc-turn-review', key: 'isOff' } as const, false)

type Repo = { top: string; gitDir: string; commonDir: string }
type Start = { repo: Repo; tree: string }

const cfg = { home: '', isInteractive: true }

/** The user's last prompts, oldest first: the ask the review judges against. */
let asks: string[] = []
/** The tree of each repo seen since the last answered turn, by its top folder; shared by parallel tool calls. */
let starts = new Map<string, Promise<Start | null>>()
const repoOfFolder = new Map<string, Repo | null>()
/** Repos whose snapshot failed or was too slow: left alone for the session. */
const skipped = new Set<string>()
/** Bumped by each turn start and each prompt the user sends: a review of an older turn shows no band. */
let generation = 0

// ------------------------------------------------------------------ git

async function privateDir($: EngineInterface, repo: Repo) {
  return `${cfg.home}/.claude/.cc-turn-review/${slug(await $.session.id())}/${slug(repo.top)}`
}

// The private index and object folder keep HEAD, the real index and .git/objects untouched.
async function git($: EngineInterface, repo: Repo, args: readonly string[]): Promise<ProcessRunResult> {
  const dir = await privateDir($, repo)
  return $.process.run(['git', '-c', 'core.quotepath=false', '-c', 'advice.addEmbeddedRepo=false', ...args], {
    cwd: repo.top,
    env: {
      GIT_OPTIONAL_LOCKS: '0',
      GIT_INDEX_FILE: `${dir}/index`,
      GIT_OBJECT_DIRECTORY: `${dir}/objects`,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: `${repo.commonDir}/objects`,
    },
    timeoutMs: GIT_TIMEOUT_MS,
  })
}

async function findRepo($: EngineInterface, path: string): Promise<Repo | null> {
  for (const dir of foldersUp(path)) {
    const known = repoOfFolder.get(dir)
    if (known !== undefined) return known
    let r: ProcessRunResult
    try {
      r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], {
        cwd: dir,
        timeoutMs: GIT_TIMEOUT_MS,
      })
    } catch {
      continue // not a folder (a file, or not made yet): ask the one above
    }
    const [top = '', gitDir = '', commonDir = ''] = r.exitCode === 0 ? r.stdout.split('\n').map(line => line.trim()) : []
    const repo = top !== '' && gitDir !== '' && commonDir !== '' && top !== cfg.home ? { top, gitDir, commonDir } : null
    repoOfFolder.set(dir, repo)
    return repo
  }
  return null
}

/** The tree of every file git does not ignore, as the working copy has it now. */
async function snapshot($: EngineInterface, repo: Repo): Promise<string> {
  const dir = await privateDir($, repo)
  await $.process.run(['mkdir', '-p', `${dir}/objects`])
  // Seeded from the real index each time, so tracked files stay tracked and git reuses its file stats.
  const copied = await $.process.run(['cp', `${repo.gitDir}/index`, `${dir}/index`])
  if (copied.exitCode !== 0) await $.process.run(['rm', '-f', `${dir}/index`])
  const added = await git($, repo, ['add', '-A', '--ignore-errors'])
  if (added.exitCode > 1) throw new Error(added.stderr.trim() || `git add exited ${added.exitCode}`)
  const written = await git($, repo, ['write-tree'])
  if (written.exitCode !== 0) throw new Error(written.stderr.trim() || 'git write-tree failed')
  return written.stdout.trim()
}

async function captureStart($: EngineInterface, repo: Repo): Promise<Start | null> {
  try {
    return { repo, tree: await snapshot($, repo) }
  } catch (error) {
    skip($, repo, error)
    return null
  }
}

function skip($: EngineInterface, repo: Repo, error: unknown) {
  skipped.add(repo.top)
  $.ui.log(`cc-turn-review: ${repo.top}: ${errorText(error)}`, { to: 'debug' })
  void $.ui.toast(`Turn review skips ${tilde(repo.top, cfg.home)} for this session: its snapshot failed or took over 10 s.`)
}

async function startFor($: EngineInterface, repo: Repo) {
  if (skipped.has(repo.top)) return
  if (!starts.has(repo.top)) starts.set(repo.top, captureStart($, repo))
  await starts.get(repo.top)
}

async function isActive($: EngineInterface) {
  return cfg.isInteractive && !(await read($, isOffAtom))
}

// --------------------------------------------------------------- review

/** The turn's diff in every repo it touched, with lockfile hunks left out. */
async function turnDiff($: EngineInterface, batch: ReadonlyMap<string, Promise<Start | null>>) {
  const parts: string[] = []
  const files: string[] = []
  for (const pending of batch.values()) {
    const start = await pending
    if (start === null) continue
    const { repo } = start
    let tree: string
    try {
      tree = await snapshot($, repo)
    } catch (error) {
      skip($, repo, error)
      continue
    }
    if (tree === start.tree) continue
    const label = tilde(repo.top, cfg.home)
    const [patch, names] = await Promise.all([
      git($, repo, ['diff-tree', '-r', '-p', '-M', '--no-color', '--no-ext-diff', '-U3', `--src-prefix=${label}/`, `--dst-prefix=${label}/`, start.tree, tree]),
      git($, repo, ['diff-tree', '-r', '-M', '--name-only', '-z', start.tree, tree]),
    ])
    if (patch.exitCode !== 0) {
      $.ui.log(`cc-turn-review: diff-tree in ${repo.top}: ${patch.stderr.trim()}`, { to: 'debug' })
      continue
    }
    parts.push(withoutLockfiles(patch.stdout.trim()))
    files.push(...names.stdout.split('\0').filter(name => name !== '').map(name => `${label}/${name}`))
  }
  return { diff: parts.join('\n'), files }
}

const whyNot = (reply: ModelCompleteResult) => {
  if (reply.isAnswered) return ''
  if (reply.reason === 'api-error') return reply.status === null ? `API error, ${reply.error}` : `API error ${reply.status}, ${reply.error}`
  return reply.reason === 'aborted' ? 'timed out' : 'empty reply'
}

async function review($: EngineInterface, batch: ReadonlyMap<string, Promise<Start | null>>, turnAsks: readonly string[], atGeneration: number) {
  const id = crypto.randomUUID()
  try {
    const { diff, files } = await turnDiff($, batch)
    const changed = changedLines(diff)
    if (changed === 0) return
    const base: Review = {
      id,
      status: 'running',
      files,
      changedLines: changed,
      findings: [],
      inputTokens: 0,
      outputTokens: 0,
      error: '',
      at: await $.clock.now(),
      isDismissed: generation !== atGeneration,
    }
    await update($, reviewAtom, () => base)
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: promptFor(turnAsks, capped(diff)),
      maxTokens: REVIEW_TOKENS,
      effort: 'low',
      timeoutMs: REVIEW_TIMEOUT_MS,
    })
    const tokens = { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens }
    const findings = reply.isAnswered ? parseFindings(reply.text) : []
    const done: Review = reply.isAnswered
      ? { ...base, ...tokens, status: findings.length > 0 ? 'findings' : 'clean', findings }
      : { ...base, ...tokens, status: 'failed', error: whyNot(reply) }
    await update($, reviewAtom, current => (current?.id === id ? { ...done, isDismissed: current.isDismissed || generation !== atGeneration } : current))
  } catch (error) {
    $.ui.log(`cc-turn-review: ${errorText(error)}`, { to: 'debug' })
    await update($, reviewAtom, (current): Review | null => (current?.id === id ? { ...current, status: 'failed', error: errorText(error) } : current))
  }
}

async function dismiss($: EngineInterface) {
  await update($, reviewAtom, current => (current === null || current.isDismissed ? current : { ...current, isDismissed: true }))
}

async function view($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: 'Turn review' })
  if (!opened.isPlaced) void $.ui.toast(`The turn review pane is waiting (${opened.reason})`)
}

async function fix($: EngineInterface) {
  const current = await read($, reviewAtom)
  if (current === null || current.findings.length === 0) return
  await dismiss($)
  void $.ui.close({ id: PANE })
  void $.prompt.submit({ text: fixMessage(current.findings), asUser: true })
}

const timeOf = (at: number) => new Date(at).toTimeString().slice(0, 5)

async function commandText($: EngineInterface, args: string) {
  const arg = args.trim().toLowerCase()
  if (arg === 'on' || arg === 'off') {
    await update($, isOffAtom, () => arg === 'off')
    if (arg === 'off') await dismiss($)
    return arg === 'off' ? 'Turn review is off for this session.' : 'Turn review is on.'
  }
  if (arg !== '') return `Usage: /${COMMAND} [on|off]`
  const state = (await read($, isOffAtom)) ? 'off' : 'on'
  const last = await read($, reviewAtom)
  if (last === null) return `Turn review is ${state}. No turn has changed files in a git repo yet.`
  const head = `Turn review is ${state}. Last review, ${timeOf(last.at)}: ${plural(last.files.length, 'file')}, ${last.changedLines} changed lines, ${last.inputTokens} input and ${last.outputTokens} output tokens.`
  if (last.status === 'running') return `${head}\nStill running.`
  if (last.status === 'failed') return `${head}\nIt failed: ${last.error}`
  if (last.status === 'clean') return `${head}\nClean.`
  return `${head}\n${last.findings.map(finding => `- ${finding}`).join('\n')}`
}

/** Nothing drawn: no tree, the engine's own, or an empty Box. */
const isNothing = (node: RenderElement | null | undefined) =>
  node === null || node === undefined || node.type === 'engine' || (node.type === 'Box' && (node.children ?? []).length === 0)

// --------------------------------------------------------------- module

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cfg.isInteractive = e.isInteractive
    cfg.home = (await $.env.get('HOME')) ?? ''
    if (!cfg.isInteractive || cfg.home === '') return started
    try {
      await $.command.register({ name: 'turnreview', description: 'Show the last turn review, or turn it on or off', argumentHint: '[on|off]' })
    } catch (error) {
      $.ui.log(`cc-turn-review: could not register /${COMMAND}: ${errorText(error)}`, { to: 'debug' })
    }
    // Folders of sessions that ended without cleaning up (a crash, a kill).
    void $.process
      .run(['find', `${cfg.home}/.claude/.cc-turn-review`, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-mtime', `+${STALE_DAYS}`, '-exec', 'rm', '-rf', '{}', '+'])
      .catch(() => undefined)
    return started
  })

  // A subagent's run raises no turn.start, so this is the main loop's.
  on('turn.start', async ($, e, next) => {
    generation += 1
    await dismiss($)
    if (cfg.home !== '' && (await isActive($))) {
      if (e.text.trim() !== '') asks = [...asks, e.text].slice(-MAX_ASKS)
      try {
        const repo = await findRepo($, await $.session.cwd())
        if (repo !== null) await startFor($, repo)
      } catch (error) {
        $.ui.log(`cc-turn-review: turn start: ${errorText(error)}`, { to: 'debug' })
      }
    }
    return next(e)
  })

  // Before the tool runs, so a repo first touched mid-turn is captured as it was.
  // Fails open: a missed snapshot only means a missed review.
  on('tool.call', { tool: ['Bash', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    if (cfg.home !== '' && (await isActive($))) {
      try {
        const cwd = await $.session.cwd()
        for (const path of pathsOf(e as unknown as Readonly<Record<string, unknown>>, cwd, cfg.home)) {
          const repo = await findRepo($, path)
          if (repo !== null) await startFor($, repo)
        }
      } catch (error) {
        $.ui.log(`cc-turn-review: tool call: ${errorText(error)}`, { to: 'debug' })
      }
    }
    return next(e)
 }).catch(($, e, next) => next(e))

  // An interrupted turn keeps its snapshots, so the next answered turn reviews both.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && starts.size > 0) {
      const batch = starts
      starts = new Map()
      if (await isActive($)) void review($, batch, asks, generation)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      generation += 1
      await dismiss($)
    }
    return next(e)
 }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    starts = new Map()
    asks = []
    await update($, reviewAtom, () => null)
    if (cfg.home !== '') {
      const dir = `${cfg.home}/.claude/.cc-turn-review/${slug(await $.session.id())}`
      await $.process.run(['rm', '-rf', dir]).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'turnreview' }, async ($, e) => ({ text: await commandText($, e.args ?? '') }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || e.props.view.agentId !== undefined) return next(e)
    const current = await read($, reviewAtom)
    if (current === null || current.isDismissed || current.status !== 'findings') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e)
    const row = (
      <Box key="turn-review" flexDirection="row" gap={1}>
        <Text color="warning" wrap="truncate-end">
          {`Turn review: ${plural(current.findings.length, 'finding')} · ${current.findings[0] ?? ''}`}
        </Text>
        <Button key="view" label="View" hotkey="v" onPress={() => void view($)} />
        <Button key="fix" label="Fix" hotkey="f" variant="primary" onPress={() => void fix($)} />
        <Button key="dismiss" label="Dismiss" hotkey="s" role="dismiss" onPress={() => void dismiss($)} />
      </Box>
    )
    return isNothing(below) ? row : <Box flexDirection="column">{[row, below]}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, reviewAtom)
    const close = <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
    if (current === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No review yet. One runs after each turn that changes files in a git repo.</Text>
          <Box marginTop={1}>{close}</Box>
        </Box>
      )
    }
    const facts = [timeOf(current.at), plural(current.files.length, 'file'), `${current.changedLines} changed lines`, `${current.inputTokens} in / ${current.outputTokens} out tokens`]
    return (
      <Box flexDirection="column">
        <Text bold>{facts.join(' · ')}</Text>
        <Text dimColor wrap="truncate-end">
          {current.files.join(', ')}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {current.status === 'findings' ? (
            <Markdown text={current.findings.map(finding => `- ${finding}`).join('\n')} />
          ) : current.status === 'clean' ? (
            <Text color="success">Clean.</Text>
          ) : current.status === 'failed' ? (
            <Text color="error">{`The review failed: ${current.error}`}</Text>
          ) : (
            <Text dimColor>Reviewing…</Text>
          )}
        </Box>
        <Box gap={1} marginTop={1}>
          {current.status === 'findings' && <Button key="fix" label="Fix" hotkey="f" variant="primary" onPress={() => void fix($)} />}
          {close}
        </Box>
      </Box>
    )
  })
}
