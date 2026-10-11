# cc-dazzle: design

Status: draft for review, 2026-10-11. Updated the same day with the user's answers on tool tables, slash-command output, the html table copy and the copy command.

## Goal

Replace the prismantis fork (`vdsmon/prismantis`, 0.15.19) with one lean mod in this repo. cc-dazzle draws the transcript the way the user has it today, and nothing more.

- The user's prismantis options become fixed behavior. cc-dazzle has no settings.
- Every feature the user does not use is dropped. A feature comes back only when the user asks for it.
- Upstream prismantis (`NahumLitvin/prismantis`) stays a source of ideas. We copy ideas by hand. We never merge upstream and never open PRs there.

### Why

Mods that draw the same row do not stack: the first hook that answers without `next` hides the rest. So all row drawing must live in one mod. The fork carries 51 options, 344 tests, 11 themes, RTL, LaTeX, a help screen and bench and snapshot scripts that the user never uses, and every change has to work around them.

### Success criteria

- After the switch, a session looks the same as with prismantis 0.15.19 and the user's options. The only changes are the ones listed under "Behavior changes".
- cc-dazzle spends no tokens: it adds no context to prompts and makes no model calls.
- `mise run verify` and `mise run test:dazzle` pass.

## What the user sees (kept features)

Source of truth: `pluginConfigs["prismantis@prismantis"].options` in `~/.claude/settings.json`. An option the user never set counts at its default, so it is in this list too. Each row names the fork code it needs (in `~/repos/personal/prismantis/hooks`, at `892da32`).

| Option = value | What it draws | Fork code to carry |
| --- | --- | --- |
| `theme` = catppuccin-mocha (default) | Catppuccin Mocha colors everywhere | the `catppuccin-mocha` entry of `presets.ts`, as one constant in `theme.ts` |
| `toolRows` = true | Tool calls as one compact line (`Ran gh pr view 12`, `Read ~/src/app.ts`) | `register.tsx` hooks on `ToolGroup`, `ToolUse`, `ToolResult`; `render.tsx` `renderToolRow`, `renderToolGroup`, `groupSummary`, `toolLayout`, `toolGutter`, `targetOf`, `shortTarget`, `shortPath`, `statusColor`, `VERBS`, `TARGET_FIELDS`; expanded shell rows: `renderExpandedShell`, `markExpanded`, `expandedCalls` |
| `toolStyle` = tree-dim | Tool rows dimmed and tucked under Claude's sentence | the `tree` branch of `toolLayout` and `toolGutter`; `toolDim` becomes always true |
| `treeMark` = corner | `└─` in bold instead of `⎿` | `treeMark`, `heavyMark` (both become constants) |
| `replyGap` = true | A blank line before each part of a reply | `marginTop: 1` in the `AssistantMessage` hook |
| `clock` = 24h | `14:32` on each prompt you type, `Oct 10 14:32` for another day | `clock.ts` `clockText` (24h branch only), `promptKey`, `sentAt`, `withRecord`; `register.tsx` `firstDrawn`, the `sent` atom, the `prompt.submit` hook |
| `promptStyle` = bubble (default), `promptAlign` = left | Your prompts in a rounded accent box on the left | `renderUserPrompt`, bubble branch only |
| `dimQueued` = true | A prompt sent while Claude works stays gray until Claude reads it | `queue.ts` (all of it); the `queued` atom; hooks on `prompt.submit` (when `turnId` is set), `session.append` (`queued_command`), `turn.start`; the `waiting` color in `renderUserPrompt` |
| `turnLine` = claude, `turnClock` = false | Claude Code's own `✻ Brewed for 5s` line | nothing: cc-dazzle does not hook `TurnDuration` |
| `copyReply` = false | No "copy reply" button under replies | nothing |
| `headingStyle` = banner (default) | A box around H1, a heavy rule under H2 | `renderHeading`, `drawHeading`, banner branch only |
| `tableStyle` = box (default) | Every cell boxed, double line under the header | `renderTable`, `columnWidths`, `tableArt`, box branch only |
| `taskStyle` = checks (default) | `[ ]` and `[✓]`, done items dimmed and struck through | `renderList`, checks branch only |
| `highlightNumbers`, `highlightPaths` = true (default) | Versions, IDs, counts and file paths colored in prose | the `numbers` and `paths` passes of `markdown.ts` `parse` |
| `codeStyle` = box | Code blocks in a rounded box, language label above, copy button inside at the top right | the `codeStyle: 'box'` branch of `renderBlocks`; `highlightRows`, `highlightBlock`, `codeLine`, `grammarFor`, `flatten`, `remember`; `vendor/prism.js` |
| `consoleSplit` = true | In `console` blocks, `$` lines colored as commands, output plain; copy gives the commands only | `isSessionLang`, `PROMPT`, `sessionCommands`, `sessionLine` |
| `copyButtons` = true (default) | `⧉ copy` on code, diagrams, lists and quotes, at the right of the block; tables get `⧉ md` (markdown), `⧉ art` (the box drawing) and `⧉ html` (a formatted table that pastes as a real table in Docs, Notion or email) | the `copy` helper in `drawMarkdown`; `copySource`, `codeId`; the list and quote row layout in `renderBlocks`; for `⧉ html`: `html.ts` (`tableHtml`, `tableText`), `clipboard.ts` macOS branch (`MAC_TABLE_COPY`), `htmlBackend`, `copyTable` |
| `toolRows` = true (tool tables) | Bash and MCP output in columns (`docker ps`, `gh pr list`, TSV) drawn as a boxed table with a footer like `12 rows · 0.4s` | `tables.ts` (all of it); the `tool.call` timing hook; the `took` state family; `toolTableView`; the table branches of the `ToolGroup` and `ToolResult` hooks |
| (always on) slash-command output | Text a slash command prints (for example a mod command such as `/wrap-up`) drawn like a reply: headings, box tables, copy buttons. Text with terminal color codes is left alone | the `CommandOutput` hook |
| `mermaid` = true (default), `mermaidAscii` = false | Mermaid diagrams drawn as box art in a rounded box, `mermaid` label and `⧉ source` / `⧉ art` buttons outside the box | `mermaid.tsx` (all of it); `vendor/mermaid-text.js`; the mermaid loop in `drawMarkdown` (fit check `columns - 6`) and the boxed branch in `renderBlocks` |
| `diffCards` = true, `diffTint` = claude, `diffSyntax` = true | Edit and Write results as a diff card in Claude Code's colors, changed words marked, code colored by file type, long diffs folded | `renderDiffCard`, `renderClaudeDiff`, `diffLines`, `changedRanges`, `markRange`, `CLAUDE_DIFF`, `isDark`, `diffLang`, `EXT_LANGS`, `paintDiff`; the fold button: `folder`, the `unfolded` atom |
| `diffBox` = false | (nothing) | nothing |
| `diagramHints` = false | (nothing) | nothing |
| `enabled` = true (default) | (the mod is on) | nothing: `/plugin disable cc-dazzle` is the off switch |

