import type { ClipboardBackend } from './clipboard'

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode', 'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment',
  'link', 'path', 'number', 'quote', 'rule', 'tableHeader', 'tableRule', 'bullet', 'diagram', 'diagramText', 'success', 'error',
] as const

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>

// Catppuccin Mocha, the one palette cc-dazzle draws in. Each color has one job: mauve marks who is
// talking (the reply dot, your prompt's border), lavender marks headings, red marks only failures.
export const THEME: Theme = {
  accent: '#cba6f7', heading: '#b4befe', tableHeader: '#b4befe', strong: '#cdd6f4', emphasis: '#bac2de',
  inlineCode: '#89dceb', codeText: '#cdd6f4', codeCommand: '#89b4fa', codeFlag: '#eba0ac', codeString: '#a6e3a1',
  codeComment: '#6c7086', link: '#89b4fa', path: '#89b4fa', number: '#fab387', quote: '#9399b2',
  rule: '#45475a', tableRule: '#45475a', bullet: '#7f849c', diagram: '#89b4fa', diagramText: '#cdd6f4',
  success: '#a6e3a1', error: '#f38ba8',
}

// Diagram node hues, kept apart from the text roles so a diagram stays colorful.
export const DIAGRAM_HUES = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#89dceb', '#f38ba8', '#cba6f7']

export const ALERT_COLOR = { note: '#89b4fa', tip: '#a6e3a1', important: '#cba6f7', warning: '#f9e2af', caution: '#f38ba8' } as const

export const CLAUDE_DIFF = {
  dark: { addBg: '#022800', delBg: '#3d0101', addWord: '#044700', delWord: '#5c0100', addMark: '#41aa41', delMark: '#be4949', number: '#a3a39f' },
  light: { addBg: '#d6f5d6', delBg: '#fbd5d5', addWord: '#a6e9a6', delWord: '#f5a3a3', addMark: '#2f8a2f', delMark: '#b33b3b', number: '#6b6b6b' },
}

export type Style = {
  theme: Theme
  htmlCopy: ClipboardBackend | null
  cwd: string
  home: string
  inside?: 'quote' | 'alert'
  copyButtonStyle?: 'inline' | 'hover'
  httpLinks?: boolean
  editorLinks?: boolean
  noteKey?: string
}
