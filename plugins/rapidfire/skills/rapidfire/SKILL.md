---
name: rapidfire
description: >-
  Dispatcher pattern. User drops a one-line idea; you refine it in ≤3 narrow
  questions, write a ticket to `.rapidfire/T<NN>-<slug>.md`, then fire-and-forget
  dispatch to a background subagent. Model + agent_type auto-selected from a
  4-bucket complexity heuristic (trivial/moderate/complex/ambiguous). On later
  invocations, listens for `<task-notification>` blocks, updates ticket metadata,
  auto-dispatches queued tickets whose `depends_on` is satisfied.
when_to_use: >-
  Use when the user wants execution offloaded so they can keep ideating.
  Phrases: "act as dispatcher", "dispatch this idea", "delegate this", "queue
  this up", "throw this at an agent", "I have a bunch of ideas", "next idea:",
  "batch a bunch of tweaks". Also any /rapidfire subcommand while tickets exist
  in `.rapidfire/`. Trigger on bounded feature-requests ("make X configurable",
  "Y doesn't update when Z changes") AND tickets already exist in
  `.rapidfire/`. Skip one-shot inline tasks ("just fix this typo"), exploration
  ("where is X"), abstract design questions, and pre-spec'd multi-story epics
  with cross-cutting refactors (use `tasks:spec`).
argument-hint: "[<idea>] | status | show <id> | kill <id> | retry <id> | queue <idea> | commit [<ids>] | stats"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
  - Agent
  - TaskStop
  - ToolSearch
---

# rapidfire (dispatcher)

You = dispatcher. User drops ideas. You refine + dispatch. Background agents work. User keeps ideating.

## Prerequisites

- **`uv`** (≥0.10) in PATH — every helper script in `scripts/` uses PEP 723 inline deps via `#!/usr/bin/env -S uv run --quiet --script`. Without uv, the bootstrap silently skips and all later script steps fail at exec time.
- **`caveman` plugin** installed (provides `caveman:cavecrew-builder` subagent_type). Used by the `trivial` bucket. If unavailable, set `RAPIDFIRE_NO_CAVEMAN=1` in the environment — `dispatch-args.py` then routes trivial → `{general-purpose, sonnet}` instead.
- **`claude` CLI** in PATH — only needed for `scripts/optimize-description.py` (the optional description-tuning loop, not the dispatch flow).
- **`skill-creator` plugin** installed (`/plugin install skill-creator@claude-plugins-official`) — also only for `optimize-description.py`; it reuses skill-creator's `run_eval.py`.

## Subcommands

| Form | Action |
|---|---|
| `/rapidfire <idea>` | Refine + dispatch. |
| `/rapidfire queue <idea>` | Refine + write ticket, status=queued, skip dispatch. |
| `/rapidfire status` | Table of tickets. Calls `scripts/status.py`. |
| `/rapidfire stats` | Rollup metrics. Calls `scripts/status.py --stats`. |
| `/rapidfire show <id>` | Ticket file + diff. |
| `/rapidfire kill <id>` | Stop running agent for `<id>`. |
| `/rapidfire retry <id>` | Re-dispatch failed/killed ticket. Increments `attempt`, bypasses budget. |
| `/rapidfire commit [<ids>]` | Compose conventional commit from reported tickets. Preview + confirm. |

Empty args + no obvious subcommand → ask user for the idea.

## Helper scripts

Located at `${CLAUDE_SKILL_DIR}/../../scripts/` (i.e. `plugins/rapidfire/scripts/` relative to the plugin root). Each is a `uv` PEP 723 script (invoke directly, NOT via `python3` — that bypasses the shebang and the inline deps).

- `prewarm.py` — builds the shared uv venv once per session (run at bootstrap; cuts ~10s cold-start from later script invocations)
- `status.py` — table / `--stats` / `--ready` / `--json`
- `lint-spec.py <ticket>` — pre-dispatch spec-defect lint (exit 1 = block)
- `dispatch-args.py <ticket>` — emit Agent params as JSON (exit 1 = hard-rule violation)
- `migrate.py [<dir>]` — one-time backfill for pre-v2 tickets
- `optimize-description.py` — iterative `description:` tightening loop via `claude -p` (no API key needed). See `optimize-description.py --help`.

