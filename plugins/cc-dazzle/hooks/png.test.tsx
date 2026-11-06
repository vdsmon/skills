import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MAC_IMAGE_COPY, imageCommand } from './clipboard'
import { THEME as t } from './theme'

// PNG copy of tables and diagrams, ported from upstream prismantis #276, #329 and #358 with their tests (macOS only).

const reply = (text: string, surface: 'terminal' | 'desktop' = 'terminal') => ({ plugin: 'cc-dazzle', surface, component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true }, viewport: { columns: 120, rows: 40 } })

const macEnv = (on: On) => {
  mock.env(on, {})
  on('fs.stat', (_, e, next) => (e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript') ? { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } } : next(e)))
}
const startSession = async ($: Engine, on: On) => {
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}
const runResult = (exitCode: number, stderr = '') => ({ value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
const recordToasts = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

const figures = '| Item | Qty |\n|--|--:|\n| 苹果 | 3 |\n\n```mermaid\ngraph LR\nA[User] --> B[Gateway]\n```'

test('the image helper gets each glyph at its terminal column, and the colors as RGB, on stdin', () => {
  const text = '┌──┬──┐\n│苹│ab│\n└──┴──┘'
  const mac = imageCommand(text, { foreground: '#cdd6f4', background: '#1e1e2e' })
  expect(mac.argv).toEqual(['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_IMAGE_COPY])
  const row = (s: string) => [...s].map((glyph, at) => ({ at, text: glyph }))
  expect(JSON.parse(mac.stdin)).toEqual({
    lines: [row('┌──┬──┐'), [{ at: 0, text: '│' }, { at: 1, text: '苹' }, { at: 3, text: '│' }, { at: 4, text: 'a' }, { at: 5, text: 'b' }, { at: 6, text: '│' }], row('└──┴──┘')],
    columns: 7,
    foreground: [205, 214, 244],
    background: [30, 30, 46],
  })
  expect(JSON.parse(imageCommand('x', { foreground: '#202020', background: '#1e1e2e' }).stdin)).toMatchObject({ foreground: [255, 255, 255] })
})

test('the png helper keeps a rule glyph in its drawn color and still makes a letter readable', () => {
  const lines = JSON.parse(imageCommand('─a', { background: '#1e1e2e' }, [['#1e1e2e', '#1e1e2e']]).stdin).lines
  expect(lines[0][0].color).toEqual([30, 30, 46])
  expect(lines[0][1].color).toEqual([255, 255, 255])
})

for (const surface of ['terminal', 'desktop'] as const) test(`▣ png on tables and diagrams ${surface === 'terminal' ? 'copies an image' : 'is hidden'} on ${surface}`, async ($, on) => {
  macEnv(on)
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return runResult(0)
  })
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply(figures, surface))
  const pngs = (await ui.findAll({ type: 'Button' })).filter(b => b.props.label === '▣ png')
  expect(pngs.length).toBe(surface === 'terminal' ? 2 : 0)
  if (surface === 'terminal') {
    await ui.press({ key: 'png0' })
    expect(runs.at(-1)?.at(-1)).toBe(MAC_IMAGE_COPY)
    expect(toasts).toEqual(['Copied as image'])
  }
  await ui.unmount()
})

test('▣ png is hidden without the macOS helper', async ($, on) => {
  mock.env(on, {})
  await startSession($, on)
  const ui = await $.ui.mount(reply(figures))
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === '▣ png')).toBe(false)
  await ui.unmount()
})

test('a failed image copy falls back to the drawn text and says why', async ($, on) => {
  macEnv(on)
  on('process.run', () => runResult(1, 'Cannot draw image'))
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply(figures))
  await ui.press({ key: 'png0' })
  expect(copies[0]).toContain('│ 苹果 │')
  expect(toasts).toEqual(['Copied as plain text (Cannot draw image)'])
  await ui.unmount()
})

test('▣ png draws a table as the screen does: header bold in its color, rules and inline colors', async ($, on) => {
  macEnv(on)
  const inputs: string[] = []
  on('process.run', (_, e) => {
    inputs.push(e.init?.stdin ?? '')
    return runResult(0)
  })
  recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply('| Name | Note |\n|--|--|\n| plain | `code` **bold** *slant* |'))
  await ui.press({ key: 'png0' })
  type Glyph = { at: number; text: string; color?: number[]; bold?: boolean; italic?: boolean }
  const lines = (JSON.parse(inputs[0]!) as { lines: Glyph[][] }).lines
  const at = (row: number, text: string) => lines[row]!.find(g => g.text === text)!
  expect(lines[2]!.map(g => g.text).join('')).toMatch(/^╞═+╪═+╡$/)
  expect(lines[1]![1]).toMatchObject({ at: 2, text: 'N', color: rgb(t.tableHeader!), bold: true })
  expect(at(0, '┌').color).toEqual(rgb(t.tableRule!))
  expect(at(3, 'c').color).toEqual(rgb(t.inlineCode!))
  expect(at(3, 'b')).toMatchObject({ color: rgb(t.strong!), bold: true })
  expect(at(3, 's')).toMatchObject({ color: rgb(t.emphasis!), italic: true })
  expect(at(3, 'p').bold).toBeUndefined()
  await ui.unmount()
})

test('▣ png keeps the colors the diagram draws with', async ($, on) => {
  macEnv(on)
  const inputs: string[] = []
  on('process.run', (_, e) => {
    inputs.push(e.init?.stdin ?? '')
    return runResult(0)
  })
  recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply('```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```'))
  await ui.press({ key: 'png0' })
  const payload = JSON.parse(inputs[0]!) as { lines: { text: string; color?: number[] }[][] }
  expect(payload.lines.flat().every(g => g.color !== undefined)).toBe(true)
  expect(new Set(payload.lines.flat().map(g => String(g.color))).size).toBeGreaterThan(1)
  await ui.unmount()
})
