import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { width } from './text'
import { THEME } from './theme'
import { takesMonoText } from './version'

// Desktop app drawing ported from upstream prismantis 0.32.1 to 0.44.0 (#279, #280, #333), with its upstream tests.

const reply = (text: string, surface: 'terminal' | 'desktop', columns = 100) => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})
const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

const TABLE = '| Service | Regions | Version |\n|---|---|--:|\n| api | eu, us | 2.14.0 |\n| worker | eu | 2.13.1 |'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`an H1 rule on ${surface} is as wide as its heading`, async $ => {
    const ui = await $.ui.mount(reply('# Heading level one', surface))
    const rule = (await ui.findAll({ type: 'Text' })).find(t => /^━+$/.test(t.text))
    if (surface === 'terminal') expect(rule?.text).toBe('━'.repeat(width('Heading level one')))
    else {
      expect(rule).toBeUndefined()
      const lines = (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === 0 && b.props.flexGrow === 1 && b.props.height === 0.12)
      expect(lines.map(b => b.props.backgroundColor)).toEqual([THEME.heading])
    }
    await ui.unmount()
  })

  test(`a thematic break on ${surface} draws one rule up to 80 columns wide`, async $ => {
    const ui = await $.ui.mount(reply('Above\n\n---\n\nBelow', surface, 120))
    const text = (await ui.findAll({ type: 'Text' })).find(t => /^─+$/.test(t.text))
    if (surface === 'terminal') expect(text?.text).toBe('─'.repeat(80))
    else {
      expect(text).toBeUndefined()
      const lines = (await ui.findAll({ type: 'Box' })).filter(b => b.props.height === 0.06 && b.props.backgroundColor !== undefined)
      expect(lines.map(b => [b.props.width, b.props.flexShrink, b.props.minWidth, b.props.backgroundColor])).toEqual([[80, 1, 0, THEME.rule]])
    }
    await ui.unmount()
  })
}

test('a table in the terminal keeps its character rules in fixed columns', async $ => {
  const ui = await $.ui.mount(reply(TABLE, 'terminal'))
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.backgroundColor !== undefined && Number(b.props.height ?? 1) < 1)).toBe(false)
  expect(boxes.filter(b => /^(Service|Regions|Version)$/.test(b.text ?? '')).every(b => typeof b.props.width === 'number' && b.props.flexShrink === 0)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^┌[─┬]+┐$/ })).toBeDefined()
  await ui.unmount()
})

const percent = (value: unknown) => (typeof value === 'string' && /^\d+%$/.test(value) ? Number(value.slice(0, -1)) : NaN)

test('a table on desktop draws its lines as thin colored boxes and its columns as percent shares', async $ => {
  const ui = await $.ui.mount(reply(TABLE, 'desktop'))
  expect(await ui.find({ type: 'Text', text: /[┌└├╞┬┼│]/ })).toBeUndefined()
  const boxes = await ui.findAll({ type: 'Box' })
  const lines = boxes.filter(b => b.props.backgroundColor === THEME.tableRule)
  expect(lines.filter(b => b.props.height === 0.06).length).toBe(5)
  expect(lines.filter(b => b.props.width === 0.12).length).toBe(4 * 3)
  const header = boxes.filter(b => /^(Service|Regions|Version)$/.test(b.text ?? '') && typeof b.props.width === 'string')
  expect(header.map(b => percent(b.props.width)).reduce((a, b) => a + b, 0)).toBe(100)
  expect(header.every(b => b.props.alignItems === 'flex-start')).toBe(true)
  await ui.unmount()
})

test('a list marker on desktop sits in a box of its own at the top of its row', async $ => {
  const ui = await $.ui.mount(reply('- a long item that wraps\n- b', 'desktop'))
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && b.props.alignItems === 'flex-start' && /^• /.test(b.text ?? ''))
  expect(rows.length).toBe(2)
  await ui.unmount()
})

const DIAGRAM = '```mermaid\nflowchart LR\n    A[Reply] --> B[Draw]\n```'

test('a diagram on desktop from Claude Code 2.1.299 draws its rows in the monospaced face; older engines refuse the prop', async ($, on) => {
  claudeAt(on, '2.1.299')
  const mounting = $.ui.mount(reply(DIAGRAM, 'desktop'))
  const refused = await mounting.then(() => '', (error: unknown) => String(error))
  if (refused) {
    expect(refused).toMatch(/mono/)
    return
  }
  const ui = await mounting
  const rows = (await ui.findAll({ type: 'Text' })).filter(t => /[┌└│]/.test(t.text) && !t.text.includes('\n') && t.props.mono !== undefined)
  expect(rows.length).toBeGreaterThan(1)
  await ui.unmount()
})

for (const [surface, base] of [['desktop', '2.1.296'], ['terminal', '2.1.299']] as const) test(`a diagram on ${surface} with Claude Code ${base} keeps the face of the reply`, async ($, on) => {
  claudeAt(on, base)
  const ui = await $.ui.mount(reply(DIAGRAM, surface))
  expect((await ui.findAll({ type: 'Text' })).some(t => t.props.mono !== undefined)).toBe(false)
  await ui.unmount()
})

test('the monospaced face starts at Claude Code 2.1.299', () => {
  const versions = ['2.1.287', '2.1.296', '2.1.299', '2.1.300-dev', '2.2.0', '1.9.999', 'dev', undefined]
  expect(versions.map(takesMonoText)).toEqual([false, false, true, true, true, false, false, false])
})