## Bootstrap (idempotent, every invocation)

```!
set -eu
mkdir -p .rapidfire
if [ -f .gitignore ] && ! grep -qxF '.rapidfire/' .gitignore; then
  echo '.rapidfire/' >> .gitignore
elif [ ! -f .gitignore ]; then
  echo '.rapidfire/' > .gitignore
fi
# Pre-warm the shared uv venv (built once, cached across script invocations).
# Skips cleanly if uv isn't available.
"${CLAUDE_SKILL_DIR}/../../scripts/prewarm.py" 2>/dev/null || true
ls .rapidfire/ 2>/dev/null || true
```

## Step 0 — Drain completion notifications

BEFORE any subcommand work, scan the current message for `<task-notification>` system-reminder blocks. Each `task-id` matches a ticket's `agent_id` frontmatter.

For each match:
1. Parse the agent's final report. The prompt template makes agents lead with `PASS:` or `FAIL:` on the first line — that's the deterministic signal. Extract: `git diff --stat` block, `files_touched` (from diff or report), `## Acceptance` row results, `## Notes / trade-offs` section (if present), `total_tokens` + `tool_uses` from `<usage>`.
2. Update ticket frontmatter: `status: reported` or `failed`; `finished_at`, `duration_ms`, `total_tokens`, `tool_uses`, `diff_stat`, `acceptance`, `agent_notes`, `files_touched`.
3. Surface one-line inline:
   ```
   🟢 T02 "popup auto-hide" done — agent rf-T02-popup-autohide. Run `/rapidfire show T02` for diff.
   ```
4. **Inline FAIL fix path**: if FAIL has obvious cause AND fix ≤5 lines AND single file, lead applies inline. See Validated patterns below.

After processing all notifications: run `"${CLAUDE_SKILL_DIR}/../../scripts/status.py" --ready`. Each ID printed = queued ticket whose deps are now satisfied. Auto-dispatch with `origin: dep-cascade` (bypasses budget).

## Workflow: new idea

### Step 1 — Read idea

`$ARGUMENTS` = the idea. Empty → ask.

### Step 2 — Refine (≤3 questions)

Use `AskUserQuestion`. ONLY ask what you can't infer. Bias toward dispatch.

Battery (pick ≤3): Scope · Files · Acceptance.

During refine, mentally bucket:

| Bucket | Signal |
|---|---|
| **trivial** | Pure string swap, typo, config value, no logic |
| **moderate** | Single-file restyle/refactor + compile verification |
| **complex** | Multi-file feature, novel pattern, design judgment |
| **ambiguous** | Anything else — bias UP (per user rule) |

**Scope-creep autobump**: if refine reveals >2 files, hard-bump to `complex`, warn user inline. No second question.

### Step 3 — Write ticket

Look at `.rapidfire/T*.md` to find next ID. Slug = first 3-5 words of title, kebab-case.

Write `.rapidfire/T<NN>-<slug>.md`:

```yaml
---
id: T<NN>
title: <one-line>
status: dispatched         # "queued" for /rapidfire queue
agent_type: caveman:cavecrew-builder | general-purpose
agent_name: rf-T<NN>-<slug>
model: haiku | sonnet | opus
bucket: trivial | moderate | complex | ambiguous
origin: user               # auto-set to supersede/retry/dep-cascade by automation
created_at: <ISO-8601 UTC>
depends_on: []
---

## Goal
<1-2 sentences>

## Files
- <path>

## Edits
<optional structured edits — lint-spec.py reads this section>

## Acceptance
- `<shell command>` exits 0 / prints `<expected>`

## Notes
<gotchas, anti-goals>
```

**Frontmatter is the source of truth.** No `.rapidfire/index.json` (v2 dropped it). `scripts/status.py` walks ticket files.

### Step 4 — Pre-dispatch lint (HARD GATE)

```
"${CLAUDE_SKILL_DIR}/../../scripts/lint-spec.py" .rapidfire/T<NN>-<slug>.md
```

- Exit 0 → continue.
- Exit 1 → script printed conflict on stderr. **Block dispatch.** Show findings, ask: amend or explicit override? Default = amend. Override requires the user explicitly saying "proceed" (no default-yes).

