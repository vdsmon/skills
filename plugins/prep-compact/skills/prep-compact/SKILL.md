---
name: prep-compact
disable-model-invocation: true
description: Audits in-flight session state before compaction truncates history, saves what would be lost (local commits, state files, notes), then emits a paste-ready focus message for the next session.
argument-hint: "[--message-only | --propose]"
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git stash push *)
---

# Prep-Compact

Compaction drops the conversation history and keeps only the short summary you write. Anything not saved outside the chat (a half-written plan, an unsaved snippet, a background task name) is gone. This skill audits the session and saves what would be lost, so the next session does not miss it.

## When to use

Use it when the user is about to compact, or asks whether they should. This skill acts (commits, writes files), so it runs only when the user asks.

## Modes

Raw input: `$ARGUMENTS`

- `$ARGUMENTS` contains `--message-only` (or `-m`, `message only`, `just the message`, `skip audit`) -> **message-only mode**: skip steps 1-2, jump straight to step 3. Still run `scripts/baseline.sh` (or the two git commands it wraps) so the message can cite branch + recent commits accurately, but no audit summary, no saves.
- `$ARGUMENTS` contains `--propose` (or `-p`, `propose only`, `don't act`, `just list`) -> **propose mode**: step 2 lists the save-actions under **Action needed** instead of doing them, then the message as usual. Do nothing until the user answers; on a go-ahead, run the approved saves, re-run the baseline, reissue the message if what it cites changed.
- Otherwise -> **full mode**: all three steps in order, saves carried out.

Also honour natural language overrides mid-conversation: "skip audit, just give me the message" -> message-only without re-running; "don't do anything, just list it" before the saves ran -> propose.

## The three steps

Do them in order. In full mode never skip step 1: its point is to catch what would be lost.

### 1. Assess: what's in flight?

First, gather the mechanical baseline in one call. The script lives in this skill's directory (the base directory announced when the skill loaded):

```bash
bash <skill-dir>/scripts/baseline.sh
```

It prints the branch and upstream, `git status --short` with counts, the last five commits, the stash count, and the gitignored plan or state files modified after the last commit: the files a compact message must point at and that `git status` never shows (a `.sweep/plan.md`, a `.flow/` record, a scratch note). Deterministic work belongs in the script, not in your memory of what to check. The script asks for one Bash approval per session on hosts that pre-approve only the `git` prefixes below; if the host refuses it, fall back to `git status --short` and `git log -5 --oneline`.

Audit silently, and **do not** dump a summary recap. The recap is noise; the user knows their own session. Audit feeds step 2 (the saves) and step 3 (the compact message). Check:

**Code state**
- Start from the status output (and the last 5 commits). Unstaged/untracked files? Which matter (real work) vs. ignorable (temp/scratch)?
- Files edited this session user hasn't reviewed or uncommitted?
- ultrathink about which uncommitted changes represent real work vs experimental cruft: the call is subtle and wrong-side-of-the-line loses actual work. Still unclear after thinking = ask (step 2), don't guess.
- Repo rules and standing user instructions about commits and branches (CLAUDE.md, AGENTS.md, what the user said this session): they bound step 2.