The markdown parser (`markdown.ts`) and the width helpers (`graphemes`, `cells`, `width`, wrapping) are shared by all of the above and come over whole, minus the RTL parts.

## What is dropped

Each item below goes, with its code, options and tests.

- **Every option.** No `userConfig`. The repo's hooks rule asks for an off switch; `/plugin disable cc-dazzle` is it. cc-dazzle spends no tokens and schedules nothing, so the opt-in rule does not apply.
- **Other themes, color overrides and theme switching:** `presets.ts` (all but Mocha), the 20 `*Color` options, `pickTheme`, `RANDOM_THEMES`, `resolveStyle`.
- **The `/prismantis` command:** theme switch, `demo`, `demo-rtl`, the help screen (`help.ts`), and `copy`, which Claude Code's own `/copy` already does.
- **RTL:** `rtl.ts`, `detectTerminal`, `applyRtl`, `probe`, `TERMINALS`, `hasRtl`, `flow`, `fullWidth`, the Apple Terminal fullscreen `fit`. The style becomes one constant.
- **LaTeX:** `latex.ts`, `mathOfBlocks`, the `formulas` and `dir` atoms, the `Image` branch in `drawMarkdown`.
- **Linux clipboard:** the CopyQ branch of `clipboard.ts` (`LINUX_TABLE_COPY`) and the Linux check in `htmlBackend`. `⧉ html` shows on macOS only, outside SSH, as today on this Mac.
- **Diagram hints:** `HINT`, `LATEX_HINT`, the context added in `prompt.submit`.
- **Quiet tool output** (`toolOutput: quiet`): `quietToolRow`, `quietToolGroup`, `callLabel`, `describeShell`, `programsOf`, `parseShell`, `isReadOnlyCall`, `READ_*`, `renderFailure`, `renderShellResult`, `refusalReason`, `errorReason`, `readOnlyCalls`. The `ToolResult` hook keeps two branches: Edit and Write draw the diff card, tabular output draws a tool table, everything else goes to `next`.
- **The turn line:** the `TurnDuration` hook, `renderTurnDuration`, `renderPlainTurnDuration`, `endedAt`, the `turnEnds` atom, the `turn.complete` hook.
- **Unused style branches:** heading styles other than banner, table styles other than box, task styles other than checks, prompt styles other than bubble, `promptAlign: right`, `codeStyle: rule`, `toolStyle` chat, tree-bold (and its bold `narration`) and classic, `treeMark: hook`, `diffTint` soft and vivid, `diffBox` (`renderBoxed`), `copyReply`, `mermaidAscii`, 12h clock.
- **The extension API:** `engine.create`, `prismantis.markdown` and the `EngineInterface` augmentation. No mod in this repo calls it.
- **Tooling:** bench, snapshot, clipboard check and vendor build scripts; `FORK.md`; `docs/CHANGELOG.md`; the README demo images.
### Behavior changes

