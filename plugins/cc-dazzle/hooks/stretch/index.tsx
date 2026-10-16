import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { closeAfter, codeSpanEnd, hideLongForms, isLinkable, isOpenable, KEY_SEPARATOR, paragraphsOf, parse, stretches } from './parse'
import type { Segment, StreamState, Stretch } from './parse'
import { THEME } from '../theme'
import { FRESH } from './layout'
import type { ReplyPost, ReplyProps, Tint } from './reply'

// Stretchtext, ported from cc-stretch 0.3.3 (pro-vi/cc-stretch). A reply's `{{short|long}}` stretches
// draw as their short forms; a press grows one in place and « shrinks it back.

const openStretches = atom({ plugin: 'cc-dazzle', key: 'stretchOpen' } as const, [])
const seen = atom({ plugin: 'cc-dazzle', key: 'stretchSeen' } as const, [])
const stretchOrder = atom({ plugin: 'cc-dazzle', key: 'stretchOrder' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'cc-dazzle', key: 'stretchNewest' } as const, '')

// Claude Code 2.1.300 can start a session on the main screen even with fullscreen set, and the
// variable overrides that.
const MAIN_SCREEN_NOTE =
  "cc-dazzle: stretches are open because this session is on Claude Code's main screen, where a printed reply cannot change. " +
  'For clickable stretches, run /tui fullscreen. If it says fullscreen is already on, start Claude Code with CLAUDE_CODE_NO_FLICKER=1, which forces fullscreen.'

// Every link drawn here is answered here and never followed; a ctrl- or cmd-click opens it in a
// browser, so it points at a reserved name that resolves nowhere.
const HREF = 'https://cc-dazzle.invalid/'

const NO_CLICK =
  'Stretchtext: no click on a stretch of your last reply was recorded. The reader may have read only the short forms; where clicks do not reach the plugin (the classic renderer, apps other than the terminal and the Claude desktop app), every stretch was drawn open.'

/** A reply's text with every stretch written as its long form; the text itself when it has none. */
export function openText(text: string): string {
  if (!text.includes('{{')) return text
  const parts = parse(text)
  return stretches(parts).length === 0 ? text : writeOpen(parts)
}

/**
 * The note for Claude on the person's next prompt: which stretches of the last reply they opened and
 * which not. Undefined when the last reply had none to open.
 */
export async function stretchNote($: EngineInterface): Promise<string | undefined> {
  const opened = await read($, seen)
  // A stretch that is not a link is drawn open, so it is neither opened nor unopened.
  const written = stretches(parse(lastReply(await $.session.messages())))
    .filter(isLinkable)
    .map(stretch => stretch.short.trim())
  const unopened = written.filter(short => !opened.includes(short))
  await update($, seen, () => [])
  await update($, newestReply, () => '')
  if (opened.length === 0 && unopened.length === 0) return undefined

  const quote = (list: string[]) => list.map(s => `"${s}"`).join(', ')
  return opened.length > 0
    ? `Stretchtext: since your last reply the reader opened ${quote(opened)}.${unopened.length > 0 ? ` They did not open ${quote(unopened)}.` : ''}`
    : NO_CLICK
}

// Claude Code 2.1.300 hands AssistantMessage the display text the stream filter wrote, so a finished
// reply arrives with its long forms gone. Each filtered text maps back to the reply as written.
const written = new Map<string, string>()
// Replies streamed after the module loaded are remembered as they stream, so the session is read once.
let hasScanned = false
const remember = (shown: string, raw: string) => {
  written.set(shown.trim(), raw)
  if (written.size > 500) written.delete(written.keys().next().value!)
}

/**
 * A reply's text as Claude wrote it, stretches included. A reply streamed before the module loaded
 * is found among the session's messages by filtering each the way the stream did.
 */
export async function writtenText($: EngineInterface, text: string): Promise<string> {
  const key = text.trim()
  if (key === '' || text.includes('{{')) return text
  const known = written.get(key)
  if (known !== undefined || hasScanned) return known ?? text
  hasScanned = true
  const messages = await $.session.messages().catch(() => [])
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.text.includes('{{')) continue
    const shown = hideLongForms(message.text, { open: [], fence: undefined })
    if (shown !== message.text) remember(shown, message.text)
  }
  return written.get(key) ?? text
}

