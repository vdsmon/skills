---
name: prep-exit
disable-model-invocation: true
description: Audits in-flight session state before the session ends, saves what only the conversation knows into files and persistent memory, and leaves a handoff note plus a paste-ready resume prompt for the next session.
argument-hint: "[--note-only]"
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git rev-parse *)
  - Bash(git stash push *)
  - Bash(git add *)
  - Bash(git commit *)
---

# Prep-Exit

A fresh session (a new conversation, another machine, another host) starts only from disk and from persistent memory. Nothing of this conversation reaches it: no summary, no background task output, no session-only cron, no task list. Resuming this same conversation (`claude --continue` or `--resume` in Claude Code) brings back the history and the crons that have not expired, but never background Bash or monitor output, and the user may never resume. So save as if the next session starts fresh. This skill audits what the conversation still holds, saves it where the next session will look, and leaves one resume prompt.

`prep-compact` is the sibling for compaction, where a summary survives and carries context. Here plan for nothing surviving, so every finding becomes a file or a memory entry, never a message.

## Modes

Raw input: `$ARGUMENTS`

- Contains `--note-only` (or "just the note", "skip the audit"): skip steps 1 and 2. Write the handoff and the memory entry from what you already know, then print the resume prompt.
- Otherwise: all four steps, in order.

Honour overrides mid-conversation ("skip the audit, just write the note").

## The four steps

### 1. Assess: what only this conversation knows

Gather the mechanical baseline in one call. The script lives in this skill's directory (the base directory announced when the skill loaded):

```bash
bash <skill-dir>/scripts/baseline.sh
```

It prints the branch and upstream, `git status --short` with counts, the last five commits, the stash count, and the gitignored plan or state files modified after the last commit. If the host refuses the script, fall back to `git status --short` and `git log -5 --oneline`.

Audit silently; do not dump a recap. The audit feeds step 2. Check:

**Code state**
- Uncommitted changes: which are real work and which are scratch (debug dumps, throwaway files)? Real work must land in a commit or a stash. Scratch stays out of git. Think carefully here: a wrong call on this line loses actual work or pollutes history.
- Repo rules and standing user instructions about commits and branches (CLAUDE.md, AGENTS.md, what the user said this session): they bound step 2.

**Workflow state**
- Plan and state files the session read or wrote: do they say where the work stands now? The script's "ignored files changed after the last commit" list is the starting point. A plan file that still says "in progress" for a finished step misleads the next session.
- A skill or agent mid-invocation: is the next step derivable from disk?
- The host's task list or pending chips: session-local, a fresh session never sees them. List them.

**Background work**
- Background tasks running or finished with unread output: read the output now. The buffer dies with the session, and a finished job nobody read is a result lost.
- A task still running: capture what it wrote so far and say it was unfinished.
- Crons, wake-ups, reminders scheduled inside this session: a fresh session does not get them back. List the ones still wanted so the next session recreates them. Only the ones with their own re-arm hook come back on their own.
- Messages from other sessions not yet answered: list them with what was asked.

**Conversation-only knowledge**
- Decisions and why (the approach chosen, the approach rejected and what failed), preferences the user stated, debug findings, numbers, deadlines. With compaction these ride in the summary. Here they go into the handoff and into memory, or they are gone.

### 2. Save: do what needs saving, then report

Do it now, in blast-radius order (real work first). Don't propose and wait: the user may close the laptop right after sending the command. Act, then report.

Save-actions are persistence only:
- **Commit real work** locally, or **stash** it (`git stash push -m "<what state it's in>"`) when a commit doesn't fit. Scratch stays out.
- **Sync plan and state files** to where the work stands.
- **Capture background output** into the handoff (and into the state file it belongs to).
- **List session-only crons, reminders, chips, and unanswered messages** for the handoff.

Commits:
- Follow the repo's conventions: message style, attribution rules, branch. Message says what state the change is in (WIP, tests pending).
- Stage by path. Never `git add -A` / `git add .`: sweeps in scratch and secrets.
- New commit only (no amend, no history rewrite), local only: never push.
- Hook rejects the commit: don't bypass (`--no-verify`). Hold it back, say why.

**Ask first.** Hold these back, never act unasked:
- hard to reverse or outward-facing: push, force-push, merge, PR creation, sending messages, deleting or discarding changes (`git checkout --`, `git reset`, `git clean`, removing files);
- anything a repo rule or standing user instruction forbids ("push nothing new", "never commit to main");
- a commit that would include secrets, `.env`-like files or large generated artifacts (commit the rest; hold back those files);
- uncommitted changes where real work vs. scratch is unclear;
- paid, long-running or background jobs.

Ask once: one question batching every held-back item, recommended choice first for each, printed with the hand-over in step 4. Nothing waits on the answer: every held-back item goes into the handoff under **Pending** as awaiting a yes, so the question survives an exit with no reply. If the user said they will not be around ("just save everything", "I won't answer"), skip the question; Pending still lists the items.

