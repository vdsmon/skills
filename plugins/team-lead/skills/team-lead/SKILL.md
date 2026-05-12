---
name: team-lead
description: Coordinating an Agent-spawned team of teammates shipping a multi-story epic. Battle-tested patterns for atomic-imperative dispatch, lead-mediated commit serialization, file-conflict-aware wave composition, sandbox approval handling, and concurrent-edit recovery. Use this skill whenever the user invokes TeamCreate + spawns subagents to ship N stories in parallel — especially when stories share files, when prek/precommit hooks are in play, or when teammates need to coordinate commits in the same repository. Also trigger when the user says "spawn a team", "dispatch teammates", "ship an epic with multiple agents", "coordinate parallel work", or any variant of orchestrating a small swarm of agents through tasks tracked in a shared TaskList. Do not use for single-agent dispatches — this skill is specifically for the 3+ teammate case where coordination overhead becomes load-bearing.
---

# Team Lead Playbook

You are the team lead of an Agent-spawned swarm. Your job is to (1) decompose the epic into stories with declared file ownership, (2) dispatch teammates with **atomic-imperative messages**, (3) serialize commits through a **commit-window protocol** to avoid prek/precommit races, (4) catch teammates stuck on sandbox gates instead of mistaking them for confused loops, (5) handle shared-file ownership when stories overlap on `invariants.json`, `mise.toml`, `manifest.schema.json`, etc.

This skill captures patterns battle-tested across 21 ships in one session on a Godot scenario harness. The technical primitives are not exotic — what makes them work is the discipline.

## When this skill applies

- User has TeamCreate'd a team and is about to spawn ≥3 teammates working on related stories.
- Stories live as `tasks/T*.md` files (or equivalent per-story spec format) with frontmatter declaring deps + file ownership.
- Repo has pre-commit hooks (`prek`, `pre-commit`, or similar) that stash + restore the working tree.
- Multiple teammates may commit during the same session.

If only one teammate is working, skip this skill — vanilla Agent dispatch is fine.

## The four moves (in order)

### 1. Compose waves by file-conflict matrix

Before dispatching any teammate, build a file-conflict matrix from the story specs:

```
                    runtime.gd   schema.json   tools/    mise.toml   ...
T70 emit-state      EDIT         EDIT          EDIT      —
T71 fixture         EDIT (after T70)
T72 rng             EDIT (after T70/T71)
T59 import-sprite   —            —             NEW       EDIT
T53 hypothesis      —            —             —         EDIT
```

**Rules:**
- Append-only files (`mise.toml`, `CLAUDE.md`, `ASSETS.md`, `invariants.json`, `tasks/games.md`) **force serial dispatch** even when stories don't have explicit deps. Two teammates editing the same shared file → guaranteed merge conflict OR (worse) one teammate's `git add` swallows the other's uncommitted changes.
- Same-file-different-section is still risky — pre-commit hooks process the whole file. Treat as serial.
- Stories declaring different new files only = freely parallel.

**Wave 1 = stories with no deps + no shared file conflicts.** Usually 3 max in parallel. More teammates than parallel-safe stories = idle teammates = wasted coordination overhead.

### 2. Dispatch with atomic-imperative messages

**The single biggest discipline:** dispatch messages must be **atomic** (one task per message) and **imperative** (lead with the verb on the new file). Never combine "previous task done" + "next task" in one send.

**Why:** teammates fixate on the first task-id mentioned in a message and treat the rest as commentary. A message like "T59 shipped cleanly — next task is T60" gets parsed as "re-confirm T59 done"; the T60 assignment is ignored. Observed three separate times in the same session across different teammates.

See `references/dispatch-patterns.md` for the canonical message template + observed failure shapes.

**Ultra-minimal template (use this verbatim):**

```
Read `tasks/T<NN>-<slug>.md`. Implement it. Commit `<conventional-commit-msg>`. Flip T<NN> frontmatter status to done. TaskUpdate task #<N> completed. Report.
```

No prior-task references. No congratulations. No "FYI other teammates are working on X." Just the imperative chain.

### 3. Serialize commits through commit-window protocol

Pre-commit hooks (prek, pre-commit) stash the working tree before running hooks and restore after. When two teammates commit concurrently, the restore can clobber the other's uncommitted edits. Even with no file overlap, the race is real.

**Protocol v2 (canonical):**

```
1. Teammate runs all acceptance items locally.
2. DO NOT pre-stage. Skip git add entirely until cleared.
3. Message team-lead: "ready to commit T<XX>" + list YOUR specific file paths.
4. Wait for team-lead reply: "go T<XX>" (with confirmed file list).
5. On go: `git add <only-your-files>` then `git commit -m "..."` — atomic, scoped.
6. Report commit hash + task done.

Lead grants "go" to ONE teammate at a time. Others wait in queue.
```

**Why no pre-stage:** git's index is per-repository, not per-process. If two teammates both `git add -A`, the index merges both sets — the next `git commit` lands everyone's files under one author's message. Wrong attribution + impossible to untangle.

See `references/commit-window-protocol.md` for the full protocol + v3 (shared-file ownership) addendum.

### 4. Recognize sandbox-approval stalls vs confusion loops

