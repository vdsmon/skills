import { expect, test } from 'claude-code/testing'

// copyButtonStyle hover (prismantis #140), with its upstream tests.

const reply = (text: string, surface: 'terminal' | 'mobile' = 'terminal') => ({
  plugin: 'cc-dazzle',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 100, rows: 40 },
})

const HOVER = { options: { copyButtonStyle: 'hover' } }
const TABLE = '| Region | p99 |\n|---|---:|\n| eu | 12 |'
const SAMPLE = `${TABLE}\n\n\`\`\`bash\nls -la\n\`\`\`\n\n> reply text\n\nplain paragraph`

type Ui = { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string }[]> }
const floatingCopies = async (ui: Ui) => (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none').map(b => b.text)

type DrawnNode = { props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
const floatingReveals = (node: DrawnNode): unknown[] => [
  ...(node.props?.position === 'absolute' && node.props.display === 'none' ? [node.hover] : []),
  ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? floatingReveals(child as DrawnNode) : [])),
]

test('copyButtonStyle hover floats every copy button out of the flow, shown only while its block is hovered', HOVER, async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount(reply(SAMPLE))
  expect(await floatingCopies(ui)).toEqual(['⧉ md⧉ art', '⧉ copy', '⧉ copy'])
  expect(floatingReveals((await ui.drawn()) as DrawnNode)).toEqual(Array(3).fill({ display: 'flex' }))
  await ui.press({ key: 'copy1' })
  expect(copied).toEqual(['ls -la'])
  await ui.unmount()
})

test('copyButtonStyle hover covers only its buttons\' cells, so the rest of the row stays drawn while they show', HOVER, async $ => {
  const ui = await $.ui.mount(reply(`${TABLE}\n\n\`\`\`bash\nls\n\`\`\`\n\n> \`\`\`bash\n> npm test\n> \`\`\`\n>\n> Run that first.`))
  const floats = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none')
  expect(floats.map(b => b.text)).toEqual(['⧉ md⧉ art', '⧉ copy', '⧉ copy', '⧉ copy'])
  for (const float of floats) {
    expect(float.props.right).toBe(0)
    expect(float.props.left).toBeUndefined()
    expect(float.props.minWidth).toBeUndefined()
  }
  await ui.unmount()
})

test('copyButtonStyle hover makes a block at least as wide as its buttons, so buttons anchored right never run off its left edge', HOVER, async $ => {
  const ui = await $.ui.mount(reply('| a |\n|---|\n| 1 |\n\n```\nx\n```'))
  expect((await ui.find({ key: 'c0' }))?.props.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  expect((await ui.find({ key: 'b1' }))?.props.minWidth).toBe('[ ⧉ copy ]'.length)
  await ui.unmount()
})

test('copyButtonStyle hover puts a quote\'s button on its last row when a nested quote opens it with code, and drops it on a quote of one empty code block', HOVER, async $ => {
  const ui = await $.ui.mount(reply('> > ```bash\n> > ls\n> > ```\n> after\n\nmiddle\n\n> ```\n> ```'))
  const floats = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none')
  expect(floats.filter(b => b.props.bottom === 0).map(b => b.text)).toEqual(['⧉ copy'])
  expect(floats.filter(b => b.text === '⧉ copy').length).toBe(floats.length)
  await ui.unmount()
})

test('copyButtonStyle hover reserves its buttons width beside a narrow table', HOVER, async $ => {
  const ui = await $.ui.mount(reply('| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |'))
  for (const key of ['c0', 'c1']) expect((await ui.find({ key }))?.props.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  await ui.unmount()
})

test('copyButtonStyle inline, the default, keeps every copy button in the flow', async $ => {
  const ui = await $.ui.mount(reply(SAMPLE))
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})

test('copyButtonStyle hover draws inline on mobile, which has no pointer', HOVER, async $ => {
  const ui = await $.ui.mount(reply(SAMPLE, 'mobile'))
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})
