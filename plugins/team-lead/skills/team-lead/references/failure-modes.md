# Failure Modes (Catalog + Recovery)

Observed failure shapes from real team-lead sessions, with diagnosis + recovery.

## 1. T-fixation (atomic-imperative violation)

**Symptom:** teammate re-confirms a previous task done, ignores the new task assignment, then goes idle.

**Cause:** dispatch message combined "previous done" + "next task" phrasing. Teammate fixated on the first task ID mentioned.

**Recovery:**
1. Send a fresh ultra-minimal imperative message with no prior reference:
   ```
   Read `tasks/T<NN>-<slug>.md`. Implement it. Commit `<msg>`. Flip status to done. TaskUpdate task #<N>. Report.
   ```
2. If still no traction, send single-word "Yes" plus task number:
   ```
   Yes. Claim task #<N> and ship T<NN>.
   ```

**Prevention:** never combine task references in one message. One assignment per message. See `dispatch-patterns.md`.

## 2. Sandbox-gate stall (looks like a loop, isn't)

**Symptom:** teammate sends re-confirmation of last successful work 3-5 times. "Standing by" repeatedly. May explicitly mention "permission gate" or "sandbox denied."

**Cause:** task hit an action that requires user-side approval (third-party dep vendoring, secret pasting, destructive op). Teammate correctly refuses to proceed.

**Recovery:**
1. Read their message for the gate (look for phrases like "sandbox classifier," "explicit pin," "happy to claim if you want," "say the word").
2. Reply with the explicit approval the gate needs:
   ```
   Approved. Vendor `<repo>/<name>` v<X.Y.Z> from <url> under `addons/<name>/`. Proceed.
   ```
3. NOT another atomic-imperative — they need gate cleared, not another dispatch.

**Prevention:** before dispatching, scan the story spec for tasks involving third-party dependencies, destructive ops, or secret access. Pre-approve in the initial dispatch when possible.

## 3. prek/pre-commit stash race (concurrent commits)

**Symptom:** teammate reports "working tree changes restored from .cache/prek/patches/" — their unstaged edits rolled back to a stale snapshot. They have to re-apply.

**Cause:** prek stashes the working tree before running hooks, restores after. Two teammates committing concurrently → restore order races → one's WIP clobbered.

**Recovery:**
1. Teammate re-applies edits (often by re-running their work or restoring from their memory).
2. Lead applies commit-window protocol going forward (see `commit-window-protocol.md`).

**Prevention:** lead-mediated commit serialization (v2). Only one teammate commits at a time.

## 4. Concurrent `git add -A` index merge

**Symptom:** one teammate's commit accidentally includes another teammate's files. Commit message attributes work to wrong author.

**Cause:** both teammates ran `git add -A` in the same repo. Git's index is per-repo not per-process — the staging area now contains both sets.

**Recovery:**
1. Identify whose files landed under whom.
2. End state is usually correct (all files in HEAD). Attribution is the soft-fail.
3. If attribution matters: revert the commit + re-do with explicit-path staging. Otherwise document in commit body.

**Prevention:** v2 protocol — DO NOT pre-stage. Stage AFTER receiving "go," scoped to specific paths.

## 5. Shared-file authorship swallow (v3 issue)

**Symptom:** teammate's contributions to shared file (`invariants.json`, `mise.toml`) committed under another teammate's authorship.

**Cause:** even with v2 no-pre-stage, the OTHER teammate's `git add <shared-file>` swept the working tree state which included your uncommitted edits.

**Recovery:**
1. If end state correct → accept and document in PR description.
2. If attribution matters → revert + re-do with shared-file ownership reservation (v3).

**Prevention:** v3 protocol — designate one teammate per commit window who owns the shared files.

## 6. Wire-cross delays

**Symptom:** teammate's "ready to commit" message arrives after you've already moved on. Or your "go" message arrives after they've sent a re-confirm.

**Cause:** asynchronous message delivery + parallel processing. Both teammate and lead working on different parts of the conversation simultaneously.

