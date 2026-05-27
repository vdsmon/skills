---
name: rapidfire
description: >-
  Dispatcher pattern. User drops a one-line idea; you refine (≤3 questions
  default; extend to 4-6 when the bucket lands on complex or design
  judgment is needed), write a ticket to `.rapidfire/T<NN>-<slug>.md`, then
  fire-and-forget dispatch to a background subagent. Model + agent_type
  auto-selected from a 4-bucket complexity heuristic
  (trivial/moderate/complex/ambiguous). Listens for `<task-notification>`
  blocks, updates ticket metadata, auto-dispatches queued tickets whose
  `depends_on` is satisfied. Use when the user wants execution offloaded so
  they can keep ideating — phrases like "dispatch this", "delegate this",
  "queue this up", "throw this at an agent", "next idea:", "batch a bunch of
  tweaks", or any `/rapidfire` subcommand while tickets exist in
  `.rapidfire/`. Skip one-shot inline fixes, exploration, abstract design,
  and pre-spec'd multi-story epics (use `tasks:spec`).
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
argument-hint: "[<idea>] | status | show <id> | kill <id> | retry <id> | queue <idea> | commit [<ids>] | stats | help"
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

- **`uv`** (≥0.10) in PATH — every helper script in `scripts/` uses PEP 723 inline deps via `#!/usr/bin/env -S uv run --quiet --script`. The bootstrap below hard-fails with an install hint if `uv` is missing.
- **`caveman` plugin** installed (provides `caveman:cavecrew-builder` subagent_type). Used by the `trivial` bucket. If unavailable, set `RAPIDFIRE_NO_CAVEMAN=1` in the environment — `dispatch-args.py` then routes trivial → `{general-purpose, sonnet}`.
- **`skill-creator` plugin** installed (`/plugin install skill-creator@claude-plugins-official`) — only for `optimize-description.py`; it reuses skill-creator's `run_eval.py`.

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
| `/rapidfire help` | Print the subcommand table. |

Empty args + no obvious subcommand → ask user for the idea.

## Helper scripts

Located at `${CLAUDE_SKILL_DIR}/../../scripts/`. Each is a `uv` PEP 723 script (invoke directly, NOT via `python3` — that bypasses the shebang and the inline deps).

- `prewarm.py` — builds the shared uv venv once per session (run at bootstrap; cuts ~10s cold-start from later script invocations)
- `status.py` — table / `--stats` / `--ready` / `--json`
- `lint-spec.py <ticket>` — pre-dispatch spec-defect lint (exit 1 = block)
- `dispatch-args.py <ticket>` — emit Agent params as JSON (exit 1 = hard-rule violation)
- `optimize-description.py` — iterative `description:` tightening loop via `claude -p`. See `optimize-description.py --help`.

## Bootstrap (idempotent, every invocation)

```!
set -eu
if ! command -v uv >/dev/null 2>&1; then
  echo "rapidfire requires uv. Install: brew install uv  (or: curl -LsSf https://astral.sh/uv/install.sh | sh)" >&2
  exit 1
fi
mkdir -p .rapidfire
if [ -f .gitignore ] && ! grep -qxF '.rapidfire/' .gitignore; then
  echo '.rapidfire/' >> .gitignore
elif [ ! -f .gitignore ]; then
  echo '.rapidfire/' > .gitignore
fi
"${CLAUDE_SKILL_DIR}/../../scripts/prewarm.py" || true
ls .rapidfire/ 2>/dev/null || true
```

## Step 0 — Process incoming notifications

BEFORE any subcommand work, scan the current message for `<task-notification>` system-reminder blocks. Each `task-id` matches a ticket's `agent_id` frontmatter.

For each match:
1. Parse the agent's final report. The prompt template makes agents lead with `PASS:` or `FAIL:` on the first line — that's the deterministic signal. Extract: `git diff --stat` block, `files_touched` (from diff or report), `## Acceptance` row results, `## Notes / trade-offs` section (if present), `total_tokens` + `tool_uses` from `<usage>`.
2. Update ticket frontmatter: `status: reported` or `failed`; `finished_at`, `duration_ms`, `total_tokens`, `tool_uses`, `diff_stat`, `acceptance`, `agent_notes`, `files_touched`.
3. Surface one-line inline:
   ```
   🟢 T02 "popup auto-hide" done — agent rf-T02-popup-autohide. Run `/rapidfire show T02` for diff.
   ```