Exit prep saves state; it does not advance the work. A pending fix, a next step, a question from another session: record where it stands, do not do it now. Work done in the last minute lands unreviewed and the handoff then misreports where things are. Likewise, do not judge pending items closed (a benchmark "dead", a chip "moot"): record what you observed and leave the call to the next session.

### 3. Write the handoff and the memory entry

Pick the state dir: the repository's own state directory when it has one (`.flow/`, `.sweep/`, a notes directory the project uses); else, inside a repository, `$(git rev-parse --absolute-git-dir)/handoff`, which survives a reboot and is never committed; outside one, next to the host's memory files. Never the session scratch or temp directory: the next session cannot see it, and a reboot deletes it.

```bash
bash <skill-dir>/scripts/handoff.sh <state-dir>
```

It writes `<state-dir>/HANDOFF.md` with the git baseline embedded and the sections to fill, keeping an earlier handoff as `HANDOFF.prev.md`. Fill the sections by editing the file:

- **Where we are:** the task, the branch, the stage. One paragraph.
- **Done this session:** milestones, counts, commits.
- **Decisions and facts that live only here:** every item from the last audit bullet.
- **Pending:** held-back items awaiting a yes, background output captured and what it said, crons and reminders to recreate, chips still open, messages to answer.
- **Next step:** the first action of the next session, with the file or command to touch first.
- **Resume prompt:** the first message to paste into the next session. It names this file.

Then the memory entry, in the host's persistent memory. In Claude Code that is the memory directory named in your system prompt: one file per fact with its frontmatter, plus one pointer line in `MEMORY.md`, which the next session loads automatically. Write a `project` entry: the state of the work as of today's date, where `HANDOFF.md` is (absolute path), the next step, the gotchas. A preference the user stated is a separate `user` or `feedback` entry, because it outlives this piece of work. Keep the project entry short: the handoff holds the detail; memory holds the pointer plus what must survive even if the handoff is never opened. On a host with no persistent memory, the handoff is the memory: say so, and print its path.

### 4. Hand over

Print the format below and nothing else. Do not start new work after this; the next thing that happens is the exit.

If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it before you print, with `kind: handoff`, the resume prompt as `resumePrompt`, the absolute `HANDOFF.md` path as `handoffPath`, and `openQuestion: true` when **Needs your yes** holds a question.

If the user answers the held-back question before leaving: act on each yes, then edit the handoff (move the item from Pending to Done this session). Do not re-run `handoff.sh`, which starts a blank note. Reprint the resume prompt only if it changed, and then call the tool again.

## Format

No audit recap and no step narration. Leave out **Saved before exit** when nothing needed saving and **Needs your yes** when nothing was held back.

```
**Saved before exit**
- [action taken, with evidence: commit hash and subject, file path, what the note holds]

**Needs your yes** (also under Pending in the handoff)
[one question covering every held-back item, recommended choice first]

Handoff: `<state-dir>/HANDOFF.md`. Memory: `<file>`.

**Resume prompt** — paste as the first message of the next session:
```text
Resume from <state-dir>/HANDOFF.md: [one sentence on where we are]. First: [the next step].
```

The session can be closed.
```

## Rationalizations to refuse

| Thought | Answer |
|---|---|
| "git status is clean, nothing to save" | Clean status says nothing about decisions, background results, crons, or messages. The last audit bullet is the one that bites. |
| "I'll put it in the commit message" | A commit message describes a change. The next session reads memory and the handoff first. |
| "The user will remember" | The user's memory is not the next session's. |
| "The cron will recreate itself" | A fresh session gets back only the crons with their own re-arm hook; a resume of this same conversation restores the unexpired rest, and the user may never resume. List every cron still wanted. |
| "The background job is still running, I'll leave it" | Its output dies with the session. Capture what it wrote and say it was unfinished. |
| "This is scratch, but committing it is safer" | Scratch in history is noise the next session must undo. Name it in the handoff instead. |
| "The handoff is enough, memory is redundant" | Nothing opens the handoff unless memory points at it. |
| "I will finish the pending fix while I am here" | Exit prep records state; it does not advance the work. A last-minute change lands unreviewed, and the handoff then says the wrong thing about where the work stands. |
| "The throwaway directory is gitignored, so I will delete it" | Deleting is destructive and nobody asked. Name it in the handoff as safe to delete. |
| "One memory file per loose end keeps things tidy" | Memory holds one pointer and what must survive on its own; the handoff holds the detail. Several files per session bloat the index the next session loads. |
| "The benchmark is dead, the chip is moot, I will close them" | Judgments about pending items belong to the next session. Record what you saw (the log stopped at size 2 of 3; the README has no badge) and leave the items open. |
| "I will answer the other session's question myself" | Record it as unanswered with the current status. The person answers. |
| "The next step is really something else, I will re-scope it" | Write the next step as agreed. Put the observation under decisions and facts; the next session decides. |

## Notes

- The saves run without asking. What needs a yes is asked once, batched, never twice, and not at all when the user said they will not answer.
- The resume prompt is the next session's first message, so it must stand alone: the handoff path, one sentence of state, the first action.
- Portable: the audit, the handoff, and the resume prompt need only a shell and git. Persistent memory is used where the host has one.
