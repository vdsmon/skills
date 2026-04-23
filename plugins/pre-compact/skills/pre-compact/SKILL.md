---
name: pre-compact
description: Prepare a session for `/compact` by auditing pending state before context is truncated. Trigger whenever the user says "compact", "let's compact", "ready to compact?", "prep for compact", "suggest a compact message", "what should I put in /compact?", or any variant signalling they're about to run `/compact`. Audit uncommitted git changes, scratch files, in-flight workflow state, unfinished plans, running background tasks — flag anything that would be lost, propose concrete actions to persist it, then produce a copy-paste-ready focus message that lets the next session pick up cleanly. Use this proactively even when the user just asks whether compacting is OK.
---

# Pre-Compact

`/compact` drop conversation history, keep only short summary you provide. Anything not persisted outside chat — half-written plan, unsaved inline snippet, background task name — gone. Skill audit so that no bite next session.

## When to use

Description covers most phrases. Whenever user about to run `/compact` or asking whether should. Don't wait for explicit ask — natural break + "context feels full" or "can we compact?" = run flow.

## The three steps

Do in order. Don't skip step 1 — point = catch lost things.

### 1. Assess: what's in flight?

Silent audit, report short structured summary. Check:

**Code state**
- `git status` in primary working dir (and any worktree). Unstaged/untracked files? Which matter (real work) vs. ignorable (temp/scratch)?
- Files edited this session user hasn't reviewed or uncommitted?

**Workflow / task state**
- State files, plan files, scratch notes session read/write — reflect current progress?
- Mid-task skill/agent invocations — next step clearly derivable from disk?
- TaskList — in-progress tasks that will orphan? (TaskList session-local; won't survive compact.)

**Background work**
- Background Bash tasks running or recently completed with unread output.
- Scheduled crons or wake-ups user should know about.

**Conversation-only knowledge**
- Verbal decisions not in any file: chosen approach, user preference, debug breakthrough. Not in code/note = must go in compact message.

Tight bulleted summary, not prose. Three to six bullets. Fewer if clean.

### 2. Raise: what needs action first?

Anything from step 1 that *should* persist before compacting: propose action. Don't do silently — user chance to say "skip" or "do first".

Typical actions:
- **Commit WIP** — uncommitted real work land in commit (or stash) before context lost.
- **Update state / plan file** — stale progress file → sync so next session resume from it.
- **Write a note** — chat-only decisions/context → drop into relevant plan/note/readme.
- **Capture background output** — read result of completed background task before buffer useless.

Order by blast radius — risk of losing real work first.

Nothing needs action: "State is clean. Ready to compact." Then step 3.

### 3. Propose: the compact message

Single code block with focus message user paste into `/compact`. 3–6 sentences, optimized for next session cold-start.

Good compact message include:

- **Where we are** — current task / branch / stage if applicable
- **What's done** — key milestones, test counts, decisions locked in
- **What's next** — literal next action on resume
- **Any gotchas** — open debug threads, things to skip or redo, non-obvious state
- **Pointers to persisted state** — "plan at X, state file at Y, branch Z"

Keep terse. Model reading has full file access — no paragraphs, just breadcrumbs to right files.

## Format

Respond in this shape:

```
**Audit**
- [short bullets of what's in flight]

**Action needed**
- [actions with rationale, or "none — state is clean"]

**Compact message** (paste into /compact):
```text
[the focus message]
```
```

Don't narrate three steps as "Step 1 / Step 2 / Step 3" sections — ceremony. Audit, actions, message.

## Examples

**Example — clean state, mid-task:**

```
**Audit**
- On branch `feat/parser-rewrite`, task is refactoring the tokenizer
- No uncommitted changes
- Plan + scratch notes on disk are current
- No background tasks running

**Action needed**
- None — state is clean.

**Compact message:**
```text
Resume tokenizer refactor on feat/parser-rewrite. Unit tests green (42 passing). Next: wire new tokenizer into the parser entrypoint and re-run the integration suite. Plan: docs/plan-parser-rewrite.md. One open thread: decide whether to keep the legacy whitespace-handling shim (see plan Open Questions).
```
```

**Example — uncommitted experimental changes:**

```
**Audit**
- Mid-debug on a prod incident, branch `hotfix/rate-limit-503`
- Modified: `.env` (swapped to staging creds for repro — not meant to ship)
- Modified: `src/limiter.ts` (added jittered backoff — wanted)
- Repro harness left running in background task `bash_3` (captures 503 traces)

**Action needed**
- Revert `.env` before compact so next session doesn't commit it unknowingly: `git checkout -- .env`.
- Read output of `bash_3` now — it will still be running but its earlier stdout is what you'll want to summarize.

**Compact message:**
```text
Hotfix for rate-limit 503 on hotfix/rate-limit-503. Root cause: thundering-herd on token refresh. Fix in progress: jittered backoff in src/limiter.ts (uncommitted, intentional). Repro harness still running as background task capturing traces. Next: add a regression test, then commit + PR. Skip rerunning the repro — we already have enough traces.
```
```

## Notes

- Compact message is *yours* — don't parrot user in-session. They compact because they trust you preserve what matters.
- User says "just give me compact message, skip audit": honor. Default = audit first.
- State genuinely chaotic (many unfinished threads, half-implementations): say so, recommend *against* compacting until sorted. Losing one session context cheap; losing track of in-flight work not.