4. **Inline FAIL fix path**: if FAIL has obvious cause AND fix ≤5 lines AND single file, lead applies inline. See `references/inline-fail-fix.md`.

After processing all notifications: run `"${CLAUDE_SKILL_DIR}/../../scripts/status.py" --ready`. Each ID printed = queued ticket whose deps are now satisfied. Auto-dispatch with `origin: dep-cascade` (bypasses budget).

## Workflow: new idea

### Step 1 — Read idea

`$ARGUMENTS` = the idea. Empty → ask.

### Step 2 — Refine

Use `AskUserQuestion`. ONLY ask what you can't infer. Bias toward dispatch.

**Question budget is adaptive, not fixed.** Default cap is 3 questions (trivial/moderate land here — user is in flow, don't drag it out). When the idea is large enough that the bucket is heading toward `complex` or `ambiguous`, extend the interview to 4-6 questions and cover novel design decisions, integration points, and edge cases that the subagent can't infer from the ticket alone. Tell the user inline when you extend ("This is complex-shaped — I'm going to ask a few more questions before dispatching"). Don't apologize for it; a well-spec'd complex ticket beats a thrashing one.

Battery to pull from: Scope · Files · Acceptance · Design constraints · Failure modes · Integration points · Non-goals.

If the user references a prior ticket as a prerequisite ("after T03 lands", "depends on T05"), populate `depends_on: [T<id>]` and set `status: queued`. Step 0's `--ready` check auto-dispatches when those deps clear.

During refine, mentally bucket:

| Bucket | Signal | Default questions |
|---|---|---|
| **trivial** | Pure string swap, typo, config value, no logic | 0-2 |
| **moderate** | Single-file restyle/refactor + compile verification | 2-3 |
| **complex** | Multi-file feature, novel pattern, design judgment | 4-6 |
| **ambiguous** | Anything else — bias UP (per user rule) | 4-6 |

**Scope-creep autobump**: if refine reveals >2 files mid-flow, hard-bump to `complex` and switch to the extended-question budget. Warn user inline.

### Step 3 — Write ticket

Shape + frontmatter spec: `references/ticket-shape.md`.

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

Routing matrix lives in `scripts/dispatch-args.py:MATRIX` (single source of truth). Hard rule: never `haiku + general-purpose`.

**Trivial + verification needed**: the trivial bucket routes to `cavecrew-builder`, which has no Bash. If `## Acceptance` runs anything beyond `grep`/`ls`/`wc`/`cat`/`head`/`tail`, those checks SKIP at run time (the script warns). For real verification on a trivial-shape ticket, override `agent_type: general-purpose` + bump `model: sonnet` in the ticket frontmatter before this step.

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

### help

Print the Subcommands table verbatim. Append one line: "Empty args → asks for idea. Step 0 (notification scan + auto-dispatch of `--ready` queued tickets) runs before any subcommand."

### commit [<ids>]

Default `<ids>` = all tickets with `status: reported` AND no `committed_at` field. Compose conventional commit body from `title` + `diff_stat`. Preview, confirm, `git add` the union of `files_touched`, `git commit`. Set `committed_at` on each included ticket.

## Validated patterns

- **Auto-supersede** (new idea contradicts an in-flight ticket): see `references/auto-supersede.md`.
- **Inline FAIL fix** (lead repairs a small failure instead of retrying): see `references/inline-fail-fix.md`.

## Anti-patterns

- Padding refine with questions you could infer from context. Adaptive budget is permission to extend on complex scope, not license to interrogate.
- Refining AND executing inline. The whole point is delegation.
- Ignoring `lint-spec.py` exit 1 without explicit user "proceed".
- Counting rearrangement-origin tickets (supersede/retry/dep-cascade) against the budget.
- Committing on user's behalf during dispatch. Subagent reports; lead commits via `/rapidfire commit`.
