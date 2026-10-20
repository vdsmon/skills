import type { Call, Turn } from '../types'

export type Kind = 'read' | 'edit' | 'shell' | 'agent' | 'mcp' | 'other'

const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'LSP', 'NotebookRead'])
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export function kindOf(tool: string): Kind {
  if (READS.has(tool)) return 'read'
  if (EDITS.has(tool)) return 'edit'
  if (tool === 'Bash' || tool === 'PowerShell') return 'shell'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool.startsWith('mcp__')) return 'mcp'
  return 'other'
}

const oneLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
const baseName = (path: string) => path.split('/').filter(part => part !== '').pop() ?? path

/** The tool's name as a row shows it: an MCP tool by its own name. */
export const toolName = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool)

export function labelOf(tool: string, input: Readonly<Record<string, unknown>>): string {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  if (tool === 'Bash' || tool === 'PowerShell') return oneLine(text('description') || text('command'))
  if (EDITS.has(tool) || tool === 'Read' || tool === 'NotebookRead') return baseName(text('file_path') || text('notebook_path'))
  if (tool === 'Grep' || tool === 'Glob') return text('pattern')
  if (tool === 'Agent' || tool === 'Task') return text('description')
  if (tool === 'WebFetch') return text('url').replace(/^https?:\/\//, '').split('/')[0] ?? ''
  if (tool === 'WebSearch') return text('query')
  if (tool === 'Skill') return text('skill')
  if (tool.startsWith('mcp__')) return tool.split('__')[1] ?? ''
  return ''
}

export function duration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds === 60 ? `${minutes + 1}m00s` : `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** Eighths of a cell, for a bar's last cell. */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/**
 * A bar from `start` to `end` on an axis of `width` cells from `from` over
 * `span` ms: the blank cells before it and the bar itself, at least one
 * eighth of a cell wide.
 */
export function bar(start: number, end: number, from: number, span: number, width: number): { pad: string; bar: string } {
  const scale = span <= 0 ? 0 : width / span
  const left = Math.min(width - 1, Math.max(0, Math.floor((start - from) * scale)))
  const eighths = Math.max(1, Math.round((end - start) * scale * 8))
  const room = (width - left) * 8
  const length = Math.min(eighths, room)
  return { pad: ' '.repeat(left), bar: '█'.repeat(Math.floor(length / 8)) + EIGHTHS[length % 8] }
}

/** Where a turn's axis starts and how long it is: from its start to its last end, a running call's at `now`. */
export function span(turn: Turn, now: number): { from: number; span: number } {
  const ends = [turn.end ?? now, ...turn.calls.map(call => call.end ?? now)]
  return { from: turn.start, span: Math.max(1, Math.max(...ends) - turn.start) }
}

/** The calls in drawing order, each with its depth: a subagent's calls under its Agent call. */
export function ordered(calls: readonly Call[]): { call: Call; depth: number }[] {
  const ids = new Set(calls.map(call => call.id))
  const children = new Map<string, Call[]>()
  const roots: Call[] = []
  for (const call of calls) {
    if (call.parentId !== undefined && ids.has(call.parentId)) children.set(call.parentId, [...(children.get(call.parentId) ?? []), call])
    else roots.push(call)
  }
  const out: { call: Call; depth: number }[] = []
  const walk = (call: Call, depth: number) => {
    out.push({ call, depth })
    for (const child of children.get(call.id) ?? []) walk(child, depth + 1)
  }
  for (const call of roots) walk(call, 0)
  return out
}
