import type { Block, Inline } from './markdown'
import type { Style } from './theme'

// Which links and paths draw as clickable hyperlinks (prismantis #238, #240). A click on a file link
// hands its target to the operating system, outside Claude Code's permission prompts.

type Reach = Pick<Style, 'httpLinks' | 'editorLinks' | 'fileLinks' | 'pathLinks' | 'cwd' | 'home'>

export type TerminalEnv = Partial<Record<'FORCE_HYPERLINK' | 'TERM_PROGRAM' | 'TERM_PROGRAM_VERSION' | 'TERM' | 'WT_SESSION' | 'LC_TERMINAL' | 'VTE_VERSION' | 'TERMINAL_EMULATOR', string>>

const HYPERLINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal']

const versionOf = (value = ''): number[] => {
  const short = /^(\d{1,2})(\d{2})$/.exec(value)
  return short ? [0, Number(short[1])] : value.split('.').map(n => Number.parseInt(n, 10))
}

const atLeast = (value: string | undefined, major: number, minor: number): boolean => {
  const [a = Number.NaN, b = Number.NaN] = versionOf(value)
  return a > major || (a === major && b >= minor)
}

const programLinks = (program: string, version: string | undefined): boolean =>
  HYPERLINK_TERMINALS.includes(program)
  || (program === 'WezTerm' && atLeast(version, 20200620, 0))
  || (program === 'vscode' && atLeast(version, 1, 72))
  || (program === 'tmux' && atLeast(version, 3, 4))

// A copy of Claude Code 2.1.303's own rules. Elsewhere the engine draws a Link as its text plus the
// URL, which would lengthen every path, so bare paths link only where these say hyperlinks draw.
export const drawsHyperlinks = (env: TerminalEnv): boolean => {
  if (env.FORCE_HYPERLINK) return Number.parseInt(env.FORCE_HYPERLINK, 10) !== 0
  const term = env.TERM ?? ''
  const vte = env.VTE_VERSION
  return env.WT_SESSION !== undefined
    || programLinks(env.TERM_PROGRAM ?? '', env.TERM_PROGRAM_VERSION)
    || HYPERLINK_TERMINALS.includes(env.LC_TERMINAL ?? '')
    || (vte !== undefined && vte !== '0.50.0' && atLeast(vte, 0, 50))
    || term === 'alacritty' || term.includes('kitty')
    || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
}

// Opening one of these may run it, so a file href to one never links.
const LAUNCHERS = new Set([
  'app', 'command', 'tool', 'terminal', 'pkg', 'mpkg', 'mobileconfig', 'prefpane', 'workflow', 'action', 'fileloc', 'inetloc', 'webloc',
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msu', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'application', 'appref-ms', 'vsix',
  'bat', 'cmd', 'ps1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'chm', 'msc', 'reg', 'xll', 'wsb', 'diagcab', 'ahk', 'au3',
  'lnk', 'url', 'scf', 'settingcontent-ms',
  'desktop', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm', 'snap', 'flatpak', 'flatpakref',
  'jar', 'jnlp', 'py', 'pyw', 'pyz', 'pyzw', 'pyc', 'pl', 'rb', 'rbw',
])

const unescaped = (text: string): string => text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

const extensionOf = (name: string): string => /\.([^.]*)$/.exec(name.replace(/[. ]+$/, ''))?.[1] ?? ''

