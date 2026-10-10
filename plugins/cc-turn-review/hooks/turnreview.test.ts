import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseFindings, pathsInCommand, withoutLockfiles } from './review'

const HOME = '/home/me'
const APP = '/home/me/app'
const LIB = '/home/me/lib'
const FOLDERS = new Set([HOME, APP, `${APP}/src`, LIB, '/tmp', '/'])

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const FINDING = 'src/a.ts:3 - over-design - a helper used once'

let clock: MockClock
let toolUses = 0

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// The engine beneath the mod: repos whose working copy a Bash call "edits" by
// naming `EDIT:<repo>`, a git that answers from that state, and a model whose
// reply the test picks.
function world(on: On) {
  clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  const seen = {
    version: new Map<string, number>([
      [APP, 0],
      [LIB, 0],
    ]),
    order: [] as string[],
    prompts: [] as string[],
    submits: [] as string[],
    reply: `- ${FINDING}`,
    cwd: APP,
    head: 'h0',
    pulled: [] as string[],
  }
  const repoOf = (dir: string) => [APP, LIB].find(top => dir === top || dir.startsWith(`${top}/`))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', async () => ({ value: 's1' }))
  on('session.cwd', async () => ({ value: seen.cwd }))
  on('env.get', async () => ({ value: HOME }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', async () => ({ value: undefined }) as never)
  on('ui.render', async ($, e) => $.ui.resolve(e).Box({}))
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const cwd = e.init?.cwd ?? ''
    if (argv[0] !== 'git') return ran('')
    if (argv.includes('--verify')) return ran(`${seen.head}\n`)
    if (argv.includes('log')) return ran(argv.some(arg => arg.endsWith(`..${seen.head}`)) ? seen.pulled.map(name => `\n${name}\0`).join('') : '')
    if (argv.includes('rev-parse')) {
      if (!FOLDERS.has(cwd)) throw new Error(`cannot start in ${cwd}`)
      const top = repoOf(cwd)
      return top === undefined ? ran('', 128) : ran(`${top}\n${top}/.git\n${top}/.git\n`)
    }
    const top = repoOf(cwd) ?? '?'
    const v = seen.version.get(top) ?? 0
    if (argv.includes('write-tree')) {
      seen.order.push(`snapshot ${top} v${v}`)
      return ran(`tree-${v}\n`)
    }
    if (argv.includes('diff-tree')) {
      const [from, to] = argv.slice(-2)
      if (argv.includes('--name-only')) return ran(['src/a.ts', ...seen.pulled].map(name => `${name}\0`).join(''))
      const label = top.replace(HOME, '~')
      const section = (name: string, line: string) => `diff --git ${label}/${name} ${label}/${name}\n--- ${label}/${name}\n+++ ${label}/${name}\n@@ -1 +1,2 @@\n+${line}\n`
      return ran([section('src/a.ts', `// ${top} ${from}..${to}\n+const x = 1`), ...seen.pulled.map(name => section(name, 'teammate code'))].join(''))
    }
    return ran('')
  })
  on('tool.call', async (_$, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    for (const top of [APP, LIB]) if (command.includes(`EDIT:${top}`)) seen.version.set(top, (seen.version.get(top) ?? 0) + 1)
    if (command.includes('git pull')) {
      seen.head = 'h1'
      seen.pulled = ['src/b.ts']
    }
    seen.order.push('tool')
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('model.complete', async (_$, e) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: seen.reply, usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  on('prompt.submit', async (_$, e) => {
    seen.submits.push(e.text)
    return { text: e.text }
  })
  on('command.run', async () => ({ text: '' }))
  return seen
}

async function start($: Engine, isInteractive = true) {
  await $.session.start({ cwd: APP, surface: isInteractive ? 'terminal' : null, isInteractive })
}

async function turn($: Engine, text: string, commands: readonly string[], opts: { reason?: 'answer' | 'aborted'; agentId?: string } = {}) {
  toolUses += 1
  const turnId = `turn_${toolUses}`
  await $.turn.start({ text, turnId })
  for (const command of commands) {
    toolUses += 1
    await $.tool.call({ tool: 'Bash', tool_use_id: `toolu_${toolUses}`, command })
  }
  const reason = opts.reason ?? 'answer'
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: reason === 'aborted', turnId, agentId: opts.agentId, reason })
  await clock.settle()
}

const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'turnreview', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

function band($: Engine) {
  return $.ui.mount({ plugin: 'cc-turn-review', surface: 'terminal', component: 'AbovePrompt', props: BAND })
}

async function buttons(ui: Awaited<ReturnType<typeof band>>) {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key)
}

const heredoc = (top: string) => `cat > src/a.ts <<'EOF'\nconst x = 1\nEOF\n# EDIT:${top}`