**Recovery:**
1. Trust the most recent message from the teammate.
2. If they're asking for "go" → grant it.
3. If they're asking for "next task" → atomic-imperative dispatch.
4. Don't try to reconstruct exact order — work from the most recent state.

**Prevention:** don't preemptively dispatch the next task before the previous commit hash lands. Wait for confirmation before moving on.

## 7. Teammate ignores redirect

**Symptom:** lead sends "stop, your new task is T74" → teammate continues working T64 and ships it anyway.

**Cause:** redirect message arrived after teammate was deep in execution. They committed because their acceptance was already passing.

**Recovery:**
1. Accept the work — they shipped a real story.
2. Mark the originally intended task as still pending.
3. Re-dispatch them to it as a fresh assignment.

**Prevention:** check teammate's current task progress before issuing a redirect. If they're >50% through, let them finish.

## 8. DASHBOARD regen rejection (two-attempt commits)

**Symptom:** first `git commit` attempt fails with "files were modified by this hook." Teammate confused about whether commit succeeded.

**Cause:** pre-commit hook auto-regenerated a file (DASHBOARD.md, lockfile) that wasn't staged in the original commit. Hook refused the commit until the regenerated file is included.

**Recovery:**
1. Teammate re-stages the regenerated file:
   ```
   git add tasks/DASHBOARD.md
   git commit -m "<msg>"   # second attempt succeeds
   ```
2. This is normal — not a failure of the protocol.

**Prevention:** include "two-attempt commits expected post-hook regen" in the dispatch brief for stories touching frontmatter or dep manifests.

## 9. Empty teammate inbox after dispatch

**Symptom:** lead sends an atomic-imperative dispatch. Teammate's only response is an idle notification. No "starting work" message. Lead unsure if dispatch landed.

**Cause:** teammate woke on the message, processed it, started work silently, then went idle. The first task is read in their working state, no separate "started" emission.

**Recovery:** wait. Teammates work async. The next sign of progress will be either (a) a follow-up question, (b) the "ready to commit" message, or (c) the commit landing in git log.

**Prevention:** don't expect "starting work" acknowledgments. Trust silent progress. If 30+ minutes pass with no activity AND no commit-window request → consider checking in.

## 10. Idle teammate confusion

**Symptom:** teammate sends "standing by for next assignment" after every single message, even after you've already dispatched them. Spurious idleness reports.

**Cause:** dispatched task message hasn't been processed yet (race), or the dispatch message was ambiguous.

**Recovery:**
1. Check the team task list — do they have an active assignment with owner=them?
2. If yes, send single-word "Yes" or "Claim task #N and ship":
   ```
   Yes. Claim task #N and ship T<NN>.
   ```
3. If no, dispatch atomically.

**Prevention:** clearer dispatch messages. State the task # and task path explicitly. Make the imperative unambiguous.

## When to spawn a fresh teammate vs unstick the current one

| Situation | Action |
|---|---|
| Teammate hit a sandbox gate, awaiting your approval | Approve, don't replace |
| Teammate confused but still responsive | Re-dispatch atomic-imperative |
| Teammate has been re-confirming the same task 5+ times despite atomic redispatches | Try one-word "Yes" first |
| One-word "Yes" doesn't unstick after 2 sends | Consider fresh teammate |
| Teammate's domain mismatches the upcoming backlog | Spawn fresh teammate for the new domain |
| Teammate explicitly says they're done and queue is empty | Idle them (don't shutdown unless asked) |

Default to recovery, not replacement. Fresh teammates lose context. Recovery costs are usually lower than respawn cost.

## When to give up and act yourself

If a teammate is stuck on a small task (<30 min equivalent inline work) AND multiple recovery attempts haven't worked, the lead can short-circuit by doing the work inline:

```
1. Read the story spec.
2. Implement directly with main-thread tools.
3. Use explicit-path commit (avoid index merge with teammate WIP).
4. Tell the teammate "I patched this inline — stand down."
```

This is a last resort. It bypasses the team workflow but unblocks the rest of the epic. Don't make it a habit — it defeats the parallel-work payoff.