### Step 5 — Validate dispatch args

```
"${CLAUDE_SKILL_DIR}/../../scripts/dispatch-args.py" .rapidfire/T<NN>-<slug>.md
```

- Exit 0 + JSON on stdout → use as Agent params.
- Exit 1 → hard-rule violation (e.g. `haiku` + `general-purpose`). Amend frontmatter + re-run.
- Stderr warnings → surface inline; lead decides. (Common warning: cavecrew + heavy-shell-acceptance → those checks will SKIP. Override to `general-purpose` or accept skip.)

Matrix the script applies:

| Bucket | agent_type | model |
|---|---|---|
| trivial | caveman:cavecrew-builder | haiku |
| moderate | general-purpose | sonnet |
| complex | general-purpose | opus |
| ambiguous | general-purpose | opus |

### Step 6 — Dispatch

**Budget check** before calling `Agent`: count tickets with `status ∈ {dispatched, running}` AND `origin == user`. If count ≥ 6 AND new ticket's `origin == user` → refuse, point user at `/rapidfire status`. Rearrangement-origin tickets (`supersede`/`retry`/`dep-cascade`) bypass.

Then `Agent(<from JSON>, run_in_background: true)`. On return, append to ticket frontmatter: `agent_id`, `dispatched_at`.

### Step 7 — Report back

```
✅ T<NN> "<title>" dispatched as rf-T<NN>-<slug> (bucket: <bucket>, model: <model>). Drop next idea.
```

Prepend any Step 0 notifications.

## Other workflows

### show <id>

`cat .rapidfire/T<NN>-*.md`. If `files_touched` present, `git diff --stat <files>`.

### kill <id>

Read ticket's `agent_id`. Fetch `TaskStop` via `ToolSearch query="select:TaskStop"` if needed. Call `TaskStop(task_id=<agent_id>)`. Update frontmatter: `status: killed`, `finished_at: <now>`.

### retry <id>

Confirm `status ∈ {failed, killed}`. Increment `attempt`, set `origin: retry`, clear `finished_at`/`duration_ms`/`acceptance`. If prior failure summary available, append `## Retry notes` section. Run Steps 4–6 (bypasses budget).

### queue <idea>

Run Steps 1–5, write `status: queued` in Step 3, **skip Step 6**. Dispatch happens via Step 0 when deps satisfy.

### commit [<ids>]

Default `<ids>` = all tickets with `status: reported` AND no `committed_at` field. Compose conventional commit body from `title` + `diff_stat`. Preview, confirm, `git add` the union of `files_touched`, `git commit`. Set `committed_at` on each included ticket.

## Validated patterns

### Auto-supersede (4 steps)

New idea overlaps with `status: dispatched` ticket's `## Files` AND user intent contradicts the in-flight design:

1. Detect during Step 2 refine.
2. `TaskStop(task_id=<old ticket's agent_id>)`.
3. Update old ticket: `status: killed`, `superseded_by: T<new>`, `finished_at: <now>`.
4. Write new ticket: `supersedes: T<old>`, `origin: supersede`. Dispatch (bypasses budget).

### Inline FAIL fix (lead applies directly)

Conditions: failure root cause obvious AND ≤5 lines AND single file.

1. Apply repair inline via Edit.
2. Inherit metadata from the original failed dispatch BEFORE overwriting status: keep `agent_id`, `dispatched_at`, `total_tokens`, `tool_uses`. Set `finished_at` to repair time. Update `files_touched` and `diff_stat` to reflect the combined original+repair work. Preserve `agent_notes` (often explains the failure).
3. Set `status: reported`, `attempt: 2`, `recovered: inline`.
4. Append `## Lead repair` section with the lead's diff.

Anything bigger → `/rapidfire retry <id>`.

## Anti-patterns

- Asking >3 refine questions — user is in flow.
- Refining AND executing inline. The whole point is delegation.
- Ignoring `lint-spec.py` exit 1 without explicit user "proceed".
- Counting rearrangement-origin tickets (supersede/retry/dep-cascade) against the budget.
- Writing to a `.rapidfire/index.json` — v2 removed it.
- Committing on user's behalf during dispatch. Subagent reports; lead commits via `/rapidfire commit`.
