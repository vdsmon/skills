# cc-changes

A side pane that lists every file the Claude Code session created, edited or deleted, with net line counts. Press a file to see its diff. It works in any folder, git repo or not.

It is a mod: a hooks module Claude Code runs inside each interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-changes@vdsmon-skills
```

## How it works

1. After each Edit, Write or Bash call, the mod reads what the tool reported it changed: the old file for Edit and Write, and the `bashEditDiff` hunks for Bash (heredocs, `sed`, scripts). Subagent calls count too.
2. The first time the session changes a file, the mod keeps the file as it was then. Every count and diff is against that copy, so a file edited five times shows its net change, not the sum of five edits.
3. A file changed back to how the session found it leaves the list.

```
4 files  +132 −37

M hooks/register.tsx          +88 −12
A hooks/timeline.test.ts       +41 −0
D old.ts                        +0 −24
M plugin.json                   +3 −1
```

Press a row (a click in fullscreen, or Tab and Enter once ctrl+x tab focuses the pane) to see that file's diff; **Back** (`b`) returns to the list.

Claude Code's own diff panel shows the git working tree. This pane shows only what this session changed, stays open beside the transcript, and does not need git.

## Limits

- Changes made by NotebookEdit, MCP tools or your own editor are not seen. Your own edits to a file the session already changed show as part of its change.
- A count shows `?` when the file could not be read (over 4 MiB) or the session's first change to it was not seen.
- `/clear` starts the list over.

## Commands

| Command | What it does |
| --- | --- |
| `/changes` | Opens the pane, or closes it when it is open |

## Tests

`mise run test:changes` validates the mod and runs `hooks/changes.test.ts` through `claude plugin test`. It needs the `claude` CLI, so CI does not run it.
