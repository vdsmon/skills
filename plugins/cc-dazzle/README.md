# cc-dazzle

Draws the Claude Code transcript in Catppuccin Mocha, with optional stretchtext replies.

It is a mod: a hooks module that Claude Code runs inside each session. It makes no model calls. With stretchtext off, the default, it only draws rows and adds nothing to your prompts.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-dazzle@vdsmon-skills
```

Mods that draw the same row do not stack, so turn off any other mod that draws replies or tool rows (for example prismantis) first.

## What it draws

- **Replies:** a blank line before each part, headings in lavender with a heavy rule under H1, boxed tables with a double line under the header, `[ ]` and `[✓]` task lists, and version numbers and file paths in color. Each color has one job: mauve marks who is talking, red marks only failures.
- **Code:** a rounded box with the language and a copy button above it, Prism colors for 24 languages, and `console` blocks with the `$` lines colored as commands. Their copy button copies the commands only.
- **Mermaid:** flowcharts and other diagrams drawn as box art. A diagram that does not fit shows its source with a note.
- **Copy buttons:** `⧉ copy` on code, lists and quotes. Tables get `⧉ md`, `⧉ art` and, on macOS outside SSH, `⧉ html`, which pastes as a real table in Docs, Notion or email.
- **Tool calls:** one dim row each (`Ran gh pr view 12`, `Read ~/src/app.ts`) under a bold `└─`. Bash and MCP output in columns shows as a boxed table with a row count and the run time.
- **Edits:** a diff card in Claude Code's colors, with the changed words marked, code colored by file type, and long diffs folded.
- **Your prompts:** a rounded box with the send time (`14:32`, or `Oct 10 14:32` for another day). A prompt you send while Claude works stays gray until Claude reads it.
- **Slash-command output:** drawn like a reply, unless it has terminal color codes.

## Copy buttons on hover

In `/config` (cc-dazzle, **Copy buttons**), `hover` hides each block's copy buttons until the pointer is over the block. They float over its top-right corner and take no space. `inline`, the default, always shows them. The phone app always shows them inline.

## Stretchtext replies

Off by default. Turn it on in `/config` (cc-dazzle, **Stretchtext replies**); the change reloads the mod at once.

When it is on, Claude writes each reply short, with `{{short|long}}` stretches. A stretch draws as its short form, underlined. Click it and the long form grows in place around the words you already read, with a grey `▎` in the left margin beside the lines that hold the new words; click `«` to shrink it back. Stretches can nest. With your next prompt, Claude is told which stretches you opened.

- Clicks work in the fullscreen terminal (`/tui fullscreen`) and in the desktop app. Elsewhere every stretch shows open, so nothing is hidden.
- It adds a short guide to the system prompt and one line to each prompt that follows a reply with stretches.
- Claude still writes every level, so a reply costs about as many tokens as before.
- Turned off, old replies with stretches show every stretch open.

## Turn it off

```
/plugin disable cc-dazzle
```

## Credits

Most of the code comes from [prismantis](https://github.com/NahumLitvin/prismantis) by Nahum Litvin, through the fork `vdsmon/prismantis` at 0.15.19. Upstream prismantis stays a source of ideas: they are copied here by hand. The stretchtext code comes from [cc-stretch](https://github.com/pro-vi/cc-stretch) 0.3.3 by pro-vi, after Ted Nelson's stretchtext. `hooks/vendor/` holds frozen builds of [Prism](https://github.com/PrismJS/prism) 1.30.0 and [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3. See `NOTICE` for the licenses.