/** The hooks that teach Claude the markup, hide it while a reply streams and keep what the reader opened. The note goes out from cc-dazzle's own prompt.submit hook. */
export function registerStretch(on: On): void {
  // While a reply streams, Claude Code draws its lines before the reply reaches AssistantMessage.
  // One filter state per message, until its final flush; null for a message left as written.
  const streams = new Map<string, { state: StreamState | null; raw: string; shown: string }>()
  on('classic.MessageDisplay', async ($, e, next) => {
    const answer = await next(e)
    // The desktop app draws a finished reply from this display text, so hiding the long forms here
    // would strip the markup its links are made from. Decided on a message's first flush.
    let stream = streams.get(e.message_id)
    if (stream === undefined) stream = { state: (await $.session.surfaces()).includes('desktop') ? null : { open: [], fence: undefined }, raw: '', shown: '' }
    if (e.final) streams.delete(e.message_id)
    else streams.set(e.message_id, stream)
    if (stream.state === null) return answer

    const raw = answer.displayContent ?? e.delta
    const shown = hideLongForms(raw, stream.state)
    stream.raw += raw
    stream.shown += shown
    if (e.final && stream.raw !== stream.shown) remember(stream.shown, stream.raw)
    return { ...answer, displayContent: shown }
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed

    return { sections: [...composed.sections, { id: 'cc-dazzle:stretch-guide', text: GUIDE, scope: 'session' }] }
  })

  // A paragraph's Client posts the stretches open in it whenever they change, and the one the reader
  // just opened. Kept here, they survive a redraw, reach the next prompt and keep their colours.
  on('ui.message', async ($, e, next) => {
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened } = post
    if (opened !== undefined) await update($, seen, list => (list.includes(opened.short) ? list : [...list, opened.short]))

    // Each open stretch keeps the count it was opened at, across the reply's paragraphs. The newest
    // is the open stretch with the reply's last count.
    const here = `${e.element}#`
    await update($, memberOf(stretchOrder, { requestId: e.requestId }), ({ order, count }) => {
      const kept = Object.fromEntries(Object.entries(order).filter(([at]) => !at.startsWith(here) || post.open.includes(at.slice(here.length))))
      if (opened === undefined) return { order: kept, count }
      return { order: { ...kept, [`${here}${opened.key}`]: count }, count: count + 1 }
    })
    if (opened !== undefined) await update($, newestReply, () => e.requestId)
    return next(e)
  })
}

// The reply that says why stretches are open on the main screen: the first drawn there since the
// module loaded. A render hook cannot write plugin state, so it is kept here.
let notedRequest: string | undefined

/**
 * A reply's body when it holds a stretch, undefined when it holds none. `draw` draws markdown the
 * way cc-dazzle does; in the fullscreen terminal a paragraph holding a stretch is drawn by a Client.
 * `framed` says the body draws the reply's gutter itself, as a Client marks rows in it.
 */
export async function stretchBody($: EngineInterface, e: RenderInput & { props: { text: string; isFirstOfReply?: boolean } }, draw: (text: string) => RenderElement[]): Promise<{ body: RenderElement[]; framed: boolean } | undefined> {
  if (!e.props.text.includes('{{')) return undefined
  const parts = parse(e.props.text)
  const all = stretches(parts)
  if (all.length === 0) return undefined

  // The desktop app draws markdown links and hands a press on one to the plugin: the whole block is
  // one Markdown whose closed stretches are links that open in place, each open one ending in a «.
  if (e.surface === 'desktop') {
    const { Markdown } = $.ui.resolve(e)
    const open = memberOf(openStretches, { requestId: `${e.requestId}#desktop` })
    const links: string[] = []
    const text = linkedMarkdown(parts, await read($, open), all, links)
    const press = async (href: string) => {
      const [action, index] = href.slice(HREF.length).split('/')
      const stretch = all[Number(index)]
      if (stretch === undefined) return
      const { key } = stretch
      if (action === 'close') {
        await update($, open, list => list.filter(k => k !== key && !k.startsWith(key + KEY_SEPARATOR)))
        return
      }
      if (action !== 'open') return
      await update($, open, list => (list.includes(key) ? list : [...list, key]))
      const short = stretch.short.trim()
      await update($, seen, list => (list.includes(short) ? list : [...list, short]))
    }
    return { body: [<Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />], framed: false }
  }

  if (canPress(e)) {
    const { Box, Client, Text } = $.ui.resolve(e)
    const [{ order, count }, newest] = await Promise.all([read($, memberOf(stretchOrder, { requestId: e.requestId })), read($, newestReply)])
    const body = await Promise.all(
      paragraphsOf(e.props.text).map(async (paragraph, i) => {
        const key = `paragraph-${i}`
        const dot = i === 0 && e.props.isFirstOfReply === true
        if (!paragraph.hasStretch) {
          return (
            <Box key={key} flexDirection="row">
              <Box width={2} flexShrink={0}><Text color={THEME.accent}>{dot ? '●' : ' '}</Text></Box>
              <Box flexDirection="column" rowGap={1} flexGrow={1}>{draw(paragraph.text)}</Box>
            </Box>
          )
        }
        const open = await read($, memberOf(openStretches, { requestId: `${e.requestId}#${key}` }))
        const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1)
        return <Client key={key} module="./reply.tsx" props={{ text: paragraph.text, open, tints, dot } satisfies ReplyProps} width="100%" />
      }),
    )
    return { body, framed: true }
  }

  // Where a press is not known to land, every stretch is drawn open and nothing is hidden; on the
  // main screen the first such reply says why.
  const { Text } = $.ui.resolve(e)
  if (isMainScreen(e)) notedRequest ??= e.requestId
  const body = draw(writeOpen(parts))
  return { body: isMainScreen(e) && notedRequest === e.requestId ? [...body, <Text key="stretch-note" dimColor>{MAIN_SCREEN_NOTE}</Text>] : body, framed: false }
}

