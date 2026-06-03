---
name: git-cleanup
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

Run the script in dry-run mode:

```bash
bash ~/.claude/commands/git-cleanup/scripts/git_cleanup.sh --dry-run
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
bash ~/.claude/commands/git-cleanup/scripts/git_cleanup.sh
```

If the user asked to exclude specific branches, don't use the script — instead manually run `git worktree remove` and `git branch -d` for only the approved branches.