test('a heredoc edit gets one review with the ask, and its findings show in the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, 'add the x constant', [heredoc(APP)])
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('add the x constant')
  expect(seen.prompts[0]).toContain('+const x = 1')
  expect(await buttons(ui)).toEqual(['view', 'fix', 'dismiss'])
  expect((await ui.find({ type: 'Text' }))?.text).toContain(FINDING)
})

test('a turn that changes nothing calls no model and shows nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, 'what does this do?', ['ls src'])
  expect(seen.prompts.length).toBe(0)
  expect(await buttons(ui)).toEqual([])
})

test('a repo first named mid-turn is snapshotted before the command runs', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, 'fix lib', [`cd ${LIB} && ${heredoc(LIB)}`])
  const lib = seen.order.indexOf(`snapshot ${LIB} v0`)
  expect(lib).toBeGreaterThan(-1)
  expect(lib).toBeLessThan(seen.order.indexOf('tool'))
  expect(seen.prompts[0]).toContain(`${LIB} tree-0..tree-1`)
})

test('files that a pull brought in during the turn are left out of the review', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, 'pull, then add the x constant', ['git pull', heredoc(APP)])
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain('src/a.ts')
  expect(seen.prompts[0]).not.toContain('teammate code')
  const r = await slash($, '')
  expect(r.text).toContain('Left out 1 file changed by commits that came in during the turn')
})

test('a clean reply shows no band, and /turnreview says clean', async ($, on) => {
  const seen = world(on)
  seen.reply = 'CLEAN'
  await start($)
  const ui = await band($)
  await turn($, 'add the x constant', [heredoc(APP)])
  expect(await buttons(ui)).toEqual([])
  const r = await slash($, '')
  expect(r.text).toContain('Clean.')
})

test('Fix sends the findings as the next prompt and clears the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, 'add the x constant', [heredoc(APP)])
  await ui.press({ key: 'fix' })
  await clock.settle()
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0]).toContain(FINDING)
  expect(await buttons(ui)).toEqual([])
})

test('the next prompt clears the band', async ($, on) => {
  const seen = world(on)
  await start($)
  const ui = await band($)
  await turn($, 'add the x constant', [heredoc(APP)])
  expect(await buttons(ui)).toEqual(['view', 'fix', 'dismiss'])
  await $.prompt.submit({ text: 'ok, next thing', origin: { kind: 'composer' } } as never)
  expect(await buttons(ui)).toEqual([])
  expect(seen.prompts.length).toBe(1)
})

test('an interrupted turn rolls into the next answered one', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, 'add the x constant', [heredoc(APP)], { reason: 'aborted' })
  expect(seen.prompts.length).toBe(0)
  await turn($, 'go on', [heredoc(APP)])
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toContain(`${APP} tree-0..tree-2`)
  expect(seen.prompts[0]).toContain('add the x constant')
})

test('/turnreview off stops reviews until /turnreview on', async ($, on) => {
  const seen = world(on)
  await start($)
  await slash($, 'off')
  await turn($, 'add the x constant', [heredoc(APP)])
  expect(seen.prompts.length).toBe(0)
  await slash($, 'on')
  await turn($, 'again', [heredoc(APP)])
  expect(seen.prompts.length).toBe(1)
})

test('a subagent turn end reviews nothing', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, 'add the x constant', [heredoc(APP)], { agentId: 'agent_1' })
  expect(seen.prompts.length).toBe(0)
})

test('a non-interactive session takes no snapshot', async ($, on) => {
  const seen = world(on)
  await start($, false)
  await turn($, 'add the x constant', [heredoc(APP)])
  expect(seen.order.filter(step => step.startsWith('snapshot'))).toEqual([])
  expect(seen.prompts.length).toBe(0)
})

test('paths in commands: cd, git -C, absolute and home paths; not URLs or /dev', async () => {
  const cmd = `cd ../lib && git -C "~/repos/x" status; cat > $HOME/notes/a.md <<EOF\nsee https://example.com/a\nEOF\necho hi > /dev/null; sed -i '' s/a/b/ /tmp/f.txt`
  expect(pathsInCommand(cmd, APP, HOME)).toEqual([LIB, `${HOME}/repos/x`, `${HOME}/notes/a.md`, '/tmp/f.txt'])
})

test('lockfiles show as one line; CLEAN and bullets parse', async () => {
  const patch = 'diff --git a/package-lock.json b/package-lock.json\n+lots\n+more\ndiff --git a/a.ts b/a.ts\n+x\n'
  expect(withoutLockfiles(patch)).toBe('diff --git a/package-lock.json b/package-lock.json\n(lockfile: diff left out)\ndiff --git a/a.ts b/a.ts\n+x\n')
  expect(parseFindings('CLEAN')).toEqual([])
  expect(parseFindings('- a.ts:1 - comment - restates the code\n- b.md:4 - prose - wrapped by hand')).toEqual([
    'a.ts:1 - comment - restates the code',
    'b.md:4 - prose - wrapped by hand',
  ])
})