None the user should notice. The `/prismantis` command goes away; `/copy` covers its copy part.

## Shape

A new plugin, `plugins/cc-dazzle`: a mod with no skill, version 1.0.0 (as cc-keepwarm and cc-wrap-up started).

```
plugins/cc-dazzle/
  .claude-plugin/plugin.json   name, version, description, author, license MIT, types; no userConfig
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the hooks only: tool.call, ToolGroup, ToolUse, ToolResult, CommandOutput, UserMessage, AssistantMessage, prompt.submit, session.start (html copy probe), session.append, turn.start
  hooks/theme.ts               the Mocha palette and CLAUDE_DIFF colors as constants
  hooks/markdown.ts            the parser
  hooks/text.ts                width, graphemes, cells, wrapping, remember
  hooks/blocks.tsx             markdown blocks: inline, headings, paragraphs, quotes, alerts, lists, tables, code (with Prism), console
  hooks/tools.tsx              tool rows, tool groups, expanded shell rows, the diff card
  hooks/prompt.tsx             renderUserPrompt
  hooks/mermaid.tsx            mermaid to box art
  hooks/tables.ts              tool output to tables, the footer
  hooks/html.ts                tableHtml, tableText
  hooks/clipboard.ts           the macOS formatted-table copy
  hooks/clock.ts               clockText (24h), sentAt, promptKey, withRecord
  hooks/queue.ts               the queued-prompt list
  hooks/vendor/prism.js, prism.d.ts, mermaid-text.js, mermaid-text.d.ts
  hooks/blocks.test.tsx, hooks/tools.test.tsx, hooks/prompts.test.tsx
  types/index.d.ts             PluginState['cc-dazzle']: unfolded, sent, queued, drawn, took
  README.md                    what it draws, how to turn it off, where the ideas come from
  NOTICE                       the MIT notices below
```

`render.tsx` (1,467 lines in the fork) is split into `text.ts`, `blocks.tsx`, `tools.tsx` and `prompt.tsx`, because each part is read and changed on its own. Code moves over as it is; the only edits are deleting dropped branches and turning options into constants. Every `$.state` ref changes from `plugin: 'prismantis'` to `plugin: 'cc-dazzle'`. Old prismantis state does not carry over, which is harmless: it holds prompt times, fold states and tool timings only.

**Vendor bundles.** This repo has no build and no package manager, so `prism.js` and `mermaid-text.js` are committed as frozen copies of the fork's files at `892da32`: Prism 1.30.0 (core and 24 languages) and beautiful-mermaid 1.1.3 with the fork's patches. A rebuild needs the fork's `scripts/build-vendor.mjs`; if that is ever needed, copy the script to `scripts/dazzle-vendor/` in this repo, outside `plugins/`.

**NOTICE** holds four MIT notices: prismantis (Copyright (c) 2026 Nahum Litvin, the source of most of the code), Prism (Copyright (c) 2012 Lea Verou), beautiful-mermaid (Copyright (c) 2026 Craft Docs) and the Catppuccin palette (Copyright (c) 2021 Catppuccin). Text taken from the fork's `LICENSE` and `docs/THIRD_PARTY_NOTICES.md`.

**Repo wiring.**

- A marketplace entry with `source: ./plugins/cc-dazzle`; `mise run sync` fills its description and version, and adds the README row.
- A `test:dazzle` task in `mise.toml`, like the others: `claude plugin validate plugins/cc-dazzle && claude plugin test plugins/cc-dazzle`.
- A line under "Checks and tests" in `CLAUDE.md` naming `test:dazzle` with the other mod tasks.
- Description (first sentence under 170 chars, whole under 300): "Draws Claude Code's transcript in Catppuccin Mocha: boxed code blocks, box tables, Mermaid diagrams, diff cards in Claude's colors, compact tool rows and timed prompts. No settings."

## Tests

Run with `claude plugin test plugins/cc-dazzle`. Each test checks a behavior through the hook, with the fork test it comes from in brackets (`look` = `tests/look.test.tsx`, `features`, `render`, `regressions`). No snapshot or bench tests.

**Prompts (`prompts.test.tsx`)**