// Splitting the last name at ':' and control characters catches an NTFS stream (x.exe::$DATA) and a NUL (x.exe%00.txt).
const launches = (href: string): boolean => {
  const path = unescaped(href.replace(/[?#].*$/, '')).toLowerCase().replace(/[/\\]+$/, '')
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return /\.app[/\\]/.test(path) || name.split(/[:\u0000-\u001f]/).some(part => LAUNCHERS.has(extensionOf(part)))
}

const isHyperlink = (href: string, reach: Reach): boolean =>
  (reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href)
  || (reach.editorLinks === true && /^vscode(-insiders)?:\/\/file\//i.test(href))
  || (reach.fileLinks === true && /^file:/i.test(href) && !launches(href))

const plainLink = (text: string, href: string): string => {
  const target = href.replace(/^mailto:/i, '')
  return text === target || `http://${text}` === target ? target : `${text} (${target})`
}

// Claude Code throws out the whole render past this many percent-encoded characters.
const LINK_MAX = 2048

const utf8Bytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

const encodedLength = (href: string): number =>
  [...href].reduce((length, ch) => {
    const cp = ch.codePointAt(0)!
    return length + (cp > 0x20 && cp < 0x7f ? 1 : 3 * utf8Bytes(cp))
  }, 0)

const absolutePath = (reach: Reach, path: string): string | undefined => {
  const base = path.startsWith('~') ? reach.home : path.startsWith('.') ? reach.cwd : '/'
  if (!base) return undefined
  const parts: string[] = []
  for (const part of `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${path.replace(/^~/, '').replace(/(?<=[^/.])\.+$/, '')}`.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `/${parts.join('/')}${path.endsWith('/') ? '/' : ''}`
}

const pathHref = (reach: Reach, path: string): string | undefined => {
  const target = absolutePath(reach, path)
  if (target === undefined || !reach.fileLinks) return undefined
  const href = `file://${encodeURI(target).replace(/[?#]/g, encodeURIComponent)}`
  return href.length <= LINK_MAX && !launches(href) ? href : undefined
}

// The href comes from the tool input's whole path, not the shortened text the row shows.
export const toolHref = (reach: Reach, path: string): string | undefined => {
  if (!reach.pathLinks || !reach.fileLinks) return undefined
  const forward = path.replace(/\\/g, '/')
  if (/^[a-z]:\//i.test(forward)) return pathHref(reach, forward)
  if (!forward.startsWith('//')) return pathHref(reach, /^[/~.]/.test(forward) ? forward : `./${forward}`)
  const href = `file:${encodeURI(forward).replace(/[?#]/g, encodeURIComponent)}`
  return href.length <= LINK_MAX && !launches(href) ? href : undefined
}

// Only Claude Code's own file tools: an MCP tool's path can name a file somewhere else, such as a GitHub repo.
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Grep', 'Glob'])

export const toolPath = (tool: string | undefined, path: string | undefined): string | undefined => (tool !== undefined && FILE_TOOLS.has(tool) ? path : undefined)

const decoded = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text)
  } catch {
    return undefined
  }
}

const linkPath = (href: string): string | undefined => decoded(href.replace(/^file:(\/\/(localhost)?(?=\/))?/i, '').replace(/[?#].*$/, ''))

const labelPath = (reach: Reach, label: string): string | undefined => {
  if (/^file:/i.test(label)) return linkPath(label)
  if (/^([a-z]:[\\/]|\\\\)/i.test(label)) return label.replace(/\\/g, '/').replace(/^(?=[a-z]:)/i, '/')
  if (label.startsWith('/')) return label
  return /^(~|\.{1,2})\//.test(label) ? absolutePath(reach, label) : undefined
}

const withoutSlash = (path: string | undefined): string | undefined => path?.replace(/(?<=.)\/+$/, '')

// A markdown link shows only its label, so a file link stays clickable only when the label is the path it opens.
const hidesFile = (reach: Reach, n: Extract<Inline, { kind: 'link' }>): boolean => {
  const label = n.text.trim().replace(/[.,;:!?]+$/, '')
  if (!/^file:/i.test(n.href) || label === n.href) return false
  const shown = withoutSlash(labelPath(reach, label))
  return shown === undefined || shown !== withoutSlash(linkPath(n.href))
}

// A link Claude Code cannot open draws as its text and target, so nothing looks clickable that is not.
const drawnLink = (n: Extract<Inline, { kind: 'link' }>, reach: Reach): Inline =>
  !isHyperlink(n.href, reach) || encodedLength(n.href) > LINK_MAX || hidesFile(reach, n) ? { kind: 'text', text: plainLink(n.text, n.href) } : n

const drawnPath = (n: Extract<Inline, { kind: 'path' }>, reach: Reach): Inline => {
  const href = reach.pathLinks ? pathHref(reach, n.text) : undefined
  return href === undefined ? n : { ...n, href }
}

const hyperlinks = (nodes: Inline[], reach: Reach): Inline[] =>
  nodes.map(n => (n.kind === 'link' ? drawnLink(n, reach) : n.kind === 'path' ? drawnPath(n, reach) : 'children' in n ? { ...n, children: hyperlinks(n.children, reach) } : n))

const hyperlinkBlock = (block: Block, reach: Reach): Block => {
  const drawn = (nodes: Inline[]) => hyperlinks(nodes, reach)
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return { ...block, inline: drawn(block.inline) }
    case 'list':
      return { ...block, items: block.items.map(item => ({ ...item, inline: drawn(item.inline) })) }
    case 'table':
      return { ...block, header: block.header.map(drawn), rows: block.rows.map(r => r.map(drawn)) }
    case 'notes':
      return { ...block, notes: block.notes.map(note => ({ ...note, inline: drawn(note.inline) })) }
    default:
      return block
  }
}

const hyperlinked = new WeakMap<Block, Record<string, Block>>()

// Hrefs go on once per block, before wrapping, so each wrapped piece of a path carries the whole path.
export const drawable = (block: Block, reach: Reach): Block => {
  const cached = hyperlinked.get(block) ?? {}
  hyperlinked.set(block, cached)
  const key = `${+!!reach.httpLinks}${+!!reach.editorLinks}${+!!reach.fileLinks}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}` : ''}`
  return (cached[key] ??= hyperlinkBlock(block, reach))
}
