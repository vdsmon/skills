import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { THEME as t } from './theme'

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const local = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime()

const prompt = (text: string, kind = 'composer', extra: Record<string, unknown> = {}) =>
  ({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'UserMessage' as const, props: { text, origin: { kind } as never, isExpanded: true, ...extra }, viewport: { columns: 80, rows: 10 } })

type Found = { props: Record<string, unknown> }
const bubble = async (ui: { findAll: (q: { type: string }) => Promise<Found[]> }) =>
  (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')

const submits = (on: On) => {
  const seen: (readonly string[] | undefined)[] = []
  mock.env(on, {})
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

const delivery = (text: string) => ({
  message: { type: 'attachment' as const, name: 'queued_command', content: [{ type: 'text' as const, text: `<system-reminder>\nThe user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages.\n</system-reminder>` }] },
}) as never

test('a typed prompt draws as a bubble on the left with its 24h send time', async ($, on) => {
  mock.clock(on, { now: local(10, 14, 32) })
  submits(on)
  await $.prompt.submit({ text: 'how many frog raids?', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount({ ...prompt('how many frog raids?'), requestId: 'row-1' })
  const box = await bubble(ui)
  expect(box?.props.alignSelf).toBe('flex-start')
  expect(box?.props.borderColor).toBe(t.accent)
  expect((await ui.find({ type: 'Text', text: /^ · 14:32$/ }))?.props.color).toBe(t.codeComment)
  expect(JSON.stringify(box)).not.toContain('14:32')
  expect((await ui.find({ type: 'Text', text: /^how many frog raids\?$/ }))?.props.color).toBe(t.heading)
  await ui.unmount()
})

test('a prompt sent on another day shows the date before the time', async ($, on) => {
  const clock = mock.clock(on, { now: local(10, 14, 32) })
  submits(on)
  await $.prompt.submit({ text: 'old question', wait: false, origin: { kind: 'composer' } })
  await clock.advance(24 * 60 * 60 * 1000)
  const ui = await $.ui.mount({ ...prompt('old question'), requestId: 'row-2' })
  expect(await ui.find({ type: 'Text', text: /^ · Oct 10 14:32$/ })).toBeDefined()
  await ui.unmount()
})

test('a task notification or a peer message is not drawn as a prompt bubble', async ($, on) => {
  engine(on)
  const task = await $.ui.mount(prompt('task done', 'task-notification'))
  expect(await task.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await bubble(task)).toBeUndefined()
  await task.unmount()
  const peer = await $.ui.mount(prompt('from another session', 'unclassified', { from: { name: 'peer' } }))
  expect(await peer.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await peer.unmount()
})

test('a prompt sent while a turn runs draws in the comment color', async ($, on) => {
  mock.clock(on, { now: 0 })
  submits(on)
  await $.prompt.submit({ text: 'queued test', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  const ui = await $.ui.mount(prompt('queued test'))
  expect((await bubble(ui))?.props.borderColor).toBe(t.codeComment)
  expect((await ui.find({ type: 'Text', text: /^queued test$/ }))?.props.color).toBe(t.codeComment)
  await ui.unmount()
})

test('a queued_command append for the prompt draws it in the normal color again', async ($, on) => {
  mock.clock(on, { now: 0 })
  submits(on)
  await $.prompt.submit({ text: 'queued test', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  await $.prompt.submit({ text: 'still waiting', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  await $.session.append(delivery('queued test'))
  const read = await $.ui.mount(prompt('queued test'))
  expect((await bubble(read))?.props.borderColor).toBe(t.accent)
  expect((await read.find({ type: 'Text', text: /^queued test$/ }))?.props.color).toBe(t.heading)
  await read.unmount()
  const other = await $.ui.mount(prompt('still waiting'))
  expect((await bubble(other))?.props.borderColor).toBe(t.codeComment)
  await other.unmount()
})

test('turn.start clears every queued prompt', async ($, on) => {
  mock.clock(on, { now: 0 })
  submits(on)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  await $.prompt.submit({ text: 'first', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  await $.prompt.submit({ text: 'second', wait: false, origin: { kind: 'composer' }, turnId: 't1' } as never)
  await $.turn.start({ text: 'first', turnId: 't2' })
  for (const text of ['first', 'second']) {
    const ui = await $.ui.mount(prompt(text))
    expect((await bubble(ui))?.props.borderColor).toBe(t.accent)
    await ui.unmount()
  }
})

test('prompt.submit adds no context to the prompt', async ($, on) => {
  mock.clock(on, { now: local(10, 9, 5) })
  const seen = submits(on)
  await $.prompt.submit({ text: 'show me deploys per day', wait: false, origin: { kind: 'composer' } })
  expect(seen).toHaveLength(1)
  expect(seen[0] ?? []).toEqual([])
  const ui = await $.ui.mount({ ...prompt('show me deploys per day'), requestId: 'row-3' })
  expect(await ui.find({ type: 'Text', text: /^ · 09:05$/ })).toBeDefined()
  await ui.unmount()
})

test('the turn line is left to Claude Code', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal' as const, component: 'TurnDuration' as const, props: { word: 'Brewed', durationMs: 5000 } })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})
