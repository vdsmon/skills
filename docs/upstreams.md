# Upstreams

Plugins here that copy code from another project, and the last upstream version we read for ideas. Update the row after each review: read upstream's changelog from the "Last checked" version on, then move the row forward.

| Plugin | Upstream | Copied from | Last checked | Checked on |
|---|---|---|---|---|
| cc-dazzle | [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) | fork `vdsmon/prismantis` 0.15.19, which split from upstream at 0.15.1 (`af067b6`) | 0.31.0 (`354e11d`) | 2026-10-19 |
| cc-dazzle (stretchtext) | [pro-vi/cc-stretch](https://github.com/pro-vi/cc-stretch) | 0.3.3 (`4466e11`) | 0.5.1 (`9aa56da`) | 2026-10-19 |

To list what is new since the last check:

```console
$ git clone https://github.com/NahumLitvin/prismantis && cd prismantis
$ git log --oneline 354e11d..HEAD
```

## prismantis 0.24.0 to 0.31.0

Ported: hover copy buttons that cover only their own cells (#170), the 8-bit control character filter with the escape-sequence filter it extends (#188, #98), code drawn through the app's own Code element off the terminal (#176), Lua highlighting (#216), and one color and a legend name per xychart series (#225). Both vendor files are upstream's, unchanged.

Left out on purpose:

- Pie and gantt charts (#177, #221): new diagram kinds. Ask to bring them in.
- Markdown images in kitty and Ghostty, and the image path check (#179, #185): they live in `latex.ts`, which cc-dazzle dropped.
- Hebrew and right-to-left fixes (#181, #194, #195, #210, #217), CJK labels in figures (#201), the Korean demo, `/prismantis setup` (#178, #198, #206), the repro-issue hint (#203), and CI, badges and the security policy: parts cc-dazzle does not have.

## cc-stretch 0.3.3 to 0.5.1

Ported: code spans and fences read across lines and emoji counted as two cells (0.3.5), CJK and Thai line breaks and growth (0.3.6), a hang on a short form over several lines and Private Use Area characters drawn as written (0.3.7), the guide line "Stretch list items, not whole lists." (0.4.0), and a reply's flushes filtered in order (0.5.0). `parse.ts`, `grow.ts` and `guide.ts` are upstream's, unchanged; `layout.ts` takes the fixes by hand.

Left out on purpose:

- Keyboard letters (0.4.0), the style toolbar and tinted highlights (0.5.0), drag-select, double-click select and links drawn in a stretch paragraph (0.5.0, 0.5.1): features. Ask to bring them in.
- Filter state kept across a plugin reload (0.5.0): cc-stretch reloads on each toolbar save; cc-dazzle's settings change rarely.
- The plain cell after a styled paragraph (0.4.0): 0.5.1 took it out again.
- Tool-group folding (0.3.5): cc-dazzle draws tool rows itself.

## prismantis 0.15.1 to 0.24.0

Ported: the inline prose fixes, one-dash table rows, symbol widths, flowchart edges without spaces, HTML tags in mermaid labels, bar chart heights, the localhost check, fold ids, footnotes inside fences, error output of an expanded shell row, the redraw speedups, quotes and alerts that keep their blocks, clickable footnote marks, link handling by Claude Code version, shell edits drawn as diff cards, and copy buttons shown only on hover (the `copyButtonStyle` setting).

Left out on purpose:

- Figures (`figure` code blocks, 0.18.0): Claude writes them only when a system prompt note tells it to, and cc-dazzle has no such note.
- Diff tints from the theme (0.20.0, 0.22.0): cc-dazzle draws diffs in Claude Code's own colors.
- Parts cc-dazzle does not have: themes, LaTeX, right-to-left text, the clock option, quiet tool output, Windows HTML copy and the Codex plugin.
