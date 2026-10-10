export type Table = { header: string[]; rows: string[][] }

/** Past this many rows the output keeps its own drawing, so a table never hides a row. */
export const MAX_ROWS = 20
const MAX_COLUMNS = 10
const SCALAR_WIDTH = 60

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The text a tool's record holds, or null when it is not plain text the table could stand for. */
export function outputText(tool: string, output: unknown): string | null {
  if (tool === 'Bash') {
    if (!isRecord(output) || typeof output.stdout !== 'string') return null
    // Anything else the engine draws under the stdout stays the engine's to draw.
    const hasExtras =
      (typeof output.stderr === 'string' && output.stderr.trim() !== '') ||
      output.interrupted === true ||
      output.isImage === true ||
      output.backgroundTaskId !== undefined ||
      output.returnCodeInterpretation !== undefined ||
      output.persistedOutputPath !== undefined ||
      output.timedOutAfterMs !== undefined
    return hasExtras ? null : output.stdout
  }
  if (!tool.startsWith('mcp__')) return null
  if (typeof output === 'string') return output
  const blocks = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.content) ? output.content : null
  if (blocks === null || blocks.length === 0) return null
  const texts = blocks.map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : null))
  return texts.every(text => text !== null) ? texts.join('\n') : null
}

function cellOf(value: unknown): string | null {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return json.length <= SCALAR_WIDTH ? json : null
}

function fromJson(text: string): Table | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_ROWS || !parsed.every(isRecord)) return null
  const header = [...new Set(parsed.flatMap(row => Object.keys(row)))]
  if (header.length === 0 || header.length > MAX_COLUMNS) return null
  const rows: string[][] = []
  for (const row of parsed) {
    const cells = header.map(key => cellOf(row[key]))
    if (cells.some(cell => cell === null)) return null
    rows.push(cells as string[])
  }
  return { header, rows }
}

/** One CSV line's fields, with quoted fields and doubled quotes. */
function csvFields(line: string): string[] | null {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      fields.push(field)
      field = ''
    } else field += ch
  }
  if (quoted) return null
  fields.push(field)
  return fields
}

/** A first line that names columns: short words that start with a letter, none twice. */
const isHeader = (cells: readonly string[]) =>
  cells.every(cell => /^[A-Za-z][\w .\-/()#%]{0,31}$/.test(cell.trim())) && new Set(cells.map(cell => cell.trim().toLowerCase())).size === cells.length

function fromDelimited(text: string): Table | null {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()
  if (lines.length < 2 || lines.length > MAX_ROWS + 1) return null
  const delimiter = lines[0]?.includes('\t') ? '\t' : ','
  // A comma and a space is how prose lists things; a CSV header packs its names.
  if (delimiter === ',' && lines[0]?.includes(', ')) return null
  const split = (line: string) => (delimiter === '\t' ? line.split('\t') : csvFields(line))
  const parsed = lines.map(split)
  const width = parsed[0]?.length ?? 0
  if (width < 2 || width > MAX_COLUMNS || parsed.some(fields => fields === null || fields.length !== width)) return null
  const [header, ...rows] = parsed as string[][]
  if (header === undefined || !isHeader(header)) return null
  return { header: header.map(cell => cell.trim()), rows: rows.map(row => row.map(cell => cell.trim())) }
}

/** The output as a table: a JSON array of objects, or CSV or TSV under a header line. */
export function tableOf(text: string): Table | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return trimmed.startsWith('[') ? fromJson(trimmed) : fromDelimited(trimmed)
}

const escape = (cell: string) => cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

export function markdown(table: Table): string {
  const line = (cells: readonly string[]) => `| ${cells.map(escape).join(' | ')} |`
  return [line(table.header), `|${table.header.map(() => '---').join('|')}|`, ...table.rows.map(line)].join('\n')
}
