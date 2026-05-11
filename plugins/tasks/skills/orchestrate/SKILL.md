---
name: orchestrate
description: >-
  Orchestrate phase of the tasks plugin. Reads `tasks/T*.md` frontmatter,
  builds the dependency DAG, computes parallel-safe batches via
  file-overlap analysis, dispatches stories to subagents per `agent_type`
  (cavecrew-builder, general-purpose, orchestrator-direct), runs acceptance,
  flips status, commits. Loops until ready set is empty. Honors `## Human
  handoff` sections by handling those stories directly without subagent
  dispatch.
when_to_use: >-
  Use when the user says "/tasks:orchestrate", "dispatch the backlog",
  "run the ready set", "ship the epic", "pick up where we left off", or
  asks to execute already-spec'd tasks. Also triggers on "what's next"
  when `tasks/T*.md` files exist with pending status and satisfied
  dependencies. Skip when no `tasks/T*.md` files exist or when every
  story is `done`/`wontfix`/`blocked`.
argument-hint: "[--epic E<NN> | --task T<NN> | --ready | --dry-run]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Bash(find *)
  - Bash(grep *)
  - Bash(jq *)
  - Bash(git *)
  - Bash(gh *)
  - Bash(prek run *)
  - Bash(mise run *)
  - Bash(uv run *)
  - Bash(actionlint *)
  - Bash(shellcheck *)
  - Bash(yamllint *)
---

# tasks:orchestrate

Dispatch phase. Reads tasks/, builds DAG, parallel-dispatches batches, runs acceptance, commits. Loops until ready set is empty.

## Invocation

```
/tasks:orchestrate [--epic E<NN>] [--task T<NN>] [--ready] [--dry-run]
```

Examples:
- `/tasks:orchestrate` — process every ready story until exhausted
- `/tasks:orchestrate --epic E01` — scope to one epic
- `/tasks:orchestrate --task T28` — dispatch a single story
- `/tasks:orchestrate --ready` — list ready set + DAG, then ask before dispatching
- `/tasks:orchestrate --dry-run` — show batches that WOULD dispatch, write nothing, dispatch nothing

## Bootstrap

```!
set -eu
SRC="${CLAUDE_SKILL_DIR}/../../templates"
if [ ! -d "$SRC" ]; then
  echo "ERROR: plugin templates missing at $SRC" >&2
  exit 1
fi
if [ ! -d "tasks/_templates" ]; then
  mkdir -p tasks/_templates tasks/epics
  cp "$SRC/EPIC.md" tasks/_templates/EPIC.md
  cp "$SRC/STORY.md" tasks/_templates/STORY.md
  cp "$SRC/README.md" tasks/_templates/README.md
  echo "bootstrapped tasks/_templates/ from plugin defaults"
fi
ls tasks/T*.md 2>/dev/null | wc -l | tr -d ' '
```

If zero `tasks/T*.md` files exist, report "no stories to orchestrate; run /tasks:spec first" and stop.

## Workflow

### 1. Read frontmatter

For every `tasks/T*.md`, parse the YAML frontmatter. Capture: `id`, `status`, `depends_on`, `epic`, `agent_type`, `priority`, plus the story's `## Files` section paths and the presence/content of `## Human handoff`.

### 2. Compute ready set

A story is ready iff:

- `status == pending`
- Every entry in `depends_on` references a story whose `status` is `done` OR `wontfix`

Filter by `--epic` / `--task` if specified.

### 3. Compute parallel-safe batches

Greedy batching over the ready set:

- Build a set of "touched paths" per story from its `## Files` section.
- Mark append-only paths explicitly: `mise.toml`, `*.github/workflows/*.yml` (when both stories edit the same file), `README.md`, `AGENT_GUIDE.md`, `project.godot`, `tests/scenarios/SCHEMA.md`, and any shared docs. Two stories appending to the same file → serialize.
- Stories with NO path overlap can batch together.
- Cap batch size at 3–4 to bound parent verification cost.

Print the batch plan:

```
Batch 1 (parallel): T28, T30, T31
Batch 2 (serial after Batch 1): T29 (touches mise.toml — shared)
Batch 3 (serial after T31): T32 (depends on T31)
```

If `--dry-run`, stop here.

### 4. Dispatch by agent_type

Refuse-at-dispatch checks (apply before constructing any prompt):

- `cavecrew-builder` + 3 or more entries in `## Files` → halt. Either split the story or rewrite frontmatter to `general-purpose`. Surface to user; do not dispatch.
- `agent_type: orchestrator-direct` reaching a subagent path → bug; halt.
- Story lacks any `## Acceptance` items → refuse; spec violation.

For each story in the current batch:

- **`cavecrew-builder`**: subagent has only Read/Edit/Write/Grep/Glob (no Bash). Prompt: edit files only, leave `status: pending`, return. Parent runs `## Acceptance` commands, on pass flips status to `done` + commits with subject `T<NN>: <slug>`. On fail: revert agent's edits via `git checkout -- <files>`, append a `## Retry notes` section.
- **`general-purpose`**: subagent has full toolset, self-commits on success. Parent re-verifies `## Acceptance` independently (don't trust agent's self-report alone). On any divergence: revert agent's commit (`git revert <sha>` or `git reset --hard HEAD~1` if not yet pushed), append `## Retry notes`.
- **`orchestrator-direct`**: NO subagent. Parent handles inline. Read the `## Human handoff` section, prompt the user step-by-step, run non-interactive shell follow-ups (`gh secret set`, etc.), verify acceptance. Then flip status + commit.

