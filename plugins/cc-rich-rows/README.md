# cc-rich-rows

Draws tool output that is a table as a table in the Claude Code transcript: a JSON array of objects, or CSV or TSV under a header line, from Bash or an MCP tool.

It is a mod: a hooks module Claude Code runs inside each interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-rich-rows@vdsmon-skills
```

## How it works

`gh pr list --json number,title,state` prints one long line of JSON. With the mod, its result row reads:

```
┌────────┬─────────────────────────────────┬────────┐
│ number │ title                           │ state  │
├────────┼─────────────────────────────────┼────────┤
│ 64     │ cc-turn-review: check each turn │ MERGED │
│ 63     │ Remove skill-smith              │ MERGED │
└────────┴─────────────────────────────────┴────────┘
2 rows · 1.2s
```

The footer gives the row count and how long the call ran. Claude reads the tool's output as it always did: only the drawing changes.

Claude Code folds read-only calls, which make most of this output (`gh`, `curl`, `jq`), into one count line such as `Ran 1 shell command`. The mod keeps that line and draws the table under it. When the group holds several calls, each table gets its command as a caption. ctrl+o unfolds the group and shows the raw output.

## Nothing is hidden

The mod draws a table only when all of it fits: 20 rows or fewer, 10 columns or fewer, and as wide as the transcript. Any other output keeps Claude Code's own drawing, so no row or cell is ever cut away. Claude Code does not tell a mod when ctrl+o expands a row, so a table that hid rows would hide them there too.

It also leaves alone:

- an errored call, and Bash output with anything beside stdout (stderr, an interrupt, a background task, a note such as "No matches found")
- CSV whose first line does not look like a header (short names that start with a letter, none twice) or reads like prose (`, `), such as `gh pr list` without `--json`

The width check uses the whole terminal. Beside a docked pane the transcript is narrower, so a wide table may wrap there.

## Tests

`mise run test:rich-rows` validates the mod and runs `hooks/rows.test.ts` through `claude plugin test`. It needs the `claude` CLI, so CI does not run it.
