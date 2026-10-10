# cc-turn-review

Reviews what each Claude Code turn changed on disk, for two rules: no over-design, and no comments or prose that break the comment rules. Most edits are Bash heredocs, `sed` or scripts, so a review of only the Edit and Write calls misses them. This mod snapshots the git working tree when a turn starts and again when it ends, so every change counts, whatever tool made it.

It is a mod: a hooks module Claude Code runs inside each interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-turn-review@vdsmon-skills
```

## How it works

1. When a turn starts, the mod snapshots the repo of the session's working folder.
2. Before each Bash, Edit, Write or NotebookEdit call, it finds the repos the call can write to (the file path, or the `cd` and `git -C` targets and absolute paths in the command). It snapshots a repo the first time the turn names it, before the call runs.
3. When the turn ends, it snapshots each of those repos again and diffs the two trees. Committed and uncommitted changes both count, and work from earlier turns does not come back.
4. If anything changed, one Haiku 5.5 call reads the diff and your last three prompts, and lists up to five findings:
   - **over-design**: more than the ask needs (a helper used once, options nobody asked for, defensive code for cases that cannot happen, refactors of nearby code)
   - **comments and prose**: comments that restate the code or name a person, and prose wrapped by hand in the middle of a sentence
5. Findings show in a band above the prompt: `Turn review: 2 findings · …  [View] [Fix] [Dismiss]`, with the hotkeys `v`, `r` and `s` once ctrl+x tab focuses the band. **Fix** sends them to Claude as your next prompt, asking it to check each one and fix the real ones. A clean review shows nothing. The band clears with your next prompt.

The review runs after the turn ends, so it never delays the answer. An interrupted turn rolls into the next one.

A snapshot is `git add -A` into a private index, then `git write-tree`, with git's objects written to a private folder under `~/.claude/.cc-turn-review/<session>/`. HEAD, the real index, the stash and `.git/objects` stay untouched. The folder is removed when the session ends.

## Limits

- Only git repos are reviewed. Writes to scratch folders, `~/.claude` and other folders outside git are not.
- A repo made and edited in the same command is not seen: there was no repo to snapshot before the command ran.
- A repo whose snapshot fails or takes over 10 s is skipped for the rest of the session, with a toast.
- Untracked files that are not ignored are hashed at each snapshot, so a big data dump outside `.gitignore` slows it down.
- Files changed by commits that came in during the turn (a pull, or upstream commits in a rebase) are left out: a commit older than the turn start is not the turn's work. A file that Claude also edited in that turn is left out too.
- Your own edits in the same worktree during the turn, or another session's, show as the turn's. The Fix prompt tells Claude to leave alone any change it did not make.
- Lockfiles appear by name only, and the diff is cut at 40k characters.

## Commands

| Command | What it does |
| --- | --- |
| `/turnreview` | Shows the last review: files, findings and tokens |
| `/turnreview off` / `/turnreview on` | Turns reviews off or on for this session |

## Tests

`mise run test:turn-review` validates the mod and runs `hooks/turnreview.test.ts` through `claude plugin test`, with a fake git and model. It needs the `claude` CLI, so CI does not run it.
