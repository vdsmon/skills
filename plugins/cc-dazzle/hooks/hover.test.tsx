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

test('copyButtonStyle hover starts buttons wider than their block at its left edge', HOVER, async $ => {
  const ui = await $.ui.mount(reply(`${TABLE}\n\n\`\`\`bash\nls\n\`\`\``))
  const corners = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.top === 0)
  expect(corners.map(b => b.text)).toEqual(['⧉ md⧉ art', '⧉ copy'])
  for (const corner of corners) expect(corner.props).toMatchObject({ left: 0, minWidth: '100%', justifyContent: 'flex-end' })
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
