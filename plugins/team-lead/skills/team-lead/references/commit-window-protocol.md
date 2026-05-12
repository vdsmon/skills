# Commit-Window Protocol

## Why this exists

Pre-commit hook runners (`prek`, `pre-commit`, `husky`, etc.) stash the working tree before running hooks, then restore after. When two teammates commit concurrently in the same repo:

1. Teammate A: `git commit` → prek stashes A's WIP + B's WIP → runs hooks → restores
2. Concurrently teammate B: `git commit` → prek stashes (already-stashed) tree → runs hooks
3. Restore order races. One teammate's WIP gets rolled back to a stale snapshot.

Observed twice in one session (T50, T73) — teammate had to re-apply edits multiple times. Each clobber costs ~5-10 minutes of re-work.

## Protocol v2 (canonical for most cases)

### Teammate side

```
1. Run all acceptance items locally.
2. DO NOT pre-stage. Skip `git add` until cleared.
3. SendMessage to team-lead:
   "ready to commit T<XX>" + listing YOUR specific file paths
4. Wait for team-lead reply: "go T<XX>"
5. On go:
     git reset HEAD            # clear any incidental staging
     git add <only-your-files> # explicit paths, NOT -A
     git commit -m "<msg>"
6. Report commit hash + task done.
```

### Lead side

```
1. Receive "ready to commit T<XX>" message.
2. Verify the file list matches what the story spec said the teammate would touch.
3. If others are mid-commit, queue this teammate. Send "Hold T<XX> — <other> committing first; you're next."
4. When no one else is mid-commit, send "go T<XX>" with the confirmed file list.
5. Wait for commit hash. Mark team-task completed.
6. Process next teammate in queue.
```

### Why no pre-stage

Git's index is **per-repository, not per-process**. Two teammates running `git add -A` in the same repo at the same time produce one merged index. The next `git commit` lands all files under one author's message. Wrong attribution + impossible to untangle cleanly.

Even with v2's no-pre-stage rule, see v3 below for the shared-file edge case.

## Protocol v3 (shared-file ownership addendum)

V2 prevents the index-merge from concurrent `git add -A`. It does **not** prevent the following:

**Scenario:** state-emitter and property-infra both modified `invariants.json` in working tree (each adding their own entries). State-emitter receives `go` first. Their `git add showcase/jrpg/invariants.json` picks up the working-tree state, which includes BOTH their additions AND property-infra's uncommitted additions. State-emitter's commit lands BOTH sets of changes under state-emitter's authorship.

End state on disk: correct (HEAD has all entries).
Authorship: wrong (property-infra's entries committed as state-emitter's).

Observed once in the session (T79/T80 invariants.json). Property-infra flagged it themselves post-commit.

### V3 mitigations (pick one based on what matters)

**(a) Shared-file ownership reservation (strictest):**
Lead designates ONE teammate per commit window who owns the shared files. Others stage everything EXCEPT shared files. After the owner's commit lands, the next teammate's working tree shows merged HEAD + their delta, and they stage shared files cleanly.

Use when commit attribution is load-bearing (audit, blame, story traceability).

**(b) Pre-commit shared-file split:**
Teammates working on shared rolling files commit those files separately first via a small "shared-state update" commit, then proceed with their main story commit. Doubles commits but isolates authorship.

Use when attribution matters but reservation feels heavy.

**(c) Accept the swallow (cheapest):**
If end state is correct, accept that authorship may be mis-attributed for append-only files. Commit body / PR description can clarify. Most cost-effective for solo-user repos where commit history isn't audited.

Use when end-state correctness > authorship correctness.

### Shared-file inventory (project-agnostic patterns)

Files that tend to be shared across stories in a typical multi-story epic:

| Pattern | Examples |
|---|---|
| Asset provenance ledgers | `ASSETS.md`, `LICENSES.md` |
| Game/journal state files | `invariants.json`, `tasks/games.md` |
| Task tooling | `mise.toml`, `Makefile`, `package.json` scripts |
| Schema docs | `manifest.schema.json`, `*.schema.json` |
| Project config | `project.godot`, `pyproject.toml`, `tsconfig.json` |
| Plugin protocols | `tools/verifiers/README.md`, plugin registries |
| Hard rule docs | `CLAUDE.md`, `CONTRIBUTING.md` |

Flag these in your file-conflict matrix at wave planning time.

## Two-attempt commits (post-hook regen)

When the pre-commit hook auto-regenerates files (DASHBOARD.md from frontmatter, lockfiles from deps, etc.), the first `git commit` attempt may fail with "files were modified by this hook." This is normal — the hook generated new content that wasn't in the original staging.

**Standard recovery (teach this to teammates):**

```
git commit -m "<msg>"
# hook regenerates DASHBOARD.md, commit fails
git add tasks/DASHBOARD.md    # re-stage the regenerated file
git commit -m "<msg>"          # second attempt succeeds
```

Tell teammates to expect this on stories that touch frontmatter or dep manifests. It's not a failure — it's how the regen hook signals "I changed something you need to include."

## Commit hash reporting

When granting "go," ask the teammate to report the **commit hash** in their done message, not just "task done." Hash lets the lead verify which commit actually landed + reference it in subsequent dispatches.

Format:
> "T78 committed: 30bd523. ..."

Avoid:
> "T78 shipped successfully." (no hash, no way to verify or reference)

## Failure modes

### Race: `git reset HEAD` clears another teammate's staging

If teammate A runs `git reset HEAD` to clear staging before their scoped `git add`, they may unstage teammate B's work that B already staged in error (pre-v2 pattern). End state: B's WIP back in working tree, unstaged.

**Mitigation:** ensure v2 is followed — no one pre-stages. Reset is then safe because nothing was supposed to be staged anyway.

### Lead doesn't reply to "ready"

If lead misses or delays the "go" reply, teammate sits idle. Worst case: 30 minutes of no-progress.

**Mitigation:** lead checks for "ready to commit" messages on every conversation turn. Reply within one turn if no other commit is in flight.

### Teammate commits without waiting for "go"

If a teammate bypasses the protocol and commits directly, the prek race can still happen. Other teammates' WIP may get clobbered.

**Mitigation:** include the protocol in every dispatch brief, broadcast it to existing teammates the moment they're spawned or when protocol updates. Reinforce: "Wait for `go T<XX>` reply. Do not commit yet."

## When this protocol is overkill

- Single-author session (no team) — prek's stash/restore works fine.
- Repo without pre-commit hooks — no stash mechanism, no race.
- Team where stories share zero files — no commit-window conflicts possible.
- One-off rapid-fire commits in a session that doesn't span days — coordination tax exceeds benefit.

Use judgment. The break-even is ~3 teammates committing in close temporal proximity to a hooked repo.
