import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { THEME } from './theme'

// Tool row and prompt changes ported from upstream prismantis 0.32.1 to 0.44.0, with their upstream tests.

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const prompt = (text: string, kind = 'composer', surface: 'terminal' | 'desktop' = 'terminal') =>
  ({ plugin: 'cc-dazzle', surface, component: 'UserMessage' as const, props: { text, origin: { kind } as never, isExpanded: true }, viewport: { columns: 80, rows: 10 } })

const toolCall = (tool: string, input: unknown, id = `c-${tool}`) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

const drawnTexts = async ($: Engine, props: Record<string, unknown>) => {
  const ui = await $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', ...props } as Parameters<Engine['ui']['mount']>[0])
  const texts = (await ui.findAll({ type: 'Text' })).map(n => n.text ?? '')
  await ui.unmount()
  return texts
}

test('a pasted block in your prompt is its own frame, folded to a button that opens it as highlighted code', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(prompt('look\n<pasted_content id="9649">\n{\n  "on": true\n}\n</pasted_content id="9649">\nseems obvious!'))
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === 'pasted text · 3 lines')
  expect(button).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^seems obvious!$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/pasted_content|"on"/)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'double')).toBe(true)
  await ui.press({ key: button!.key! })
  expect((await ui.find({ type: 'Text', text: /^true$/ }))?.props.color).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ json$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === 'show less')).toBe(true)
  await ui.unmount()
})

test('a paste inside a line of your prompt draws as a short note, not its raw tags', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(prompt('see <pasted_content id="1">a\nb\nc\nd</pasted_content id="1"> here'))
  expect(await ui.find({ type: 'Text', text: /^see \[Pasted text \+4 lines\] here$/ })).toBeDefined()
  await ui.unmount()
})

test('markdown in your prompt draws as bold and code, and a plain line stays one span', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(prompt('make **this** bold and `that` code\nplain line'))
  expect((await ui.find({ type: 'Text', text: /^this$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^that$/ }))?.props.color).toBe(THEME.inlineCode)
  expect(await ui.find({ type: 'Text', text: /\*\*/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^plain line$/ })).toBeDefined()
  await ui.unmount()
})

test('links in your prompt go through the reply checks, so a spoofed label draws with its target', async ($, on) => {
  mock.clock(on)
  on('session.version', () => ({ value: { version: '2.1.289', base: '2.1.289' } }))
  const ui = await $.ui.mount(prompt('see [paypal.com](https://evil.example/x) and [docs](https://a.dev/x)'))
  expect((await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))).toEqual(['https://a.dev/x'])
  expect(await ui.find({ type: 'Text', text: /^paypal\.com \(https:\/\/evil\.example\/x\)$/ })).toBeDefined()
  await ui.unmount()
})

test('a prompt the desktop app sends as an SDK host draws in the prompt box', async ($, on) => {
  engine(on)
  mock.clock(on)
  const ui = await $.ui.mount(prompt('hello from the app', 'sdk', 'desktop'))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
  await ui.unmount()
})

test('a skill row names the skill it loads', async $ => {
  expect((await drawnTexts($, { component: 'ToolUse', props: toolCall('Skill', { skill: 'humanize' }) })).join('')).toContain('humanize')
})

test('terminal control sequences in tool commands and targets are never drawn', async $ => {
  const BAD = '\u001b]52;c;cHduZWQ=\u0007\u001b[2J'
  const shell = await drawnTexts($, { component: 'ToolUse', props: toolCall('Bash', { command: `echo hi ${BAD}\nls` }) })
  const grep = await drawnTexts($, { component: 'ToolUse', props: toolCall('Grep', { pattern: `x${BAD}y` }) })
  expect(shell.join('')).toContain('echo hi')
  expect(grep.join('')).toContain('xy')
  expect([...shell, ...grep].filter(t => /[\u001b\u0007]/.test(t))).toEqual([])
})

test('in the ctrl+o transcript a shell row goes to the engine whole, so its output draws once', async ($, on) => {
  engine(on)
  mock.env(on, {})
  const row = await $.ui.mount({ plugin: 'cc-dazzle', surface: 'terminal', component: 'ToolUse', props: { ...toolCall('Bash', { command: 'ls -la' }, 'fx-2'), isExpanded: true, output: { stdout: 'a\nb', stderr: '', interrupted: false } } as never })
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /^a$/ })).toBeUndefined()
  await row.unmount()
})
