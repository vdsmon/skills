---
name: close
disable-model-invocation: true
description: Closes a session for good, with no next session to pick it up. Audits what only the conversation knows, saves each finding where it lives for good, tidies what the session left running, and in a Claude Code background session stops the session after the report.
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git rev-parse *)
  - Bash(git merge-base *)
  - Bash(git stash push *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(bash *scripts/stop-self.sh)
---

# Close

No next session will pick this work up. Save what only this conversation knows where it lives for good, tie up what the session left running, report, and end the session.

## 1. Audit and save

Read steps 1 and 2 of the handoff skill, `<skill-dir>/../handoff/SKILL.md` (the base directory announced when this skill loaded), and follow them. Its baseline script is `<skill-dir>/../handoff/scripts/baseline.sh`. Its rules on commits, ask-first items, and its rationalizations all apply here.

## 2. Record and tie up

No handoff note and no pointer to one. Put each finding where it lives for good: the project's own notes, docs or issue tracker when it has one, else memory; update the existing `project` memory entry to today's state. A held-back item with no yes still gets a durable home there.

Then tie up without asking:
- remove a worktree and its local branch once `git merge-base --is-ancestor <branch> <base>` confirms it is merged;
- cancel the watches, crons and wake-ups this session armed, after saving what they were for;
- read finished background output and save what it says. Stopping a job still running is ask-first; save what it wrote so far.

## 3. Report and stop

Arm the stop, unless **Needs your yes** holds a question or a job still running was held back (the stop would end it):

```bash
bash <skill-dir>/scripts/stop-self.sh
```

It stops a Claude Code background session once this turn ends, so the report below is saved first; elsewhere it does nothing. Then print the format below as your last message, and do nothing after it.

If the user answers the held-back question: act on each yes, update where the item was recorded, then arm the stop and reprint only what changed.

## Format

No audit recap and no step narration. Leave out a section with nothing in it.

```
**Saved**
- [action taken, with evidence: commit hash and subject, file path]

**Tied up**
- [what was cleaned up, and why each was stale]

**Still open**
- [item: where it is now recorded]

**Needs your yes**
[one question covering every held-back item, recommended choice first]

[one line: "Stopping this session." when the stop was armed; "Not stopping: <reason>." when it was held back; "The session can be closed." when it is not a background session]
```

## Rationalizations to refuse

| Thought | Answer |
|---|---|
| "No next session, so nothing to save" | Memory and the project's notes outlive this session. Run the audit anyway. |
| "I'll run `claude stop` myself, it's one command" | Inside the turn it kills the session before the report is saved. Use the script. |
| "The question can wait, I'll stop anyway" | A stopped session drops out of sight with the question in it. Hold the stop until the answer. |
