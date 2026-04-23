---
name: pre-compact
description: >-
  Audits in-flight session state before a context-compacting step truncates
  history. Flags uncommitted git changes, scratch files, unfinished plans,
  running background tasks, and chat-only decisions; proposes concrete
  actions to persist what matters; produces a copy-paste focus message for
  the next session. Portable across Agent Skills hosts — compacting is a
  general concept, not Claude-specific.
when_to_use: >-
  Use when the user says "compact", "let's compact", "ready to compact?",
  "prep for compact", "suggest a compact message", "what should I put in
  /compact?", "shrink the context", "summarise and continue", or any
  variant signalling they're about to hit a context-truncating step.
  Run proactively even when the user just asks whether compacting is OK.
  Natural break + "context feels full" or "can we compact?" also triggers.
argument-hint: "[--message-only]"
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git stash *)
  - Bash(git checkout *)
---

# Pre-Compact

the compact step drop conversation history, keep only short summary you provide. Anything not persisted outside chat — half-written plan, unsaved inline snippet, background task name — gone. Skill audit so that no bite next session.

## When to use

Description covers most phrases. Whenever user about to run the compact step or asking whether should. Don't wait for explicit ask — natural break + "context feels full" or "can we compact?" = run flow.

## Modes

Raw input: `$ARGUMENTS`

- `$ARGUMENTS` contains `--message-only` (or `-m`, `message only`, `just the message`, `skip audit`) → **message-only mode**: skip steps 1–2, jump straight to step 3. Still run `git status --short` + `git log -5 --oneline` so the message can cite branch + recent commits accurately, but no audit summary, no action list.
- Otherwise → **full mode**: all three steps in order.

Also honour natural language overrides mid-conversation: if the user says "skip audit, just give me the message" after invocation, switch to message-only without re-running.

## The three steps

Do in order in full mode. Message-only mode skips 1 and 2.

Don't skip step 1 in full mode — point = catch lost things.

### 1. Assess: what's in flight?

First, gather the git baseline with two Bash calls:

```bash
git status --short
git log -5 --oneline
```

(On Claude Code, these calls are pre-approved via `allowed-tools` and run without prompting. On other hosts, the user may need to approve them once.)

Silent audit, report short structured summary. Check:

**Code state**
- Start from the `git status --short` output (and the last 5 commits). Unstaged/untracked files? Which matter (real work) vs. ignorable (temp/scratch)?
- Files edited this session user hasn't reviewed or uncommitted?
- ultrathink about which uncommitted changes represent real work vs experimental cruft — the call is subtle and wrong-side-of-the-line loses actual work.

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

Single code block with focus message user paste into the compact step. 3–6 sentences, optimized for next session cold-start.

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

**Compact message** (paste into your host's compact/summary prompt):
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

**Compact message:** (paste into host's compact/summary prompt)
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

**Compact message:** (paste into host's compact/summary prompt)
```text
Hotfix for rate-limit 503 on hotfix/rate-limit-503. Root cause: thundering-herd on token refresh. Fix in progress: jittered backoff in src/limiter.ts (uncommitted, intentional). Repro harness still running as background task capturing traces. Next: add a regression test, then commit + PR. Skip rerunning the repro — we already have enough traces.
```
```

## Message-only format

In message-only mode, drop the Audit/Action sections. Output shape:

```
**Compact message** (paste into your host's compact/summary prompt):
```text
[the focus message]
```
```

Keep the focus message grounded in the `git status` and `git log` output so branch, uncommitted work, and recent commits are accurate. No audit bullets, no action list, no preamble.

## Notes

- Compact message is *yours* — don't parrot user in-session. They compact because they trust you preserve what matters.
- Default = full audit. `--message-only` (or natural-language equivalents) skips straight to the message.
- State genuinely chaotic (many unfinished threads, half-implementations): say so, recommend *against* compacting until sorted — even in message-only mode. Losing one session context cheap; losing track of in-flight work not.