Constructing subagent prompts. The prompt body MUST be assembled by:

1. Reading the story file.
2. Excising the entire `## Human handoff` section (heading + body, through to the next `## ` or EOF). Defense-in-depth — `cavecrew-builder` and `general-purpose` stories should never carry one, but strip unconditionally.
3. Stripping `## Blocker` and `## Retry notes` from previous attempts unless the agent's prompt needs the retry context — in that case quote only the latest entry.
4. Prepending the per-agent contract message:
   - `cavecrew-builder`: "Leave frontmatter as `pending`. Do NOT commit. Parent handles acceptance + commit. Edit only files listed in `## Files`."
   - `general-purpose`: "Run every `## Acceptance` command. On pass, flip status to `done` + commit with subject `T<NN>: <slug>`. Parent re-verifies; do not lie about acceptance results."

For parallel dispatch, send all agents in a single message with multiple Agent tool calls. Hard cap: 4 concurrent dispatches.

### 5. Verify + commit per story

After each story's subagent returns (or after orchestrator-direct handling completes):

- Re-run every `## Acceptance` command from the parent. Parent's run is the truth — never flip status off subagent self-report.
- Also run the project's standard linter/type-checker set on touched files (e.g. `ty`, `ruff`, `shellcheck`, `actionlint`, `yamllint` — whichever apply). Subagents often miss linters they don't know about. This is parent-side belt-and-braces, not part of `## Acceptance`.
- If any acceptance fails: revert (commit + working tree), append `## Retry notes` section with the failing command + output excerpt, mark status back to `pending`. Story re-enters the ready set on the next batch.
- If acceptance passes AND the agent didn't already commit: write `status: done`, commit.
- If acceptance passes AND the agent already committed: verify commit SHA exists, status is already `done`.

### 6. Loop

After each batch:

- Refresh the ready set (newly-done stories may unblock downstream).
- Compute the next batch.
- Stop when ready set is empty.

### 7. Final summary

```
## Orchestration summary

Stories shipped: T<NN>, T<NN>, ...
Stories blocked: T<NN> (see ## Blocker)
Stories retried: T<NN> (passed after N retries)
Commits: <SHA-list>
Working tree: clean | <state>
```

## Dispatch rules

- **File-overlap detection is strict**. If two stories list any same path in `## Files`, serialize them. Don't rely on git to merge — concurrent agents will commit conflicting deltas.
- **Append-only files force serial dispatch**. `mise.toml`, `project.godot` `[autoload]`, GitHub workflow files (when both stories edit the same workflow), shared markdown docs (`README.md`, `AGENT_GUIDE.md`, `ASSETS.md`) — every story that appends to these gets its own slot.
- **Batch size capped at 3–4**. More parallelism means more parent-verification cost + higher chance of subtle conflicts. Lean conservative.
- **Retry budget per story = 3**. After 3 retries, mark the story `blocked` with a `## Retry notes` summary of all attempts. Do NOT loop forever.
- **Honor `priority: high`**. High-priority stories dispatch first within the ready set (de-risk-first). Tiebreak: earliest ID.

## Abort conditions

- User interrupts via signal or hook.
- A story moves to `blocked` AND no other stories in the ready set can proceed → halt, report.
- A `## Acceptance` command exits with code that suggests environment failure (e.g. `gh: command not found`) → halt the batch, surface to user. Don't retry environment errors.

## Pre-flight (run once at invocation, before batching)

- Git working tree clean (`git status --porcelain` empty). If not, ask user to commit or stash before orchestrating — concurrent agents on a dirty tree leak state.
- `tasks/` directory exists and contains at least one `T*.md`.
- `tasks/_templates/` exists (bootstrap if missing — see Bootstrap section above).
- For epics-scoped runs (`--epic E<NN>`): epic file `tasks/epics/E<NN>-*.md` exists.

## Constraints

- NEVER flip a story's status without verifying its `## Acceptance` from the parent.
- NEVER dispatch a story whose `agent_type` is `orchestrator-direct` to a subagent.
- NEVER include `## Human handoff` content in a subagent prompt.
- NEVER allow a single batch to commit more than 4 stories in parallel.
- NEVER retry a story more than 3 times — mark `blocked` after the third failure.
- ALWAYS commit per-story (one commit per story), not per-batch. Cleaner revert path.
- ALWAYS preserve `## Notes`, `## Blocker`, `## Retry notes` sections when editing the story file — append, don't overwrite.

## Anti-patterns

- Batching by agent_type instead of by file-overlap — leads to "all cavecrew tasks in batch 1" which collides on shared files like `mise.toml`.
- Two stories appending to `mise.toml` in the same batch — the appended blocks land out of order and one overwrites the other. Serialize.
- Trusting a `general-purpose` subagent's self-reported "all acceptance passed" without re-running — agents accept their own bugs because they're inside the bubble.
- Skipping parent-side linter run after subagent returns — subagents don't always know about every linter (`ty`, project-specific checks); diagnostics slip through.
- Letting a watch-loop story (CI run, iterative push) keep retrying past its documented iteration ceiling — read `## Notes` for the ceiling, enforce it externally.
- Skipping the pre-flight check on git working tree — concurrent subagents on a dirty tree corrupt state.
- Dispatching `cavecrew-builder` for 3+ files — agent refuses. Halt at dispatch, surface to user.
