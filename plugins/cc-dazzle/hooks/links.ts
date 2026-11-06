import type { Block, Inline } from './markdown'
import { nestedBlocks } from './markdown'
import type { Style } from './theme'

// Which links and paths draw as clickable hyperlinks (prismantis #238, #240). A click on a file link
// hands its target to the operating system, outside Claude Code's permission prompts.

export type Reach = Pick<Style, 'httpLinks' | 'editorLinks' | 'obsidianLinks' | 'fileLinks' | 'pathLinks' | 'cwd' | 'home' | 'found'>

export type TerminalEnv = Partial<Record<'FORCE_HYPERLINK' | 'TERM_PROGRAM' | 'TERM_PROGRAM_VERSION' | 'TERM' | 'WT_SESSION' | 'LC_TERMINAL' | 'VTE_VERSION' | 'TERMINAL_EMULATOR', string>>

const HYPERLINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal', 'Orca']

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

// Obsidian hands a file it has no viewer for to the OS default app, so a launcher in its file or path value never links.
const obsidianTargets = (href: string): string[] => [
  href,
  ...(/\?([^#]*)/.exec(href)?.[1] ?? '').split('&').filter(pair => /^(file|path)=/i.test(unescaped(pair))).map(pair => pair.slice(pair.indexOf('=') + 1).replaceAll('?', '%3F')),
]

const opensObsidianNote = (href: string): boolean =>
  /^obsidian:\/\/(open([?#]|$)|\/)/i.test(href)
  && !/[?&](append|prepend)([=&]|$)/i.test(unescaped(href))
  && !obsidianTargets(href).some(launches)

// Cursor, Windsurf and Zed open a file from <scheme>://file/<path>; their other links reach extensions or actions.
const isHyperlink = (href: string, reach: Reach): boolean =>
  (reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href)
  || (reach.editorLinks === true && /^(vscode(-insiders)?|cursor|windsurf|zed):\/\/file\//i.test(href))
  || (reach.obsidianLinks === true && opensObsidianNote(href))
  || (reach.fileLinks === true && /^file:/i.test(href) && !launches(href) && opens(reach, href))

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

const slashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const absolutePath = (reach: Reach, path: string): string | undefined => {
  const base = path.startsWith('~') ? reach.home : path.startsWith('.') ? reach.cwd : '/'
  if (!base) return undefined
  const parts: string[] = []
  for (const part of `${slashes(base)}/${path.replace(/^~/, '').replace(/(?<=[^/.])\.+$/, '')}`.split('/')) {
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

// macOS runs an extensionless executable on open (/bin/sh, /usr/bin/say), and a stat reports no mode
// bits, so a path with no extension, or a numeric one, links only once a stat finds a folder there.
const bare = (path: string): boolean => /^\d*$/.test(extensionOf(path.replace(/[/\\]+$/, '').replace(/^.*[/\\]/, '')))

const hrefPath = (href: string): string => (linkPath(href) ?? href).replace(/^\/(?=[a-z]:)/i, '').replace(/(?<=.)\/+$/, '')

export const opens = (reach: Reach, href: string): boolean => {
  const path = hrefPath(href)
  return !bare(path) || reach.found?.has(`${path}/`) === true
}

const bareKey = (href: string | undefined): string[] => (href === undefined || !bare(hrefPath(href)) ? [] : [hrefPath(href)])

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

const ZERO_WIDTH = /[\p{Cf}\u034f\u180e]/gu

const WEB_TLDS = new Set(['com', 'org', 'net', 'io', 'dev', 'app', 'ai', 'co', 'gov', 'edu', 'info', 'biz', 'me', 'xyz', 'example', 'test', 'uk', 'de', 'fr', 'eu', 'ie', 'il', 'ca', 'au', 'jp', 'cn', 'ru', 'br', 'in'])

const hostOf = (href: string): string | undefined => /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(href)?.[1]?.toLowerCase().replace(/^www\./, '')

// The label as a person reads it: markup, odd dots, a leading // and a user@ part leave the host they see.
const shownHost = (label: string): string =>
  label.replace(/[*_~`]/g, '').replace(/[\u3002\uff0e\uff61]/gu, '.').trim().replace(/\.$/, '').replace(/^\/\//, '').replace(/^([a-z][\w+.-]*:\/\/)?[^@/?#\s]*@/i, '$1')

const labelHost = (label: string): string | undefined => {
  const m = /^([a-z][\w+.-]*:\/\/)?((?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)(?::\d+)?(?:[/?#]\S*)?$/iu.exec(shownHost(label))
  const host = m?.[2]?.toLowerCase().replace(/^www\./, '')
  return host && (m![1] || host !== m![2]!.toLowerCase() || WEB_TLDS.has(host.slice(host.lastIndexOf('.') + 1))) ? host : undefined
}

// A label that names one host over a link to another, or hides format characters in a host name, is a spoof.
const spoofs = (label: string, href: string): boolean => {
  const clean = label.replace(ZERO_WIDTH, '')
  const shown = labelHost(clean)
  if (shown === undefined) return false
  const real = hostOf(href) ?? ''
  return clean !== label || (real !== shown && !real.endsWith(`.${shown}`))
}

// A link Claude Code cannot open draws as its text and target, so nothing looks clickable that is not.
export const drawnLink = (n: Extract<Inline, { kind: 'link' }>, reach: Reach): Inline =>
  !isHyperlink(n.href, reach) || encodedLength(n.href) > LINK_MAX || hidesFile(reach, n) || spoofs(n.text, n.href) ? { kind: 'text', text: plainLink(n.text.replace(ZERO_WIDTH, ''), n.href) } : n

// Slash commands like /config are one-part paths and stay text; /tmp/app.ts links.
const linksAsPath = (path: string): boolean => !path.startsWith('/') || /^\/[^/]+\/+[^/]/.test(path.replace(/\.+$/, ''))

export const drawnPath = (n: Extract<Inline, { kind: 'path' }>, reach: Reach): Inline => {
  const href = reach.pathLinks && linksAsPath(n.text) ? pathHref(reach, n.text) : undefined
  return href === undefined || !opens(reach, href) ? n : { ...n, href }
}

// Paths like docs/guide/, src/app.ts:42, notes.md and C:\work\plan.md read like prose by spelling, so
// they link only once a stat finds them: pathsToProbe collects them and register.tsx stats them.
const PART = String.raw`[\p{L}\p{N}_@+-]+`
const NAME = String.raw`\.?${PART}(?:\.${PART})*`
const LOOSE_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}_/\\.:~@+-])(?:[A-Za-z]:[\\/](?:${NAME}[\\/])*(?:${NAME})?|${NAME}(?:\/${NAME})*\/(?:${NAME})?|${PART}(?:\.${PART})+)(?![\p{L}\p{N}_/\\@+-]|\.[\p{L}\p{N}])`, 'gu')

type Probe = { key: string; href: string }

const looseProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const drive = /^[a-z]:[\\/]/i.test(spelling)
  if (!drive && !reach.cwd) return undefined
  const href = toolHref(reach, spelling)
  const key = drive ? spelling.replace(/\\/g, '/') : `${slashes(reach.cwd)}/${spelling}`
  return href === undefined ? undefined : { key: key.replace(/(?<=[^/:])\/+$/, ''), href }
}

const looseSpellings = (text: string): RegExpExecArray[] => [...text.matchAll(LOOSE_PATH)]

const isWholePath = (text: string): boolean => looseSpellings(text).some(m => m[0] === text)

const foundProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const probe = looseProbe(reach, spelling)
  return probe && reach.found?.has(probe.key) && opens(reach, probe.href) ? probe : undefined
}

const loosePaths = (n: Extract<Inline, { kind: 'text' }>, reach: Reach): Inline[] => {
  const out: Inline[] = []
  let at = 0
  for (const m of looseSpellings(n.text)) {
    const probe = foundProbe(reach, m[0])
    if (!probe) continue
    if (m.index > at) out.push({ kind: 'text', text: n.text.slice(at, m.index) })
    out.push({ kind: 'path', text: m[0], href: probe.href })
    at = m.index + m[0].length
  }
  if (at === 0) return [n]
  if (at < n.text.length) out.push({ kind: 'text', text: n.text.slice(at) })
  return out
}

const looseNode = (n: Inline, reach: Reach): Inline | Inline[] => {
  if (n.kind === 'text') return loosePaths(n, reach)
  if (n.kind !== 'code') return n
  const probe = isWholePath(n.text) ? foundProbe(reach, n.text) : undefined
  return probe ? { ...n, href: probe.href } : n
}

const linked = (n: Inline, reach: Reach): Inline =>
  n.kind === 'link' ? drawnLink(n, reach) : n.kind === 'path' ? drawnPath(n, reach) : 'children' in n ? { ...n, children: hyperlinks(n.children, reach) } : n

export const hyperlinks = (nodes: Inline[], reach: Reach): Inline[] =>
  reach.found?.size ? nodes.flatMap(node => looseNode(linked(node, reach), reach)) : nodes.map(node => linked(node, reach))

const spellingsIn = (nodes: Inline[]): string[] =>
  nodes.flatMap(n => {
    if ('children' in n) return spellingsIn(n.children)
    if (n.kind === 'code') return isWholePath(n.text) ? [n.text] : []
    return n.kind === 'text' ? looseSpellings(n.text).map(m => m[0]) : []
  })

const inlinesOf = (block: Block): Inline[][] => {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return [block.inline]
    case 'list':
      return block.items.map(item => item.inline)
    case 'table':
      return [...block.header, ...block.rows.flat()]
    case 'notes':
      return block.notes.map(note => note.inline)
    default:
      return []
  }
}

const spelled = new WeakMap<Block, string[]>()

const bareKeysIn = (nodes: Inline[], reach: Reach): string[] =>
  nodes.flatMap(n => {
    if (n.kind === 'path') return reach.pathLinks && linksAsPath(n.text) ? bareKey(pathHref(reach, n.text)) : []
    if (n.kind === 'link') return /^file:/i.test(n.href) ? bareKey(n.href) : []
    return 'children' in n ? bareKeysIn(n.children, reach) : []
  })

export const pathsToProbe = (blocks: Block[], reach: Reach): string[] => {
  if (!reach.fileLinks) return []
  return nestedBlocks(blocks).flatMap(block => {
    const spellings = spelled.get(block) ?? inlinesOf(block).flatMap(spellingsIn)
    spelled.set(block, spellings)
    const loose = reach.pathLinks ? spellings.flatMap(spelling => looseProbe(reach, spelling)?.key ?? []) : []
    return [...loose, ...inlinesOf(block).flatMap(nodes => bareKeysIn(nodes, reach))]
  })
}

const PATH_FIELDS = ['file_path', 'notebook_path', 'path']

const pathField = (input: unknown, key: string): string | undefined => {
  const value = input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export const toolPathsToProbe = (reach: Reach, inputs: unknown[]): string[] =>
  reach.pathLinks && reach.fileLinks ? inputs.flatMap(input => PATH_FIELDS.flatMap(k => { const path = pathField(input, k); return path === undefined ? [] : bareKey(toolHref(reach, path)) })) : []

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
  const key = `${+!!reach.httpLinks}${+!!reach.editorLinks}${+!!reach.obsidianLinks}${+!!reach.fileLinks}\0${reach.found?.size ?? 0}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}` : ''}`
  return (cached[key] ??= hyperlinkBlock(block, reach))
}
