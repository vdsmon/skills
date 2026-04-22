---
name: pre-compact
description: Prepare a session for `/compact` by auditing pending state before context is truncated. Trigger whenever the user says "compact", "let's compact", "ready to compact?", "prep for compact", "suggest a compact message", "what should I put in /compact?", or any variant signalling they're about to run `/compact`. Audit uncommitted git changes, scratch files, in-flight workflow state, unfinished plans, running background tasks — flag anything that would be lost, propose concrete actions to persist it, then produce a copy-paste-ready focus message that lets the next session pick up cleanly. Use this proactively even when the user just asks whether compacting is OK.
---

# Pre-Compact

`/compact` drops conversation history and keeps only a short summary you provide. Anything not persisted outside chat — a half-written plan, an unsaved snippet pasted inline, the name of a background task — is gone. This skill runs a quick audit so that doesn't bite the next session.

## When to use

The description covers most phrases. In short: whenever the user is about to run `/compact` or is asking you whether they should. Don't wait for them to ask explicitly — if you see a natural break and they mention context feels full, or they ask "can we compact?", run this flow.

## The three steps

Always do these in order. Don't skip step 1 to get to the compact message — the whole point is to catch things that would be lost.

### 1. Assess: what's in flight?

Silently audit, then report a short structured summary. Check:

**Code state**
- `git status` in the primary working dir (and any worktree). Any unstaged/untracked files? Which ones matter (real work) vs. ignorable (temp/scratch)?
- Any files you edited this session that the user hasn't reviewed or that aren't committed?

**Workflow state**
- `.jira-workflow.json`, `.jira-workflow-plan.md`, or similar state files — do they reflect current progress?
- Mid-task skill invocations (jira-workflow, feature-dev, etc.) — is the next stage clearly derivable from the state file?
- TaskList — any in-progress tasks that will be orphaned? (TaskList is session-local; tasks won't survive compact.)

**Background work**
- Background Bash tasks running or recently completed whose output you haven't read.
- Scheduled crons or wake-ups the user should know about.

**Conversation-only knowledge**
- Decisions made verbally that aren't in any file: a chosen approach, a user preference, a debugging breakthrough. If it's not in code or a persisted note, it needs to go in the compact message.

Report this as a tight bulleted summary, not prose. Three to six bullets. Fewer if state is clean.

### 2. Raise: what needs action first?

For anything found in step 1 that *should* be persisted before compacting, propose the action. Don't do it silently — give the user a chance to say "skip it" or "do it first."

Typical actions:
- **Commit WIP** ("there are 12 modified files from Stage 5 refinements; I'd commit them as a WIP commit on the feature branch before compacting")
- **Update state file** ("plan file is current but `.jira-workflow.json` still shows stage=testing; advance to stage=quality first")
- **Write a note** ("the decision to use env-var fallback instead of populating SSM isn't in any file; I'll add a one-liner to the plan's Open Questions")
- **Capture background output** ("build task just completed; grab its exit status before compacting")

Order by blast radius — something that risks losing real work goes first.

If nothing needs action, say so plainly: "State is clean. Ready to compact." Then go to step 3.

### 3. Propose: the compact message

Produce a single code block with a focus message the user can paste into `/compact`. Aim for 3–6 sentences, optimized for the next session picking up cold.

A good compact message includes:

- **Where we are** — the workflow stage / ticket key / branch if applicable
- **What's done** — past stages, test counts, key milestones
- **What's next** — the literal next action on resume
- **Any gotchas** — open debugging threads, decisions made, things to skip or redo
- **Pointers to persisted state** — "plan at X, state file at Y, branch Z"

Keep it terse. The model reading this already has full file access — it doesn't need paragraphs of context, it needs the breadcrumbs to find the right files.

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

Don't narrate the three steps as sections titled "Step 1 / Step 2 / Step 3" — that's ceremony. Just the audit, the actions, and the message.

## Examples

**Example — workflow mid-stage, clean state:**

```
**Audit**
- FT-675 /jira-workflow, currently Stage 6 COMMITTING in_progress
- No uncommitted changes
- Plan + state file up to date
- No background tasks running

**Action needed**
- None — state is clean.

**Compact message:**
```text
Resume /jira-workflow Stage 6 COMMITTING for FT-675. Stages 3–5 done, plan + 50 passing unit+integration tests in libraries/delta_lib. 4 planned commits (hook hygiene / delta_lib / tasks+Dockerfile / DAG+variable). After commits: Gate 2 review, then Stage 7 push+PR to dev. Branch: feat/FT-675-delta-applier-12000-implementation. State: .jira-workflow.json; plan: .jira-workflow-plan.md.
```
```

**Example — uncommitted experimental changes:**

```
**Audit**
- FT-675, Stage 4 TESTING in_progress
- Modified: .env (AWS_PROFILE swap for E2E debug — not meant to ship)
- Modified: tasks/delta_applier.py (added env_vars injection — wanted)
- 50 delta_lib tests passing
- Stub K8s deployment in airflow-dev namespace (leave running for post-compact verification)

**Action needed**
- Revert .env AWS_PROFILE swap before compact — otherwise next session may commit it unknowingly. Run: `git checkout -- .env`.

**Compact message:**
```text
Resume /jira-workflow Stage 4 for FT-675. 50 delta_lib tests passing. Uncommitted: tasks/delta_applier.py env_vars injection (intentional, commit in Stage 6). A acme-data-api stub Deployment+Service is live in the airflow-dev k8s namespace for smoke-testing the DAG — keep it. E2E smoke still blocked on S3 ACCESS_DENIED from pod (creds, not code). Next: advance to Stage 5.
```
```

## Notes

- The compact message is *yours* to write — don't parrot what the user has said in-session. They compact because they trust you to preserve what matters.
- If the user explicitly says "just give me the compact message, skip the audit", honor that — they know what they're doing. Default is audit first.
- If state turns out to be genuinely chaotic (multiple unfinished threads, uncommitted half-implementations), say so and recommend *against* compacting until it's sorted. Losing one session's context is cheap; losing track of in-flight work is not.
