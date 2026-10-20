import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { closeAfter, codeSpan, hideLongForms, isLinkable, isOpenable, KEY_SEPARATOR, newStreamState, paragraphsOf, parse, stretches } from './parse'
import type { Segment, StreamState, Stretch } from './parse'
import type { Reach } from '../links'
import { THEME } from '../theme'
import { FRESH, namesOf, openedOf, targetsIn } from './layout'
import type { Action, OpenedStretch } from './layout'
import type { ReplyPost, ReplyProps, Tint } from './reply'

// Stretchtext, ported from cc-stretch 0.3.3 (pro-vi/cc-stretch) with features up to 0.5.2. A reply's `{{short|long}}` stretches
// draw as their short forms; a press grows one in place and « shrinks it back.

const openStretches = atom({ plugin: 'cc-dazzle', key: 'stretchOpen' } as const, [])
// Kept under a shape tag: before cc-stretch 0.5.2's names it held short forms, and as of Claude Code
// 2.1.304 plugin state outlives a reload of the plugin's code; under the tag those read as absent.
const seen = atom({ plugin: 'cc-dazzle', key: 'stretchSeen' } as const, [], { shape: 'opened-stretches' })
const stretchOrder = atom({ plugin: 'cc-dazzle', key: 'stretchOrder' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'cc-dazzle', key: 'stretchNewest' } as const, '')
const askedStretch = atom({ plugin: 'cc-dazzle', key: 'stretchAsk' } as const, null)
const lettering = atom({ plugin: 'cc-dazzle', key: 'stretchLetters' } as const, null)

/** The letters, in row order: home, top, bottom. */
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm'
// As of Claude Code 2.1.301 a plugin has no chord of its own: a Button naming one of the engine's
// keybinding actions is pressed by that action's chords while no engine handler of it is mounted.
// These two actions scroll the diff panel's file list, bound in its Global context to alt+down and
// ctrl+down, and alt+up and ctrl+up.
const CHORDS: Record<Action, string> = { open: 'app:diffFileListDown', close: 'app:diffFileListUp' }
/** How many of the latest replies on screen holding a stretch take letters. */
const LETTERED_REPLIES = 3
/** How many of the latest replies drawn by Clients are kept, to find the ones that take letters. */
const KEPT_DRAWN_REPLIES = 50

/**
 * A reply drawn by Clients: its text, whether any of its rows are on screen, and its paragraphs that
 * hold a stretch, with each one's state member.
 */
type DrawnReply = { text: string; isOnScreen: boolean; paragraphs: { member: string; text: string }[] }
// Module state, not an atom: as of Claude Code 2.1.301 a render hook cannot write plugin state.
const drawnReplies = new Map<string, DrawnReply>()

/** A reply's text with its whitespace gone, as the site may break and trim its lines. */
const squeezed = (text: string) => text.replace(/\s+/g, '')

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
  // A stretch that is not a link is drawn open, so it is neither opened nor unopened. Each is named
  // as its paragraph draws it, where a lone period is named with the words before it.
  const written = paragraphsOf(lastReply(await $.session.messages()))
    .filter(paragraph => paragraph.hasStretch)
    .flatMap(({ text }) => {
      const parts = parse(text)
      const names = namesOf(parts)
      return stretches(parts)
        .filter(isLinkable)
        .map(stretch => openedOf(stretch, names))
    })
  const unopened = written.filter(stretch => !opened.some(was => isSameStretch(was, stretch)))
  await update($, seen, () => [])
  await update($, newestReply, () => '')
  await update($, lettering, () => null)
  if (opened.length === 0 && unopened.length === 0) return undefined

  const quote = (list: OpenedStretch[]) => list.map(stretch => `"${stretch.name}"`).join(', ')
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
    const shown = hideLongForms(message.text, newStreamState())
    if (shown !== message.text) remember(shown, message.text)
  }
  return written.get(key) ?? text
}

