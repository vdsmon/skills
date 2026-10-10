import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register } from 'claude-code'

import type { FileChange } from '../types'
import { counts, diffLines, linesOf, removedText, unapply, unified } from './diff'

const COMMAND = 'changes'
const PANE = 'cc-changes'

const filesAtom = atom({ plugin: 'cc-changes', key: 'files' } as const, [])
const selectedAtom = atom({ plugin: 'cc-changes', key: 'selected' } as const, null)
const isOpenAtom = atom({ plugin: 'cc-changes', key: 'isOpen' } as const, false)
const epochAtom = atom({ plugin: 'cc-changes', key: 'epoch' } as const, 0)

const cfg = { root: '', home: '' }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function absolute(path: string) {
  if (path.startsWith('/') || cfg.root === '') return path
  return `${cfg.root.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`
}

export function shown(path: string, root: string, home: string) {
  if (root !== '' && path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  if (home !== '' && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

/**
 * Records one change to `path`. `before` is the text before this change
 * (undefined when unknown), `after` the text now (null once deleted,
 * undefined when unreadable). Only the first change's `before` is kept: the
 * file as the session found it.
 */
async function track($: EngineInterface, path: string, before: string | null | undefined, after: string | null | undefined) {
  const epoch = await read($, epochAtom)
  const ref = { plugin: 'cc-changes', key: 'original', id: `${epoch}:${path}` } as const
  const held = await $.state.get(ref)
  let original = held.value
  if (held.version === 0) {
    if (before === undefined) original = undefined
    else {
      await $.state.set(ref, before, { ifVersion: 0 })
      original = (await $.state.get(ref)).value
    }
  }
  const at = await $.clock.now()
  let entry: FileChange | null
  if (original === undefined || after === undefined) {
    entry = { path, status: after === null ? 'deleted' : original === null ? 'added' : 'modified', added: null, removed: null, at }
  } else if (original === after || (original === null && after === null)) {
    entry = null // back to how the session found it
  } else {
    const { added, removed } = counts(diffLines(linesOf(original), linesOf(after)))
    entry = { path, status: original === null ? 'added' : after === null ? 'deleted' : 'modified', added, removed, at }
  }
  await update($, filesAtom, files => {
    const rest = files.filter(file => file.path !== path)
    return entry === null ? rest : [...rest, entry].sort((a, b) => a.path.localeCompare(b.path))
  })
}

type Patch = BuiltinToolResults['Bash']['bashEditDiff']

async function trackBash($: EngineInterface, diff: Patch) {
  if (diff === undefined || diff.unavailable === true || diff.skipped === true) return
  for (const file of diff.files) {
    const path = absolute(file.filePath)
    if (file.deleted === true) {
      await track($, path, removedText(file.hunks), null)
      continue
    }
    const after = await readText($, path)
    const before = file.created === true ? null : after === undefined ? undefined : unapply(after, file.hunks)
    await track($, path, before, after)
  }
}

async function toggle($: EngineInterface) {
  if (await read($, isOpenAtom)) {
    await $.ui.close({ id: PANE })
    await update($, isOpenAtom, () => false)
    return 'Changes pane closed.'
  }
  await update($, selectedAtom, () => null)
  await update($, isOpenAtom, () => true)
  const opened = await $.ui.open({ id: PANE, title: 'Changes' })
  return opened.isPlaced ? 'Changes pane opened.' : `The changes pane is waiting: ${opened.reason}`
}

const countText = (file: FileChange) => (file.added === null || file.removed === null ? '?' : `+${file.added} −${file.removed}`)

/** Cuts from the left so the file name stays. */
const fit = (text: string, width: number) => (text.length <= width ? text.padEnd(width) : `…${text.slice(text.length - Math.max(1, width - 1))}`)

const LETTER = { added: 'A', modified: 'M', deleted: 'D' } as const
const COLOR = { added: 'success', modified: 'warning', deleted: 'error' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cfg.root = e.cwd
    cfg.home = (await $.env.get('HOME')) ?? ''
    if (!e.isInteractive) return started
    try {
      await $.command.register({ name: 'changes', description: 'Show or hide the files this session changed, with line counts and diffs' })
    } catch (error) {
      $.ui.log(`cc-changes: could not register /${COMMAND}: ${errorText(error)}`, { to: 'debug' })
    }
    return started
  })

  // After the tool ran, from its own record. Fails open: a missed change only leaves the list short.
  on('tool.call', { tool: ['Edit', 'Write', 'Bash'] }, async ($, e, next) => {
    const ran = await next(e)
    if (!('result' in ran) || ran.result === undefined) return ran
    try {
      if (e.tool === 'Edit') {
        const result = ran.result as BuiltinToolResults['Edit']
        const path = absolute(result.filePath)
        await track($, path, result.originalFile, await readText($, path))
      } else if (e.tool === 'Write') {
        const result = ran.result as BuiltinToolResults['Write']
        await track($, absolute(result.filePath), result.originalFile, result.content)
      } else {
        await trackBash($, (ran.result as BuiltinToolResults['Bash']).bashEditDiff)
      }
    } catch (error) {
      $.ui.log(`cc-changes: ${errorText(error)}`, { to: 'debug' })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'changes' }, async $ => ({ text: await toggle($) }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isOpenAtom, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, epochAtom, n => n + 1)
      await update($, filesAtom, () => [])
      await update($, selectedAtom, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const files = await read($, filesAtom)
    const selected = await read($, selectedAtom)
    const width = Math.max(20, e.props.bodyColumns)
    const file = files.find(one => one.path === selected)

    if (file !== undefined) {
      const epoch = await read($, epochAtom)
      const { value: original, version } = await $.state.get({ plugin: 'cc-changes', key: 'original', id: `${epoch}:${file.path}` })
      const after = file.status === 'deleted' ? null : await readText($, file.path)
      const name = shown(file.path, cfg.root, cfg.home)
      const patch = version === 0 || original === undefined || after === undefined ? '' : unified(name, diffLines(linesOf(original), linesOf(after)))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="Back" hotkey="b" onPress={() => void update($, selectedAtom, () => null)} />
            <Text bold wrap="truncate-start">
              {name}
            </Text>
            <Text color={COLOR[file.status]}>{countText(file)}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            {patch === '' ? <Text dimColor>No diff: the file could not be read, or its first change was not seen.</Text> : <Code source={patch} format="diff" path={name} />}
          </Box>
        </Box>
      )
    }

    if (files.length === 0) return <Text dimColor>No file changed in this session yet.</Text>

    const added = files.reduce((sum, one) => sum + (one.added ?? 0), 0)
    const removed = files.reduce((sum, one) => sum + (one.removed ?? 0), 0)
    const countWidth = Math.max(...files.map(one => countText(one).length))
    const pathWidth = Math.max(8, width - countWidth - 3)
    return (
      <Box flexDirection="column">
        <Text bold>
          {`${plural(files.length, 'file')}  `}
          <Text color="success">{`+${added}`}</Text> <Text color="error">{`−${removed}`}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          {files.map((one, index) => (
            <Button key={`file-${index}`} plain onPress={() => void update($, selectedAtom, () => one.path)}>
              <Text color={COLOR[one.status]}>{LETTER[one.status]}</Text> {fit(shown(one.path, cfg.root, cfg.home), pathWidth)}{' '}
              <Text dimColor={one.added === null}>{countText(one).padStart(countWidth)}</Text>
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}
