---
name: prep-compact
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

# Prep-Compact

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

Audit silently — **do not** dump a summary recap. The recap is noise; the user knows their own session. Audit feeds step 2 (surface save-actions) and step 3 (the compact message). Check:

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
- Verbal decisions not in any file: chosen approach, user preference, debug breakthrough. Not in code/note = goes in compact message (step 3), not an action.

### 2. Raise: only what needs saving

Output the **Action needed** section *only if* something must persist to disk before compacting — uncommitted real work, stale state file, unread background output. These are things the compact message can't preserve; they need a save first. Propose; don't do silently — user chance to say "skip" or "do first".

Typical actions:
- **Commit WIP** — uncommitted real work land in commit (or stash) before context lost.
- **Update state / plan file** — stale progress file → sync so next session resume from it.
- **Write a note** — chat-only decisions/context → drop into relevant plan/note/readme.
- **Capture background output** — read result of completed background task before buffer useless.

Order by blast radius — risk of losing real work first.

**Nothing needs saving → emit nothing here. Go straight to the compact message.** No "state is clean" line, no recap — that's noise.

### 3. Propose: compact message + follow-up

Output **two** code blocks:

1. **Compact message** — paste and send. Must start with the literal `/compact ` prefix, then the focus message, so paste fires the command directly, no editing. 3–6 sentences, optimized for next-session cold-start.
2. **Follow-up** — the user queues this *while compact runs*. The host fires queued input the moment compact finishes, so work resumes hands-free — no second prompt, no waiting. It's the literal next action, written as an imperative to your post-compact self.

Compact message holds **context**:

- **Where we are** — current task / branch / stage if applicable
- **What's done** — key milestones, test counts, decisions locked in
- **Any gotchas** — open debug threads, things to skip or redo, non-obvious state
- **Pointers to persisted state** — "plan at X, state file at Y, branch Z"

Follow-up holds **the next move**:

- One or two imperative sentences: the exact first action on resume.
- Self-contained — assume the summary plus file access are the only context. Name the file / command / function to touch first.

Keep both terse. Model reading has full file access — breadcrumbs, not paragraphs.

Tell the user plainly: send the compact block, then immediately paste the follow-up so it queues and chains.

## Format

No audit recap. If something needs saving, lead with the **Action needed** block; otherwise omit it and go straight to the message.

Clean state (the common case):

```
**Compact message** — paste and send:
```text
/compact [the focus message]
```

**Follow-up** — queue this while compact runs; it fires when compact finishes and chains the work:
```text
[the next-action kickoff]
```
```

Something needs saving first — prepend only the action block:

```
**Action needed**
- [save-action with rationale]

**Compact message** — paste and send:
```text
/compact [the focus message]
```

**Follow-up** — queue this while compact runs; it fires when compact finishes and chains the work:
```text
[the next-action kickoff]
```
```

No "Step 1 / Step 2 / Step 3" narration, no audit bullets — ceremony. Actions only if needed, then the two blocks.

## Examples

**Example — clean state, mid-task** (nothing to save → straight to the message, no recap):

```
**Compact message** — paste and send:
```text
/compact Tokenizer refactor on feat/parser-rewrite. Unit tests green (42 passing). Plan: docs/plan-parser-rewrite.md. One open thread: decide whether to keep the legacy whitespace-handling shim (see plan Open Questions).
```

**Follow-up** — queue while compact runs; fires on finish, chains the work:
```text
Continue the tokenizer refactor: wire the new tokenizer into the parser entrypoint, then re-run the integration suite and report failures.
```
```

**Example — uncommitted experimental changes** (real work at risk → surface the save-action, then the message):

```
**Action needed**
- Revert `.env` before compact so next session doesn't commit it unknowingly: `git checkout -- .env`.
- Read output of `bash_3` now — it will still be running but its earlier stdout is what you'll want to summarize.

**Compact message** — paste and send:
```text
/compact Hotfix for rate-limit 503 on hotfix/rate-limit-503. Root cause: thundering-herd on token refresh. Fix in progress: jittered backoff in src/limiter.ts (uncommitted, intentional). Repro harness still running as background task capturing traces. Skip rerunning the repro — we already have enough traces.
```

**Follow-up** — queue while compact runs; fires on finish, chains the work:
```text
Resume the 503 hotfix: add a regression test for the jittered backoff in src/limiter.ts, then commit and open the PR.
```
```

## Message-only format

In message-only mode, drop the Audit/Action sections. Still output both blocks:

```
**Compact message** — paste and send:
```text
/compact [the focus message]
```

**Follow-up** — queue while compact runs; fires on finish, chains the work:
```text
[the next-action kickoff]
```
```

Keep the focus message grounded in the `git status` and `git log` output so branch, uncommitted work, and recent commits are accurate. No audit bullets, no action list, no preamble.

## Notes

- Compact message is *yours* — don't parrot user in-session. They compact because they trust you preserve what matters.
- The follow-up only chains if queued *before* compact finishes — that's why the user sends the `/compact` block first, then immediately pastes the follow-up. The host holds queued input and fires it the instant compact returns.
- Keep the two blocks non-overlapping: context in the compact message, next action in the follow-up. Duplicating the next step in both wastes the summary.
- Default = full audit. `--message-only` (or natural-language equivalents) skips straight to the message.
- State genuinely chaotic (many unfinished threads, half-implementations): say so, recommend *against* compacting until sorted — even in message-only mode. Losing one session context cheap; losing track of in-flight work not.