/** The hooks that teach Claude the markup, hide it while a reply streams and keep what the reader opened. The note goes out from cc-dazzle's own prompt.submit hook. */
export function registerStretch(on: On): void {
  // While a reply streams, Claude Code draws its lines before the reply reaches AssistantMessage.
  // One filter state per message, until its final flush; null for a message left as written.
  const streams = new Map<string, { state: StreamState | null; raw: string; shown: string }>()
  // Each streaming message's latest flush. As of Claude Code 2.1.302 up to three flushes of a message
  // run at once and the final one does not wait, so each flush filters after the one before it.
  const flushes = new Map<string, Promise<void>>()
  on('classic.MessageDisplay', ($, e, next) => {
    const before = flushes.get(e.message_id)
    const flush = (async () => {
      const answer = await next(e)
      await before
      let stream = streams.get(e.message_id)
      if (stream === undefined) {
        // A message that begins abandons any not finished, which then gets no final flush.
        if (e.index === 0) for (const id of streams.keys()) if (!flushes.has(id)) streams.delete(id)
        // The desktop app draws a finished reply from this display text, so hiding the long forms here
        // would strip the markup its links are made from. Decided on a message's first flush.
        stream = { state: (await $.session.surfaces()).includes('desktop') ? null : newStreamState(), raw: '', shown: '' }
      }
      if (e.final) streams.delete(e.message_id)
      else streams.set(e.message_id, stream)
      if (stream.state === null) return answer

      const raw = answer.displayContent ?? e.delta
      const shown = hideLongForms(raw, stream.state)
      stream.raw += raw
      stream.shown += shown
      if (e.final && stream.raw !== stream.shown) remember(stream.shown, stream.raw)
      return { ...answer, displayContent: shown }
    })()
    const settled = flush.then(
      () => undefined,
      () => undefined,
    )
    flushes.set(e.message_id, settled)
    void settled.then(() => flushes.get(e.message_id) === settled && flushes.delete(e.message_id))
    return flush
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed

    return { sections: [...composed.sections, { id: 'cc-dazzle:stretch-guide', text: GUIDE, scope: 'session' }] }
  })

  // A paragraph's Client posts the stretches open in it whenever they change, and the one the reader
  // just opened. Kept here, they survive a redraw, reach the next prompt and keep their colours.
  on('ui.message', async ($, e, next) => {
    // Text the reader selected in a paragraph, where as of Claude Code 2.1.302 the transcript selects
    // nothing itself.
    const copy = e.module.endsWith('reply.tsx') ? copyOf(e.data) : undefined
    if (copy !== undefined) {
      const copied = await $.ui.copy({ text: copy, surface: e.surface })
      if (!copied.isCopied) $.ui.toast(`cc-dazzle: the selection was not copied: ${copied.reason}`)
      return next(e)
    }
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened } = post
    if (opened !== undefined) await update($, seen, list => (list.some(was => isSameStretch(was, opened)) ? list : [...list, { source: opened.source, name: opened.name }]))

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

  // While the letters show, the next edit at the prompt puts them away. A key that is one of the
  // letters asks its stretch's paragraph to open or close it, in place as a click does, and is not
  // typed; any other key, including a capital and a letter no stretch has, is typed as usual.
  on('prompt.edit', async ($, e, next) => {
    const shown = await read($, lettering)
    if (shown === null) return next(e)
    await update($, lettering, () => null)
    const typed = e.key?.ctrl === undefined && e.key?.meta === undefined ? e.key?.key : undefined
    const target = shown.targets.find(one => one.letter === typed)
    if (target === undefined) return next(e)
    await update($, memberOf(askedStretch, { requestId: target.member }), last => ({ key: target.key, action: shown.action, n: (last?.n ?? 0) + 1 }))

    return { text: e.text, cursor: e.cursor }
  })

  // A change to the prompt box that is not an edit, such as a recalled history entry or a clear,
  // puts the letters away too.
  on('prompt.change', async ($, e, next) => {
    if ((await read($, lettering)) !== null) await update($, lettering, () => null)
    return next(e)
  })
}

/**
 * Puts up the letters for `action`, or puts them away when they already show for it or no stretch
 * in the latest replies on screen takes one.
 */
async function showLetters($: EngineInterface, action: Action): Promise<void> {
  const shown = await read($, lettering)
  const targets = shown?.action === action ? [] : await lettersFor($, action)
  await update($, lettering, () => (targets.length === 0 ? null : { action, targets }))
}

/**
 * A letter for each of the first 26 stretches `action` can act on in the latest three replies on
 * screen holding a stretch, newest first, in reading order within each. The order is read from the
 * session's messages because Claude Code 2.1.301 draws a reply for the first time when it scrolls
 * into view.
 */
async function lettersFor($: EngineInterface, action: Action): Promise<{ letter: string; member: string; key: string }[]> {
  // With their whitespace gone, no reply is found across two messages joined by a line break.
  const messages = (await $.session.messages().catch(() => []))
    .filter(message => message.role === 'assistant' && message.text.includes('{{'))
    .map(message => squeezed(message.text))
    .join('\n')
  const replies = [...drawnReplies.values()]
    .filter(reply => reply.isOnScreen)
    .map(reply => ({ reply, at: messages.lastIndexOf(squeezed(reply.text)) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => b.at - a.at)
    .slice(0, LETTERED_REPLIES)
  const paragraphs = replies.flatMap(({ reply }) => reply.paragraphs)
  const targets = await Promise.all(
    paragraphs.map(async ({ member, text }) => {
      const open = await read($, memberOf(openStretches, { requestId: member }))
      return targetsIn(parse(text), open, action).map(stretch => ({ member, key: stretch.key }))
    }),
  )

  return targets.flat().slice(0, LETTERS.length).map((target, i) => ({ ...target, letter: LETTERS.charAt(i) }))
}

// The reply that says why stretches are open on the main screen: the first drawn there since the
// module loaded. A render hook cannot write plugin state, so it is kept here.
let notedRequest: string | undefined

/**
 * A reply's body when it holds a stretch, undefined when it holds none. `draw` draws markdown the
 * way cc-dazzle does; in the fullscreen terminal a paragraph holding a stretch is drawn by a Client.
 * `framed` says the body draws the reply's gutter itself, as a Client marks rows in it.
 */
export async function stretchBody($: EngineInterface, e: RenderInput & { props: { text: string; isFirstOfReply?: boolean; onScreen?: unknown } }, draw: (text: string) => RenderElement[], links: Reach = {}): Promise<{ body: RenderElement[]; framed: boolean } | undefined> {
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
      const opened = openedOf(stretch, namesOf(parts))
      await update($, seen, list => (list.some(was => isSameStretch(was, opened)) ? list : [...list, opened]))
    }
    return { body: [<Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />], framed: false }
  }

  if (canPress(e)) {
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const [{ order, count }, newest, shown] = await Promise.all([read($, memberOf(stretchOrder, { requestId: e.requestId })), read($, newestReply), read($, lettering)])
    const paragraphs = paragraphsOf(e.props.text).map((paragraph, i) => ({ ...paragraph, key: `paragraph-${i}`, member: `${e.requestId}#paragraph-${i}` }))
    // The terminal says again whether a reply is on screen whenever a scroll changes it; null is off it.
    const holding = paragraphs.filter(p => p.hasStretch).map(({ member, text }) => ({ member, text }))
    drawnReplies.delete(e.requestId)
    drawnReplies.set(e.requestId, { text: e.props.text, isOnScreen: e.props.onScreen !== null, paragraphs: holding })
    if (drawnReplies.size > KEPT_DRAWN_REPLIES) drawnReplies.delete(drawnReplies.keys().next().value!)
    const body = await Promise.all(
      paragraphs.map(async (paragraph, i) => {
        const { key, member } = paragraph
        const dot = i === 0 && e.props.isFirstOfReply === true
        if (!paragraph.hasStretch) {
          return (
            <Box key={key} flexDirection="row">
              <Box width={2} flexShrink={0}><Text color={THEME.accent}>{dot ? '●' : ' '}</Text></Box>
              <Box flexDirection="column" rowGap={1} flexGrow={1}>{draw(paragraph.text)}</Box>
            </Box>
          )
        }
        const [open, ask] = await Promise.all([read($, memberOf(openStretches, { requestId: member })), read($, memberOf(askedStretch, { requestId: member }))])
        const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1)
        const keys = Object.fromEntries((shown?.targets ?? []).filter(one => one.member === member).map(one => [one.key, one.letter]))
        const letters = shown === null ? null : { action: shown.action, keys }
        return <Client key={key} module="./reply.tsx" props={{ text: paragraph.text, open, tints, dot, ask, letters, reach: reachOf(links) } satisfies ReplyProps} width="100%" />
      }),
    )
    if (e.props.isFirstOfReply !== true) return { body, framed: true }
    // The reply's dot and the cell after it are Buttons laid over it: the first puts up the letters
    // that open, or puts them away when they show; the second does the same for those that close. A
    // chord presses them, and so does a click.
    const chords = (
      <Box key="chords" position="absolute" top={0} left={0} flexDirection="row">
        <Button key="open-letters" plain action={CHORDS.open} onPress={() => void showLetters($, 'open')}>
          <Text color={THEME.accent}>●</Text>
        </Button>
        <Button key="close-letters" plain label=" " action={CHORDS.close} onPress={() => void showLetters($, 'close')} />
      </Box>
    )
    return { body: [...body, chords], framed: true }
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
      if (typeof part === 'string') return withoutFileLinks(part)
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

/** The link and path rules a Client needs, without the rest of the style, so its props stay small. */
function reachOf({ httpLinks, editorLinks, fileLinks, pathLinks, cwd, home }: Reach): Reach {
  const reach: Reach = { httpLinks, editorLinks, fileLinks, pathLinks, cwd, home }
  return Object.fromEntries(Object.entries(reach).filter(([, value]) => value !== undefined))
}

/**
 * The desktop app opens a file link a reply draws outside Claude Code's permission prompts, and
 * cc-dazzle's replies there draw file links as text, so these do too. Code spans keep theirs.
 */
function withoutFileLinks(markdown: string): string {
  return markdown.replace(/(`+)[\s\S]*?\1|\[([^\]\n]+)\]\((file:[^)\s]+)\)/gi, (all, code: string | undefined, label: string, href: string) => (code ? all : `${label} (${href})`))
}

/** A short form as link text: outside code spans, a link becomes its text and target, and brackets and backslashes are escaped. */
function labelOf(short: string): string {
  const plain = (text: string) => text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/([[\]\\])/g, '\\$1')
  let label = ''
  let from = 0
  for (let at = short.indexOf('`'); at !== -1; at = short.indexOf('`', from)) {
    const { stop } = codeSpan(short, at)
    label += plain(short.slice(from, at)) + short.slice(at, stop)
    from = stop
  }

  return label + plain(short.slice(from))
}

function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

function isSameStretch(a: OpenedStretch, b: OpenedStretch): boolean {
  return a.source === b.source && a.name === b.name
}

/** A Client's post of text to copy, if it is one. */
function copyOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('copy' in data)) return undefined
  return typeof data.copy === 'string' && data.copy !== '' ? data.copy : undefined
}

function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('name' in opened) || !('source' in opened) || !('key' in opened)) return { open }
  const { name, source, key } = opened

  return typeof name === 'string' && typeof source === 'string' && typeof key === 'string' ? { open, opened: { name, source, key } } : { open }
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
