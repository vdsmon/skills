import type { ElementTable, RenderElement } from 'claude-code'

import type { Style } from './theme'

export const renderUserPrompt = (el: ElementTable, style: Style, text: string, time?: string, waiting = false): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const color = waiting ? t.codeComment : t.codeText
  const accent = waiting ? t.codeComment : t.accent
  const body = (
    <Box flexDirection="column">
      {text.split('\n').map((line, i) => <Text key={`p${i}`} color={color} bold={false}>{line}</Text>)}
    </Box>
  )
  const bubble = <Box borderStyle="round" borderColor={accent} paddingX={1} alignSelf="flex-start">{body}</Box>
  if (time === undefined) return bubble
  return (
    <Box flexDirection="row" alignItems="flex-start">
      {bubble}
      <Box marginTop={1} flexShrink={0}><Text color={t.codeComment}>{` ${time}`}</Text></Box>
    </Box>
  )
}