1. A typed prompt draws as a bubble on the left with `HH:MM` in 24h. [look, features]
2. A prompt from another day shows `Oct 10 14:32`. [features]
3. A prompt that is not the user's own (a task notification, a message from another session) goes to `next`. [regressions]
4. A prompt sent while a turn runs (`turnId` set) draws in the comment color. [look]
5. A `session.append` with `queued_command` for that text draws it in the normal color again. [look]
6. `turn.start` clears every queued prompt. [look]
7. `prompt.submit` adds no context to the prompt. [new]
8. No hook is registered on `TurnDuration`. [new]

**Replies and blocks (`blocks.test.tsx`)**

9. A reply part has `●` on the first part only, and a blank line before each part. [look]
10. A one-paragraph reply is not bold. [look]
11. H1 draws in a banner box; H2 with a heavy rule. [render]
12. A table draws boxed with a double line under the header, with `⧉ md`, `⧉ art` and `⧉ html` buttons. [render, tables]
13. `⧉ html` runs the macOS helper with the table as HTML and as tab-separated text; when the helper fails it copies plain text and says why. Over SSH the button is hidden. [clipboard]
14. A task list shows `[ ]` and `[✓]`, done items dimmed and struck through. [features]
15. Numbers and file paths in prose get their colors. [render]
16. A code block draws its language label above a rounded box, the copy button inside at the top right. [look]
17. A TypeScript code block gets Prism colors. [render]
18. A `console` block colors `$` lines as commands and output as plain text; its copy button copies the commands only. [look]
19. A list's copy button sits on the list's first row at the right, not on a line of its own. [look]
20. A quote's copy button sits at its right. [look]
21. A mermaid flowchart draws in a rounded box, with `mermaid` and the `⧉ source` / `⧉ art` buttons above it, outside the box. [look]
22. A diagram too wide for the terminal falls back to its source with a note. [features]
23. A code block still streaming (`isOpen`) draws without error. [regressions]
24. Slash-command output with a heading and a table draws like a reply; output with terminal color codes, and errored output, go to `next`. [features]

**Tools (`tools.test.tsx`)**

25. A Bash call draws as one dim row with a bold `└─` and the command colored. [look, features]
26. A Read call draws `Read` and the path shortened to `~/…`. [render]
27. An expanded tool group goes to `next`; an expanded Bash row shows command and output. [features]
28. An Edit result draws a diff card in Claude Code's colors, with the changed words marked. [look]
29. A `.ts` file's diff lines get Prism colors. [look]
30. A long diff folds behind `+N more lines`; pressing it unfolds through the `unfolded` state. [features]
31. An errored Edit, and a non-tabular result, go to `next`. [regressions]
32. Bash output in columns draws as a boxed table with a `N rows · 0.4s` footer; the time comes from the `tool.call` hook. [tables, features]
33. A collapsed tool group with tabular output draws the row with a preview table under it. [features]

## Migration

The order matters, because two mods that draw the same row do not stack.

1. Build cc-dazzle on `feat/cc-dazzle`. Run `mise run verify`, `mise run test:dazzle` and `tsc -p plugins/cc-dazzle`. Open a PR; the user merges it.
2. Install it and remove prismantis in the same step: `claude plugin marketplace update vdsmon-skills`, `claude plugin install cc-dazzle@vdsmon-skills`, `claude plugin uninstall prismantis@prismantis`, `claude plugin marketplace remove prismantis`. Then `/reload-plugins` or a restart.
3. Remove `pluginConfigs["prismantis@prismantis"]` from `~/.claude/settings.json`.
4. Compare with a screenshot from before the switch: one reply with a heading, a table (and its `⧉ html` copy pasted into a doc), a task list, a TypeScript block, a console block, a mermaid flowchart, an edit, a `docker ps`-style command and a queued prompt. Fix any gap before the next step.
5. Archive the fork: `gh repo archive vdsmon/prismantis --yes`. The user runs it or confirms it first. The clone at `~/repos/personal/prismantis` stays as the reference for the vendor build and for features to bring back.
6. Retarget the routine `prismantis-upstream-check` (`trig_01UQph3ciY1Ewiz6ARhAH2UK`): source repo `vdsmon/skills`; each Monday it reads the week's commits and releases in `NahumLitvin/prismantis` and lists the ones worth copying into cc-dazzle, each with the cc-dazzle file it would touch. Rename it `cc-dazzle-upstream-ideas`. Still read-only.
7. Update the memory note `prismantis-fork-home`.

`~/.claude/themes/quiet.json` (the Claude Code theme) does not depend on the mod and stays.

**Rollback:** `claude plugin marketplace add vdsmon/prismantis`, `claude plugin install prismantis@prismantis`, set the options saved in this spec, and uninstall cc-dazzle. An archived repo can still be installed.
