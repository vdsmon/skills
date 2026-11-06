import type { ElementTable, RenderElement } from 'claude-code'

import { renderInline } from './blocks'
import { hyperlinks } from './links'
import { parseInline } from './markdown'
import type { Style } from './theme'

// A paste of 4 lines or more reaches the prompt wrapped in <pasted_content id="…">; it draws in a
// double frame of its own, folded to one button that opens it as a code block.
export const pasteLang = (body: string): string => {
  const s = body.trim()
  if (/^[[{]/.test(s)) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {}
  }
  if (/^@@ /m.test(s) && /^(diff |--- |\+\+\+ )/m.test(s)) return 'diff'
  return /^<[a-z!?]/i.test(s) && />$/.test(s) ? 'markup' : ''
}

const PASTE = /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g

export type DrawPaste = (body: string, key: string) => RenderElement

export const renderUserPrompt = (el: ElementTable, style: Style, typed: string, time?: string, waiting = false, paste?: DrawPaste): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const color = waiting ? t.codeComment : t.codeText
  const accent = waiting ? t.codeComment : t.accent
  const pastes: string[] = []
  const text = typed.replace(PASTE, (_, _id, body: string) => `\0${pastes.push(body) - 1}\0`)
  const own = (line: string) => (paste && /^\0\d+\0$/.test(line) ? pastes[Number(line.slice(1, -1))]! : undefined)
  const told = (line: string) => line.replace(/\0(\d+)\0/g, (_, n) => `[Pasted text +${pastes[Number(n)]!.split('\n').length} lines]`)
  // **bold** and `code` draw as in a reply, and links go through the reply's checks.
  const line = (raw: string, i: number) => {
    const pasted = own(raw)
    if (pasted !== undefined) return paste!(pasted, `paste${i}`)
    const shown = told(raw)
    const marked = hyperlinks(parseInline(shown, { numbers: false, paths: false }), style)
    return <Text key={`p${i}`} color={color} bold={false}>{shown.trim() === '' ? ' ' : marked.every(n => n.kind === 'text') ? shown : renderInline(el, style, marked, `p${i}`)}</Text>
  }
  const body = (
    <Box flexDirection="column">
      {/* A run of blank lines keeps one; an empty Text takes no row, so a blank line draws a space. */}
      {text.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').split('\n').map(line)}
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
