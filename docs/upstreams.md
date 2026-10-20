# Upstreams

Plugins here that copy code from another project, and the last upstream version we read for ideas. Update the row after each review: read upstream's changelog from the "Last checked" version on, then move the row forward.

Port every fix and every useful or cool feature. Leave a change out only when it cannot apply (it lives in a part cc-dazzle dropped, such as themes, LaTeX or right-to-left text) or when it fights a fixed design choice (such as cc-dazzle's fixed colors), and write down why. Porting effort, a needed rewrite, or an existing button that does the same job are never reasons to leave a feature out.

| Plugin | Upstream | Copied from | Last checked | Checked on |
|---|---|---|---|---|
| cc-dazzle | [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) | fork `vdsmon/prismantis` 0.15.19, which split from upstream at 0.15.1 (`af067b6`) | 0.32.1 (`b90c326`) | 2026-10-20 |
| cc-dazzle (stretchtext) | [pro-vi/cc-stretch](https://github.com/pro-vi/cc-stretch) | 0.3.3 (`4466e11`) | 0.5.2 (`1de5f05`) | 2026-10-20 |

To list what is new since the last check:

```console
$ git clone https://github.com/NahumLitvin/prismantis && cd prismantis
$ git log --oneline b90c326..HEAD
```

## prismantis 0.31.0 to 0.32.1

Ported: a line holding only an HTML-like tag (`<tldr>`) drawn dim on its own (#228); gantt bars that start on a half cell and end on an eighth (#224); from the diff-card work (#234), the no-newline marker as its own row, a dim `...` between hunks, each hunk highlighted apart with removed lines plain, and a node allowance that keeps an opened card under Claude Code's 20000-node ceiling; new, deleted, emptied and renamed files drawn as `Created`, `Deleted` and `Renamed` cards, an Edit that makes a file and a Write preview included, and a write held for review left to Claude Code (#236); clickable paths in replies, tool rows and edit card headers, with a `file://` link kept only when its label shows its own path and programs and launchers never linked (#238, #240); and the redraw when the html copy check lands (#238). While porting the gantt bars, cc-dazzle's gantt charts turned out never to fit under about 90 columns, because the box frame takes 4 more columns than upstream's; `mermaid.tsx` now sizes them for it.

Left out on purpose:

- Diff colors from the theme, the darker light-theme greens, `diffStyle` and the preview hover band (#234, #236): cc-dazzle draws diffs in Claude Code's own colors, Mocha only.
- The WSL `file://wsl.localhost` rewrite (#238): cc-dazzle dropped Linux and Windows clipboard paths.
- Figures (#171, #243, #248), including figure role markup outside figures: cc-dazzle has no figure prompt, so Claude never writes that markup.

Ported later, in cc-dazzle 1.9.0, after first being left out for their porting effort, which is no reason: a click anywhere on a folded card opens it, from Claude Code 2.1.295 on the terminal, with a deleted file's header as its button and a band under a new file's preview (#236); a wrapped diff line repeats its mark and tint on each row, breaking at a space and drawing tabs to the next stop of 8 (#234); and paths and `file://` links in stretchtext replies follow the same rules as in other replies.

## cc-stretch 0.5.1 to 0.5.2

Ported: the words before a lone period, or any stretch with no words of its own, open its stretch; links act when the button comes up, so a drag from a link selects; a double-click on lead-in words still copies the word; the note to Claude names a wordless stretch by its lead-in words; a code span or markdown link never pairs across a pressable phrase's marks. `parse.ts`, `grow.ts` and `guide.ts` stay upstream's, unchanged.

Left out on purpose: the bench and film scripts and docs, which never ship.

## prismantis 0.24.0 to 0.31.0

Ported: hover copy buttons that cover only their own cells (#170), the 8-bit control character filter with the escape-sequence filter it extends (#188, #98), code drawn through the app's own Code element off the terminal (#176), Lua highlighting (#216), one color and a legend name per xychart series (#225), and pie and gantt charts (#177, #221), with the pie always round where it fits (upstream's `pieStyle` default). Both vendor files and `hooks/charts.ts` are upstream's, unchanged.

Left out on purpose:

- Markdown images in kitty and Ghostty, and the image path check (#179, #185): they live in `latex.ts`, which cc-dazzle dropped.
- Hebrew and right-to-left fixes (#181, #194, #195, #210, #217), CJK labels in figures (#201), the Korean demo, `/prismantis setup` (#178, #198, #206), the repro-issue hint (#203), and CI, badges and the security policy: parts cc-dazzle does not have.

## cc-stretch 0.3.3 to 0.5.1

Ported: code spans and fences read across lines and emoji counted as two cells (0.3.5), CJK and Thai line breaks and growth (0.3.6), a hang on a short form over several lines and Private Use Area characters drawn as written (0.3.7), the guide line "Stretch list items, not whole lists." (0.4.0), a reply's flushes filtered in order (0.5.0), keyboard letters (0.4.0), drag-select and links drawn in a stretch paragraph (0.5.0), and double-click select (0.5.1). `parse.ts`, `grow.ts` and `guide.ts` are upstream's, unchanged; `layout.ts`, `reply.tsx` and `index.tsx` take the rest by hand, in cc-dazzle's colors: letters on red, the rest of a lettered phrase on mauve, links in the link blue.

Left out on purpose:

- The style toolbar and tinted highlights (0.5.0): cc-dazzle's look is fixed on purpose.
- Filter state kept across a plugin reload (0.5.0): cc-stretch reloads on each toolbar save; cc-dazzle's settings change rarely.
- The plain cell after a styled paragraph (0.4.0): 0.5.1 took it out again.
- Tool-group folding (0.3.5): cc-dazzle draws tool rows itself.

## prismantis 0.15.1 to 0.24.0

Ported: the inline prose fixes, one-dash table rows, symbol widths, flowchart edges without spaces, HTML tags in mermaid labels, bar chart heights, the localhost check, fold ids, footnotes inside fences, error output of an expanded shell row, the redraw speedups, quotes and alerts that keep their blocks, clickable footnote marks, link handling by Claude Code version, shell edits drawn as diff cards, and copy buttons shown only on hover (the `copyButtonStyle` setting).

Left out on purpose:

- Figures (`figure` code blocks, 0.18.0): Claude writes them only when a system prompt note tells it to, and cc-dazzle has no such note.
- Diff tints from the theme (0.20.0, 0.22.0): cc-dazzle draws diffs in Claude Code's own colors.
- Parts cc-dazzle does not have: themes, LaTeX, right-to-left text, the clock option, quiet tool output, Windows HTML copy and the Codex plugin.
