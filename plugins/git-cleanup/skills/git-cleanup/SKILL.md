---
name: git-cleanup
argument-hint: "[--dry-run]"
disable-model-invocation: true
description: Removes stale git branches and worktrees that are safely merged, skipping anything dirty. Squash-merge aware on GitHub remotes. Also clears clean detached worktrees whose commits are on a branch.
---

# Git Cleanup

Removes local branches that have been merged into target branches (dev/develop/master/main), along with their associated worktrees. Worktrees with uncommitted or untracked changes are never removed, and neither is the main checkout.

Detached worktrees (made for an experiment at a fixed commit) have no branch, so merge detection cannot see them. The script removes one when it is clean and every commit in it is also on a branch, a remote branch or a tag, so nothing is lost. It also prunes worktrees whose folder is already gone.

Merge detection is ancestry-based (`git branch --merged`) plus squash-aware on GitHub remotes: when `gh` is available, a branch also counts as merged if its tip equals the head SHA of a merged PR, or if its net diff has the same patch-id as the PR's merge commit (a PR branch rewritten before merge). A branch with changes the PR never had stays in KEEP, with the PR number shown.

## Workflow

1. Run the script in plan mode to show the user what will happen
2. Present the plan and wait for confirmation
3. Run the script in execute mode

## Steps

### 1. Show the plan

Run the script in dry-run mode. The script lives at `scripts/git_cleanup.sh` under this skill's base directory (shown in the skill header as "Base directory for this skill"). Use that absolute path. The script needs bash 4+; if it exits with "needs bash 4+", tell the user to `brew install bash`.

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh" --dry-run
```

Present the output to the user. The script categorizes branches into:
- **REMOVE:** merged and clean (or no worktree); squash-merged entries are annotated with their PR number
- **SKIP (dirty):** merged but worktree has uncommitted changes
- **SKIP (current):** merged but currently checked out
- **SKIP (main worktree):** merged but checked out in the main checkout; the user must switch it to a target branch first
- **KEEP:** not merged into any target branch
- **REMOVE (detached worktree):** clean, and every commit is also on a branch; shown with its HEAD and age
- **SKIP (detached worktree):** dirty, locked, or the worktree the script runs in
- **KEEP (detached worktree):** has commits no branch holds; the count is shown
- **PRUNE:** the folder is gone, so only git's registration of it is removed

A `WARN: fetch failed` line means the plan uses cached remote refs; say so when you present it.

### 2. Wait for confirmation

Ask the user to confirm before proceeding. If they want to exclude specific branches, note them.

### 3. Execute

Once confirmed, run without `--dry-run`:

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh"
```

If the script prints `FAILED`, show that list to the user.

**Excluding branches or worktrees:** if the user wants to keep specific branches or detached worktrees out of the REMOVE set, pass the branch names or the worktree paths with `--exclude` (comma-separated) rather than hand-rolling git commands:

```bash
bash "<skill-base-dir>/scripts/git_cleanup.sh" --exclude=feature/keep-me,fix/also-keep
```

**Removing dirty worktrees the script SKIPPED (only when the user explicitly approves):** the script never touches dirty worktrees. If the user names dirty/skipped worktrees they want gone anyway, remove each manually in this exact order:

1. `git worktree remove --force <path>`: `--force` is mandatory; uncommitted/untracked changes in that worktree are permanently discarded, so confirm the user means it.
2. If the dir survives, run `git worktree list` first. Only if it no longer shows `<path>` (git de-registered it but left files behind), `chmod -R u+w <path>` then `rm -rf <path>`. If git still lists the path, stop: it is the main checkout (always the first entry) or a locked worktree, and `rm -rf` would destroy a live checkout. A "Permission denied" from step 1 or from `rm` almost always means the worktree holds read-only files (content-addressed store blobs, immutable caches) in read-only dirs, NOT a sandbox or ownership wall; `chmod -R u+w` is what lets `rm` unlink them.
3. Only then `git branch -d <branch>`: git refuses to delete a branch still checked out in a registered worktree, so the worktree must go first. Use `-D` if the branch was squash-merged (`-d` refuses non-ancestors), but only after confirming its PR is actually merged.
4. Finish with `git worktree prune`.

**Wiping unmerged branches too (the KEEP set), when the user says "wipe them all":** the script never deletes unmerged branches because their commits may exist nowhere else. When the user explicitly wants them gone, do not `git branch -D` blindly:

1. **Write a recovery map first.** Snapshot every branch tip to a durable file outside the repo, so any deletion is reversible: `git for-each-ref --format='%(objectname) %(refname:short)' refs/heads > ~/branches-wiped-$(date +%F).txt`. Deleted commits linger in the object store ~2 weeks, so `git branch <name> <sha>` from this file recovers any of them. Tell the user where the file is.
2. **Verify nothing meaningful is lost** (the "is it meaningful?" check). A branch is safe to drop if its patches already landed in the target under another name (squash-merge: compare with `git patch-id --stable` against target commits) or its tip exists on `origin` (recoverable from the remote). A local-only branch whose patches are NOT in the target is genuine unmerged work: show the user `git log origin/<target>..<branch>` before deleting it.
3. Delete with `git branch -D <branch>` (`-d` refuses unmerged branches since they are never ancestors of the target). Remove any worktree first, per the dirty-worktree steps above.
