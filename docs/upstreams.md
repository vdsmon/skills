# Upstreams

Plugins here that copy code from another project, and the last upstream version we read for ideas. Update the row after each review: read upstream's changelog from the "Last checked" version on, then move the row forward.

| Plugin | Upstream | Copied from | Last checked | Checked on |
|---|---|---|---|---|
| cc-dazzle | [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) | fork `vdsmon/prismantis` 0.15.19, which split from upstream at 0.15.1 (`af067b6`) | 0.24.0 (`86b06d1`) | 2026-10-15 |
| cc-dazzle (stretchtext) | [pro-vi/cc-stretch](https://github.com/pro-vi/cc-stretch) | 0.3.3 (`4466e11`) | 0.3.3 (`4466e11`) | 2026-10-15 |

To list what is new since the last check:

```console
$ git clone https://github.com/NahumLitvin/prismantis && cd prismantis
$ git log --oneline 86b06d1..HEAD
```

## prismantis 0.15.1 to 0.24.0

Ported: the inline prose fixes, one-dash table rows, symbol widths, flowchart edges without spaces, HTML tags in mermaid labels, bar chart heights, the localhost check, fold ids, footnotes inside fences, error output of an expanded shell row, the redraw speedups, quotes and alerts that keep their blocks, clickable footnote marks, link handling by Claude Code version, shell edits drawn as diff cards, and copy buttons shown only on hover (the `copyButtonStyle` setting).

Left out on purpose:

- Figures (`figure` code blocks, 0.18.0): Claude writes them only when a system prompt note tells it to, and cc-dazzle has no such note.
- Diff tints from the theme (0.20.0, 0.22.0): cc-dazzle draws diffs in Claude Code's own colors.
- Parts cc-dazzle does not have: themes, LaTeX, right-to-left text, the clock option, quiet tool output, Windows HTML copy and the Codex plugin.