/** The tint of each open stretch in one paragraph: FRESH for the one opened at `newest`, none for the rest, and a grey closer. */
function tintsOf(order: Record<string, number>, paragraph: string, newest: number): Record<string, Tint> {
  const here = `${paragraph}#`
  return Object.fromEntries(
    Object.entries(order)
      .filter(([at]) => at.startsWith(here))
      .flatMap(([at, n]) => {
        return [[at.slice(here.length), { words: n === newest ? FRESH : '', closer: THEME.bullet ?? '' }]]
      }),
  )
}

/**
 * A reply as markdown for the desktop: each closed stretch a link, each open one its long form then a «.
 * A link names its stretch by its place in `all`, not by its key, which can hold any character and run
 * past the 2048 characters a `pressableLinks` entry may have (Claude Code 2.1.295).
 */
function linkedMarkdown(parts: Segment[], open: readonly string[], all: Stretch[], links: string[]): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      if (!isOpenable(part) || part.long === undefined) return part.short
      if (!isLinkable(part)) return part.long.length === 0 ? part.short : linkedMarkdown(part.long, open, all, links)
      const index = all.indexOf(part)
      if (open.includes(part.key)) {
        const close = `${HREF}close/${index}`
        links.push(close)
        return closeAfter(linkedMarkdown(part.long, open, all, links), `[«](${close})`, '\n\n')
      }
      const href = `${HREF}open/${index}`
      links.push(href)
      return `[${labelOf(part.short)}](${href})`
    })
    .join('')
}

/** A short form as link text: outside code spans, a link becomes its text and target, and brackets and backslashes are escaped. */
function labelOf(short: string): string {
  const plain = (text: string) => text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/([[\]\\])/g, '\\$1')
  let label = ''
  let from = 0
  for (let at = short.indexOf('`'); at !== -1; at = short.indexOf('`', from)) {
    const stop = codeSpanEnd(short, at)
    label += plain(short.slice(from, at)) + short.slice(at, stop)
    from = stop
  }

  return label + plain(short.slice(from))
}

function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('short' in opened) || !('key' in opened)) return { open }
  const { short, key } = opened

  return typeof short === 'string' && typeof key === 'string' ? { open, opened: { short, key } } : { open }
}

/** The text of the model's last reply: its rows after the person's last prompt. */
function lastReply(messages: SessionMessage[]): string {
  const texts: string[] = []
  for (const message of [...messages].reverse()) {
    if (message.role === 'user' && (message.toolResults?.length ?? 0) === 0 && message.text !== '') break
    if (message.role === 'assistant') texts.unshift(message.text)
  }

  return texts.join('\n')
}

// A press on a Client is known to land only in the fullscreen terminal. In the desktop app (Claude
// Code 2.1.293) a press on a Client's one-cell « missed, so the desktop draws Markdown links instead.
function canPress<E extends Pick<RenderInput, 'surface' | 'viewport'>>(e: E): e is E & { surface: 'terminal' } {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true
}

// The terminal's main screen prints each reply into its scrollback, where nothing can change it.
function isMainScreen(e: Pick<RenderInput, 'surface' | 'viewport'>): boolean {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === false
}
