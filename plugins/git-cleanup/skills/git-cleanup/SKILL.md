---
name: git-cleanup
argument-hint: "[--dry-run]"
disable-model-invocation: true
description: "Clean up stale git branches and worktrees. Finds branches merged into dev/develop/master/main, checks worktrees for uncommitted changes, and removes what's safe — skipping dirty worktrees. Use when the user says 'clean up branches', 'git cleanup', 'git housekeeping', 'remove stale branches', 'remove merged branches', 'clean worktrees', or any variation of wanting to tidy up their local git state."
---

# Git Cleanup

Removes local branches that have been merged into target branches (dev/develop/master/main), along with their associated worktrees. Worktrees with uncommitted or untracked changes are never removed.

## Workflow

1. Run the script in plan mode to show the user what will happen
2. Present the plan and wait for confirmation
3. Run the script in execute mode

## Steps

### 1. Show the plan

Run the script in dry-run mode. The script lives at `scripts/git_cleanup.sh` under this skill's base directory (shown in the skill header as "Base directory for this skill"). Use that absolute path — the `~/.claude/commands/...` location does not exist for plugin installs:

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh" --dry-run
```

Present the output to the user. The script categorizes branches into:
- **REMOVE** — merged and clean (or no worktree)
- **SKIP (dirty)** — merged but worktree has uncommitted changes
- **SKIP (current)** — merged but currently checked out
- **KEEP** — not merged into any target branch

### 2. Wait for confirmation

Ask the user to confirm before proceeding. If they want to exclude specific branches, note them.

### 3. Execute

Once confirmed, run without `--dry-run`:

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh"
```

The execute loop force-removes each clean worktree (`--force` gets past macOS `.DS_Store` that otherwise makes the dir "not empty"), `rm -rf`s any leftover dir, deletes the branch only after its worktree is gone, runs `git worktree prune`, and prints a `FAILED` list (exiting non-zero) if anything could not be removed. Surface that `FAILED` list to the user.

**Excluding branches:** if the user wants to keep specific branches out of the REMOVE set, pass them with `--exclude` (comma-separated) rather than hand-rolling git commands:

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh" --exclude=feature/keep-me,fix/also-keep
```

**Removing dirty worktrees the script SKIPPED (only when the user explicitly approves):** the script never touches dirty worktrees. If the user names dirty/skipped worktrees they want gone anyway, remove each manually in this exact order:

1. `git worktree remove --force <path>` — `--force` is mandatory; uncommitted/untracked changes in that worktree are permanently discarded, so confirm the user means it.
2. If the dir survives (git de-registers but leaves untracked files behind), `rm -rf <path>`.
3. Only then `git branch -d <branch>` — git refuses to delete a branch still checked out in a registered worktree, so the worktree must go first.
4. Finish with `git worktree prune`.
