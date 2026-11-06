// Whether a tool call only reads, from prismantis's quiet tool rows (#425): path misses stay cached across these.

const field = (input: unknown, key: string): string | undefined => {
  const value = input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'Skill'])

const READ_COMMANDS = new Set([
  'awk', 'basename', 'cat', 'cd', 'column', 'cut', 'diff', 'dirname', 'du', 'echo', 'file', 'find', 'grep', 'head', 'jq', 'less',
  'ls', 'nl', 'pdftotext', 'printf', 'pwd', 'readlink', 'realpath', 'rg', 'sed', 'sort', 'stat', 'tail', 'test', 'tr', 'tree',
  'true', 'uniq', 'wc', 'which',
])

const READ_SUBCOMMANDS: Record<string, RegExp> = {
  git: /^(log|show|diff|status|blame|grep|ls-files|rev-parse|branch --show-current)\b/,
  gh: /^((pr|issue|run|release) (view|list|diff|checks)|search)\b/,
}

const flagValue = (args: string[], i: number, flag: string): string => {
  const arg = args[i]!
  return arg === flag ? (args[i + 1] ?? '') : arg.slice(flag.length).replace(/^=/, '')
}

const ghApiReadsOnly = (rest: string[]): boolean =>
  !rest.some((a, i) => {
    if (/^(-[fF]|--field|--raw-field|--input)/.test(a)) return true
    if (!/^(-X|--method)/.test(a)) return false
    return !/^GET$/i.test(flagValue(rest, i, a.startsWith('--') ? '--method' : '-X'))
  })

type ShellPart = { words: string[]; piped: boolean }

const HEREDOC = /<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g

const dropHeredocBodies = (command: string): string => {
  const lines = command.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line)
    for (const [, , end] of line.matchAll(HEREDOC)) {
      while (i + 1 < lines.length && lines[i + 1]!.trim() !== end) i++
      i++
    }
  }
  return out.join('\n')
}

const parseShell = (source: string): { segments: ShellPart[]; redirects: boolean } => {
  const command = dropHeredocBodies(source)
  const segments: ShellPart[] = [{ words: [], piped: false }]
  let word = ''
  let quote = ''
  let started = false
  let redirects = false
  const current = () => segments[segments.length - 1]!
  const endWord = () => {
    if (started) current().words.push(word)
    word = ''
    started = false
  }
  const endSegment = (piped: boolean) => {
    endWord()
    if (current().words.length) segments.push({ words: [], piped })
    else current().piped = piped
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && /[$`"\\\n]/.test(command[i + 1] ?? '')) word += command[++i]
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (ch === '\\' && command[i + 1] === '\n') {
      i++
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]
      started = true
    } else if (ch === '\n' || ch === ';') {
      endSegment(false)
    } else if (ch === '&' && command[i + 1] === '&') {
      i++
      endSegment(false)
    } else if (ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '|' && command[i - 1] !== '>') {
      endSegment(false)
    } else if (ch === '|') {
      const or = command[i + 1] === '|'
      if (or) i++
      endSegment(!or)
    } else if (ch === '>' || ch === '<') {
      const harmless = ch === '>' && /^(&\d|\s*\/dev\/null)/.exec(command.slice(i + 1))
      if (harmless) i += harmless[0].length
      else redirects = true
      if (/^(\d|&)$/.test(word)) {
        word = ''
        started = false
      }
      endWord()
    } else if (/\s/.test(ch)) {
      endWord()
    } else {
      word += ch
      started = true
    }
  }
  endWord()
  return { segments: segments.filter(s => s.words.length), redirects }
}

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '(', 'time'])
const HEADER_KEYWORDS = new Set(['for', 'select', 'done', 'fi', 'esac', '}', ')'])

const commandWords = (words: string[]) => {
  let i = 0
  while (i < words.length && (isAssignment(words[i]!) || LEADING_KEYWORDS.has(words[i]!))) i++
  return HEADER_KEYWORDS.has(words[i] ?? '') ? [] : words.slice(i)
}

const readsOnly = ({ words }: ShellPart): boolean => {
  const [name, ...rest] = commandWords(words)
  if (name === undefined) return true
  const args = rest.join(' ')
  if (name === 'gh' && rest[0] === 'api') return ghApiReadsOnly(rest.slice(1))
  if (Object.hasOwn(READ_SUBCOMMANDS, name)) return READ_SUBCOMMANDS[name]!.test(args) && !(name === 'git' && rest.some(a => /^--output\b/.test(a)))
  if (!READ_COMMANDS.has(name)) return false
  if (name === 'sed') {
    const [script, ...files] = rest.filter(a => a !== '-n')
    return script !== undefined && /^\d+(,\d+)?p$/.test(script) && files.every(f => !f.startsWith('-'))
  }
  if (name === 'find') return !rest.some(a => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a))
  if (name === 'awk') return !rest.some(a => /^(-f|--file|-i|--include|-E|--exec|-l|--load)/.test(a)) && !/system\s*\(|getline|@(include|load)|[|>]/.test(args)
  if (name === 'sort') return !rest.some(a => /^(-[A-Za-z]*o|--output)/.test(a))
  if (name === 'uniq') return operandsOf(name, rest).length < 2
  if (name === 'tree') return !rest.some(a => /^(-o|--output)/.test(a))
  if (name === 'rg') return !rest.some(a => /^--pre/.test(a))
  if (name === 'pdftotext') return rest.at(-1) === '-'
  return true
}

const VALUE_FLAGS: Record<string, Set<string>> = {
  grep: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '--max-count', '--include', '--exclude', '--exclude-dir']),
  rg: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '-g', '-t', '--type', '--glob', '--max-count', '--max-depth']),
  tree: new Set(['-L', '-P', '-I']),
  uniq: new Set(['-f', '-s', '-w']),
}

const operandsOf = (name: string, args: string[]): string[] => {
  const valued = VALUE_FLAGS[name]
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (valued?.has(a)) i++
    else if (!a.startsWith('-')) out.push(a)
  }
  return out
}

export const isReadOnlyCall = (tool: string, input: unknown): boolean => {
  if (READ_TOOLS.has(tool)) return true
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  const command = field(input, 'command')
  if (command === undefined) return false
  if (/\$\(|`|<<|\btee\b/.test(command)) return false
  const shell = parseShell(command)
  return !shell.redirects && shell.segments.every(readsOnly)
}
