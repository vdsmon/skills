import type { ElementTable, RenderElement } from 'claude-code'

import type { Style } from './theme'

export const renderUserPrompt = (el: ElementTable, style: Style, text: string, time?: string, waiting = false): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const color = waiting ? t.codeComment : t.heading
  const accent = waiting ? t.codeComment : t.accent
  const body = (
    <Box flexDirection="column">
      {text.split('\n').map((line, i) => <Text key={`p${i}`} color={color} bold={false}>{line}</Text>)}
    </Box>
  )
  const stamp = time === undefined ? null : <Text color={t.codeComment}>{`${time} `}</Text>
  const content = stamp === null ? body : <Box flexDirection="row">{stamp}{body}</Box>
  return <Box borderStyle="round" borderColor={accent} paddingX={1} alignSelf="flex-start">{content}</Box>
}
