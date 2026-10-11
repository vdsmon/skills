import type { ClipboardBackend } from './clipboard'

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode', 'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment',
  'link', 'path', 'number', 'quote', 'rule', 'tableHeader', 'tableRule', 'bullet', 'diagram', 'diagramText',
] as const

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>

// Catppuccin Mocha, the one palette cc-dazzle draws in.
export const THEME: Theme = {
  accent: '#cba6f7', heading: '#f9e2af', tableHeader: '#f9e2af', strong: '#ffffff', emphasis: '#f5c2e7',
  inlineCode: '#89dceb', codeText: '#cdd6f4', codeCommand: '#89b4fa', codeFlag: '#f38ba8', codeString: '#a6e3a1',
  codeComment: '#6c7086', link: '#89b4fa', path: '#89dceb', number: '#a6e3a1', quote: '#9399b2',
  rule: '#45475a', tableRule: '#585b70', bullet: '#cba6f7', diagram: '#89b4fa', diagramText: '#cdd6f4',
}

export const CLAUDE_DIFF = {
  dark: { addBg: '#022800', delBg: '#3d0101', addWord: '#044700', delWord: '#5c0100', addMark: '#41aa41', delMark: '#be4949', number: '#a3a39f' },
  light: { addBg: '#d6f5d6', delBg: '#fbd5d5', addWord: '#a6e9a6', delWord: '#f5a3a3', addMark: '#2f8a2f', delMark: '#b33b3b', number: '#6b6b6b' },
}

export type Style = {
  theme: Theme
  htmlCopy: ClipboardBackend | null
  cwd: string
  home: string
}