When a teammate sends "ready" / "standing by" / "no work to redo" repeatedly for the same task, the default reading is "they're stuck in confirmation loop." That reading is often wrong.

**The alternative: they're sandbox-blocked.** Some operations (third-party dependency vendoring, secret access, destructive ops) hit a sandbox classifier that denies execution without explicit user-side approval. The teammate sees "blocked," can't proceed, reports their last successful state, and waits.

**Diagnostic:** check the task spec for permission gates before dispatching another nudge. Read the teammate's message for phrases like "sandbox denied," "permission gate," "need explicit pin," "happy to claim if you want." If present → respond with the explicit approval, not a re-dispatch.

See `references/failure-modes.md` for the full catalog of observed stalls + recovery moves.

## Wave dispatch sequence (canonical workflow)

```
1. Read all pending story specs. Build dep graph + file-conflict matrix.
2. Identify Wave-1 candidates: zero deps, zero shared-file conflicts.
3. TeamCreate <team-name>; spawn N teammates (N = wave-1 size, max 3).
4. TaskCreate one team-level task per story (mirror the in-repo story IDs).
5. TaskUpdate to set owner per teammate.
6. SendMessage atomic-imperative dispatch to each.
7. WAIT for "ready to commit T<XX>" messages. Don't poll, don't ask.
8. For each ready message: reply "go T<XX>" — serialize one at a time.
9. After commit hash reported, mark team-task completed.
10. Re-evaluate dep graph: which stories just unblocked? Compose Wave 2.
11. SendMessage atomic-imperative dispatch to teammates whose previous work landed.
12. Repeat until backlog empty OR user redirects.
```

## Teammate domain matching

Assign stories to teammates whose accumulated context fits. Idle teammates retain repo knowledge between dispatches — preserve it. Don't shutdown teammates mid-session unless explicitly asked.

**Heuristics observed:**
- Teammate who shipped harness/runtime.gd story N is the natural owner for runtime.gd story N+1 (serial chain).
- Teammate who shipped a verifier plugin is well-positioned for adjacent verifier work.
- Teammate who authored a test-shape probe should ship sibling probes.
- Fresh teammate spawn = ~0 ramp-up but loses prior session context.

**Skill: when to spawn fresh vs stretch an existing teammate?** If the new story is in the same domain → existing. If the domain shifts (e.g., asset import work → tilemap addon vendoring) → fresh teammate often works better than stretching context.

## Common failure modes (quick reference)

| Symptom | Likely cause | Fix |
|---|---|---|
| Teammate re-confirms previous task instead of starting new one | Atomic-imperative violation (you combined messages) | Re-send pure imperative; never mention previous task |
| `prek` rejects commit "files were modified by this hook" | Auto-staged DASHBOARD/lockfile changed after staging | Re-stage post-hook + retry (two-attempt is normal) |
| Two teammates' files end up in one commit | Both ran `git add -A` concurrently | Use v2 protocol: stage AFTER go, scoped to specific paths |
| Teammate reports "no work to redo, standing by" 5x | Sandbox-gate stall on third-party action | Read their last message for the gate; send explicit approval |
| Shared file (`invariants.json`) entries swallowed by another teammate's commit | v2's no-pre-stage didn't help — race is at the OTHER teammate's `git add` | v3 protocol: lead reserves shared-file ownership per window |
| Teammate ignores your redirect, ships original assignment anyway | Redirect message arrived after they were deep in execution | Accept the work, redispatch them to the intended task as a fresh assignment |

See `references/failure-modes.md` for the full catalog.

## What not to do

- **Don't poll teammates.** Messages from teammates are delivered automatically as conversation turns. Asking "how's it going?" wastes their inference budget.
- **Don't auto-shutdown idle teammates.** Idle is the normal state; teammates retain repo knowledge between dispatches. Shutdown = context loss + respawn cost. Wait until user asks OR until the team's epic is fully closed.
- **Don't combine confirmations + dispatches.** Every assignment message is atomic — pure imperative on the new file.
- **Don't bypass the commit-window protocol** to "save time" — the prek stash race WILL bite you, and recovery costs more than the protocol overhead.
- **Don't dispatch more parallel teammates than truly parallel-safe stories.** Idle teammates are coordination tax with no payoff.

## Coordination with project-specific context

This skill captures the universal playbook. Project-specific lane assignments (which teammate fits which story type) belong in per-project memory:

- `~/.claude/projects/<repo-slug>/memory/feedback_team_dispatch_pattern.md`
- `~/.claude/projects/<repo-slug>/memory/feedback_concurrent_prek_stash.md`
- `~/.claude/projects/<repo-slug>/memory/feedback_commit_window_protocol.md`
- `~/.claude/projects/<repo-slug>/memory/team_lane_map.md` (optional)

Reference them at session start if a team-lead workflow is anticipated.

## When NOT to use this skill

- Solo dispatch (one Agent at a time) — vanilla Agent tool is fine.
- Repo has no pre-commit hooks — commit serialization isn't needed.
- Stories have no shared files AND no shared lanes — file-conflict matrix is overkill.
- One-off explore/research tasks — these don't warrant team coordination.

The break-even is ~3 teammates working stories that touch overlapping files in a hooked repo. Below that, ad-hoc is cheaper.
