# cc-dazzle

Draws the Claude Code transcript in Catppuccin Mocha. It has no settings.

It is a mod: a hooks module that Claude Code runs inside each session. It only draws rows. It adds nothing to your prompts and makes no model calls, so it spends no tokens.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-dazzle@vdsmon-skills
```

Mods that draw the same row do not stack, so turn off any other mod that draws replies or tool rows (for example prismantis) first.

## What it draws

- **Replies:** a blank line before each part, a box around H1, a heavy rule under H2, boxed tables with a double line under the header, `[ ]` and `[✓]` task lists, and version numbers and file paths in color.
- **Code:** a rounded box with the language above it and a copy button inside, Prism colors for 24 languages, and `console` blocks with the `$` lines colored as commands. Their copy button copies the commands only.
- **Mermaid:** flowcharts and other diagrams drawn as box art. A diagram that does not fit shows its source with a note.
- **Copy buttons:** `⧉ copy` on code, lists and quotes. Tables get `⧉ md`, `⧉ art` and, on macOS outside SSH, `⧉ html`, which pastes as a real table in Docs, Notion or email.
- **Tool calls:** one dim row each (`Ran gh pr view 12`, `Read ~/src/app.ts`) under a bold `└─`. Bash and MCP output in columns shows as a boxed table with a row count and the run time.
- **Edits:** a diff card in Claude Code's colors, with the changed words marked, code colored by file type, and long diffs folded.
- **Your prompts:** a rounded box with the send time (`14:32`, or `Oct 10 14:32` for another day). A prompt you send while Claude works stays gray until Claude reads it.
- **Slash-command output:** drawn like a reply, unless it has terminal color codes.

## Turn it off

```
/plugin disable cc-dazzle
```

## Credits

Most of the code comes from [prismantis](https://github.com/NahumLitvin/prismantis) by Nahum Litvin, through the fork `vdsmon/prismantis` at 0.15.19. Upstream prismantis stays a source of ideas: they are copied here by hand. `hooks/vendor/` holds frozen builds of [Prism](https://github.com/PrismJS/prism) 1.30.0 and [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3. See `NOTICE` for the licenses.
