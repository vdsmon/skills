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

## prismantis 0.15.1 to 0.24.0: ideas not yet in cc-dazzle

- Footnote marks you can click, with the note in a toast (0.24.0).
- Quotes and alerts keep their paragraphs, lists, code blocks and tables (0.24.0). cc-dazzle draws a quote as one italic line.
- Figures: `figure` code blocks drawn as text pictures with role colors (0.18.0).
- Diff tints with a bolder green and red that keep code text at 4.5:1 contrast (0.20.0, 0.22.0).
- Shell edits (`sed -i`, scripts) drawn as the same diff card as Edit and Write (0.20.0).
- Copy buttons shown only on hover (0.20.0).
- Link fixes: unclickable links draw as plain text, `http:` links clickable on Claude Code 2.1.289 and later, `vscode://file` links on 2.1.294 and later (0.18.4, 0.19.0).
- Speed: streaming replies redraw about 3.7x faster, long table cells wrap in linear time (0.18.3).
- Prose fixes: `## Using C#` keeps its `#`, `wiki/Foo_(bar)` keeps its URL, `f(*args, **kwargs)` stays plain, text-style symbols such as `↔` take one column (0.18.3).
- Bar chart heights line up with the y-axis, and negative bars draw down from 0 (0.19.0).
- Mermaid labels with inline HTML tags draw as styles (0.16.0).
- Not listed: changes to parts cc-dazzle does not have, such as themes, LaTeX, Windows HTML copy and the Codex plugin.