**Workflow / task state**
- State files, plan files, scratch notes session read/write: reflect current progress? The "ignored files changed after the last commit" list from the script is the starting point: each entry either reflects the current state or needs a sync before compacting.
- Mid-task skill/agent invocations: next step clearly derivable from disk?
- TaskList: in-progress tasks that will orphan? (TaskList session-local; won't survive compact.)

**Background work**
- Background Bash tasks running or recently completed with unread output.
- Scheduled crons or wake-ups user should know about.

**Conversation-only knowledge**
- Verbal decisions not in any file: chosen approach, user preference, debug breakthrough. Always goes in compact message (step 3). Also a save (step 2) when the project keeps a plan / note / diary it belongs in, or it outlives the task (memory).

### 2. Save: do what needs saving

Something must persist to disk before compacting (uncommitted real work, stale state file, unread background output, a decision only chat holds): the compact message can't preserve it. Do it now, in blast-radius order (risk of losing real work first). Don't propose and wait: act, then report.

Save-actions are persistence only:
- **Commit real work** locally, or **stash** (`git stash push -m "<what state it's in>"`) when a commit doesn't fit.
- **Sync a stale state / plan file** so next session resumes from it.
- **Write a note or diary entry** for chat-only decisions, in the file the project already keeps for them. Don't invent a new doc.
- **Capture background output:** read a finished task, summarize it into the note or the compact message before the buffer is useless.
- **Save a memory**, where the host has persistent memory, for what outlives this task (a stated preference, a standing rule).

Not a save, never done here: fixing a bug, relaunching a job, a long or paid run, any next step of the work. It goes into the compact message as an open thread and into the follow-up as the next move. Compact prep saves state; it doesn't advance the work.

Commits:
- Follow the repo's conventions: message style, attribution rules, branch. Message says what state the change is in (WIP, tests pending).
- Stage by path. Never `git add -A` / `git add .`: sweeps in scratch and secrets.
- New commit only (no amend, no history rewrite), local only: never push.
- Hook rejects the commit: don't bypass (`--no-verify`). Hold it back, say why.

**Ask first.** Hold these back, never act unasked:
- hard to reverse or outward-facing: push, force-push, merge, PR creation, sending messages, deleting or discarding changes (`git checkout --`, `git reset`, removing files);
- anything a repo rule or standing user instruction forbids ("push nothing new", "never commit to main");
- a commit that would include secrets, `.env`-like files or large generated artifacts (commit the rest; hold back those files);
- uncommitted changes where real work vs. experimental cruft is unclear;
- paid, long-running or background jobs.

Ask once: one question batching every held-back item, recommended choice first for each. Do everything else in the meantime; the saves never wait on the answer. On a yes, act, re-run the baseline, reissue the message only if what it cites changed.

After the saves, re-run `scripts/baseline.sh` so the compact message cites the state after them: new commit hashes, updated paths.

**Nothing needs saving -> emit nothing here. Go straight to the compact message.** No "state is clean" line, no recap (that's noise).

### 3. Propose: compact message + follow-up

Output **two** code blocks:

1. **Compact message:** paste and send. Must start with the literal `/compact ` prefix, then the focus message, so paste fires the command directly, no editing. 3-6 sentences, optimized for next-session cold-start.
2. **Follow-up:** the user queues this *while compact runs*. The host fires queued input the moment compact finishes, so work resumes hands-free: no second prompt, no waiting. It's the literal next action, written as an imperative to your post-compact self.

Compact message holds **context**:

- **Where we are:** current task / branch / stage if applicable
- **What's done:** key milestones, test counts, decisions locked in, commits made in step 2 (local, unpushed)
- **Any gotchas:** open debug threads, things to skip or redo, non-obvious state, every held-back item still awaiting a yes (so the question survives an unanswered compact)
- **Pointers to persisted state:** "plan at X, state file at Y, branch Z"

Follow-up holds **the next move**:

- One or two imperative sentences: the exact first action on resume.
- Self-contained: assume the summary plus file access are the only context. Name the file / command / function to touch first.

Keep both terse and non-overlapping: context in the compact message, the next action only in the follow-up. Model reading has full file access: breadcrumbs, not paragraphs.

Tell the user plainly: send the compact block, then immediately paste the follow-up so it queues and chains.

If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it with `kind: compact`, the focus message without the `/compact ` prefix as `message`, the follow-up as `followUp`, and `openQuestion: true` when **Needs your yes** holds a question. Print both blocks as usual. Call it again whenever you reissue the message.

## Format

No audit recap. Saves done -> lead with **Saved before compacting**, one line per action with its evidence (commit hash and subject, file path, what the note holds). Something held back -> **Needs your yes** with the single batched question. Neither when nothing needed saving (the common case).

```
**Saved before compacting**
- [action taken, with evidence]

**Needs your yes**
[one question covering every held-back item, recommended choice first]

**Compact message** — paste and send:
```text
/compact [the focus message]
```

**Follow-up** — queue this while compact runs; it fires when compact finishes and chains the work:
```text
[the next-action kickoff]
```
```

Propose mode: **Action needed** (one line per save-action, with rationale) in place of **Saved before compacting**, then the message.

Message-only mode: same two blocks, no Saved or Needs-your-yes.

No "Step 1 / Step 2 / Step 3" narration, no audit bullets (ceremony).

## Example

**Real work at risk** (saves done, then the message citing the new state):

```
**Saved before compacting**
- Committed `4e1a9c2` wip(limiter): jittered backoff on token refresh, regression test pending.
- Read `bash_3` (repro harness, finished): 12 traces, every 503 within 40 ms of a token refresh. Summary under Findings in `.flow/hotfix-503/plan.md`.
- Synced `.flow/hotfix-503/plan.md`: root cause done, fix in progress, regression test next.

**Compact message** — paste and send:
```text
/compact Hotfix for rate-limit 503 on hotfix/rate-limit-503. Root cause: thundering-herd on token refresh (traces summarized in .flow/hotfix-503/plan.md, Findings). Fix committed locally as 4e1a9c2 (jittered backoff in src/limiter.ts), not pushed. Skip rerunning the repro; the traces are enough.
```

**Follow-up** — queue while compact runs; fires on finish, chains the work:
```text
Resume the 503 hotfix: add a regression test for the jittered backoff in src/limiter.ts, run the limiter suite, then commit.
```
```

## Notes

- Compact message is *yours*, so don't parrot user in-session. They compact because they trust you preserve what matters.
- State genuinely chaotic (many unfinished threads, half-implementations): say so, recommend *against* compacting until sorted, even in message-only mode. Save what's clearly real work anyway. Losing one session context cheap; losing track of in-flight work not.
