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

Greedy batching over the ready set. Algorithm:

1. Order the ready set by priority rule (see Dispatch rules) → ordered list `L`.
2. Initialize `batch = []`, `batch_paths = {}` (path → "edit" | "append").
3. For each story `s` in `L`:
   - Build `s.paths` from its `## Files` section. Each entry classified as `edit` (Create / Edit) or `append` (Append).
   - Collision iff any path `p` in `s.paths` is in `batch_paths` AND either side is `append` OR both sides are `edit` on the same path. (Append-vs-anything on the same file = collision; edit-vs-edit on the same file = collision; non-overlapping paths = no collision.)
   - If no collision: add `s` to `batch`, merge `s.paths` into `batch_paths`. Else: defer `s` to a later batch.
4. Stop adding when `|batch| == 4` (hard cap; lean conservative at 3).
5. Emit `batch`. Remaining stories form the next batch's input on the next loop iteration.

Append-only surfaces in this repo include: `mise.toml`, GitHub workflow files (`.github/workflows/*.yml`), shared docs (`README.md`, `AGENT_GUIDE.md`, `ASSETS.md`), `project.godot`, `tests/scenarios/SCHEMA.md`. Any file the project treats as append-only counts; the rule is structural, not a fixed list.

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
- **`orchestrator-direct`**: NO subagent. Parent handles inline. Read the `## Human handoff` section, prompt the user step-by-step, verify acceptance via side effect, flip status + commit.

  **Secret-handling default** (when the story handles a secret — OAuth token, API key, signing key, password):
  1. NEVER ask the user to paste the secret into the conversation — the transcript is logged and may be persisted across sessions.
  2. Default to: send the user the exact non-interactive command they can run themselves on their machine. Example for `gh secret set CLAUDE_CODE_OAUTH_TOKEN`: send `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <owner/name>` — gh prompts `? Paste your secret:` interactively (Ctrl-D to finish), so the secret never reaches argv, env, history, or transcript.
  3. Verify acceptance via the side effect (e.g. `gh secret list --json name,updatedAt`) — never via the secret value itself.
  4. If the user explicitly chooses to paste the secret to chat anyway: pipe via stdin (`gh secret set NAME --body -` with the value piped from `printf '%s' "$VAR"`) so it stays out of argv / `ps` listing. Note: it will still be in the transcript — the user accepts that trade-off.

Constructing subagent prompts. Use the helper script — do NOT hand-stitch:

```
PROMPT=$(bash "${CLAUDE_SKILL_DIR}/../../scripts/build-dispatch-prompt.sh" \
          tasks/T<NN>-<slug>.md <agent-type> [--retry])
```

The script:

1. Reads the story file.
2. Excises `## Human handoff`, `## Blocker`, and `## Retry notes` sections (H2-or-EOF boundary — `### Candidate X` and other deeper headings inside the section don't end the excision). Defense-in-depth — `cavecrew-builder` and `general-purpose` stories should never carry a handoff, but strip unconditionally.
3. With `--retry`: re-injects ONLY the LATEST entry from `## Retry notes` (the last `### ` subheading block) inline in the contract message. The skill needs prior-retry context but not the whole accumulated section.
4. Prepends the per-agent contract message:
   - `cavecrew-builder`: "Leave frontmatter as `pending`. Do NOT commit. Parent handles acceptance + commit. Edit only files listed in `## Files`."
   - `general-purpose`: "Run every `## Acceptance` command. On pass, flip frontmatter `status: pending` → `status: done` + commit with subject `T<NN>: <slug>`. Parent re-verifies; do not lie about acceptance results."

Pass the script's stdout as the `prompt` argument to the Agent tool call. Hand-stitching the prompt is an anti-pattern: H2-boundary detection errors and stale Blocker/Retry leakage are recurrent failure modes that the script eliminates.

For parallel dispatch, send all agents in a single message with multiple Agent tool calls. Hard cap: 4 concurrent dispatches.

### 5. Verify + commit per story

**Continuity rule.** From `acceptance passes` to `status flip + commit + next-batch dispatch` is ONE uninterrupted flow. Do not pause for user input or end the response between these steps. A pause invites: session-resume state drift (parent re-runs acceptance because the in-context state isn't trusted), duplicate work, and forgotten post-acceptance side effects. Surface to user only at: batch boundary (after the next batch is dispatched), blocker, abort condition, or final summary.

After each story's subagent returns (or after orchestrator-direct handling completes):

- Re-run every `## Acceptance` command from the parent. Parent's run is the truth — never flip status off subagent self-report.
- Also run the project's standard linter/type-checker set on touched files (e.g. `ty`, `ruff`, `shellcheck`, `actionlint`, `yamllint` — whichever apply). Subagents often miss linters they don't know about. This is parent-side belt-and-braces, not part of `## Acceptance`.
- If any acceptance fails: revert (commit + working tree), append `## Retry notes` section with the failing command + output excerpt, mark status back to `pending`. Story re-enters the ready set on the next batch.
- If acceptance passes AND the agent didn't already commit: write `status: done`, commit.
- If acceptance passes AND the agent already committed: verify commit SHA exists, status is already `done`.
- When parent finishes a story INLINE (subagent halted, or no subagent work remained after spec amendment, or `orchestrator-direct` from the start): before flipping status, re-read the story's `## Notes` for post-acceptance side effects (issue close, branch delete, audit-trail comment, test-data cleanup). The subagent's order-of-ops covers these in normal flow; parent must cover them manually for inline completion. Common surfaces: GitHub issues opened by the story, test data on external services, temporary branches.

### 5b. Spec amendment path

Sometimes acceptance fails because the spec was wrong, not the implementation: the workflow / code is verifiably correct, but the `## Acceptance` check assumed something about an external system that turned out to be untrue (a bot's login name, an error message's exact wording, a CLI tool's exit code shape). The subagent correctly flips to `blocked` per the "do not lie about acceptance" contract — escalate this class to the user, do not silently relax the check.

Protocol when parent diagnosis confirms wrong-by-spec:

1. Surface to user: `actual <thing observed>` vs `spec wants <thing assumed>`, plus *why* they don't match (link to upstream docs / FAQ if available). Recommend the minimal spec amendment.
2. Wait for explicit user OK to amend the spec. Do NOT unilaterally edit acceptance.
3. Edit the story's `## Acceptance` section to match observed reality (e.g. broaden a jq filter, accept multiple identities via `test("^(a|b)$")`, etc.).
4. Convert any `## Blocker` section documenting the issue into `## Retry notes` (preserve the content, retitle the heading) — Blocker is for terminal failures; the issue was resolved by amendment.
5. Flip frontmatter `status: blocked` → `status: done`.
6. Re-run the AMENDED acceptance commands inline from the parent. Skip subagent re-dispatch — no subagent work remains.
7. Commit with the standard `T<NN>: <slug>` subject.

If wrong-by-spec is recurrent across an epic: flag the spec quality to the user; the `tasks:spec` stage produced rigid acceptance checks tied to unverified external-system assumptions.

### 6. Loop

After each batch:

- Refresh the ready set (newly-done stories may unblock downstream).
- Compute the next batch.
- Stop when ready set is empty.

### 7. Final summary

Before printing the summary, refresh the project's tasks dashboard if the project ships a regenerator:

```bash
if [ -x tools/regen-dashboard.sh ]; then
  tools/regen-dashboard.sh
  if ! git diff --quiet tasks/DASHBOARD.md 2>/dev/null; then
    git add tasks/DASHBOARD.md
    git commit -m "tasks: dashboard refresh"
  fi
fi
```

The dashboard reflects all status flips landed this run. If the project doesn't ship `tools/regen-dashboard.sh`, skip silently — not every project uses one. (See `tasks/_templates/regen-dashboard.sh` in the plugin for a reference implementation that parses `tasks/T*.md` frontmatter into a tree-style status view.)

```
## Orchestration summary

Stories shipped: T<NN>, T<NN>, ...
Stories blocked: T<NN> (see ## Blocker)
Stories retried: T<NN> (passed after N retries)
Commits: <SHA-list>
Working tree: clean | <state>
Dashboard: tasks/DASHBOARD.md (refreshed | not present)
```

## Dispatch rules

- **File-overlap detection is strict**. If two stories list any same path in `## Files`, serialize them. Don't rely on git to merge — concurrent agents will commit conflicting deltas.
- **Append-only files force serial dispatch**. `mise.toml`, `project.godot` `[autoload]`, GitHub workflow files (when both stories edit the same workflow), shared markdown docs (`README.md`, `AGENT_GUIDE.md`, `ASSETS.md`) — every story that appends to these gets its own slot.
- **Batch size capped at 3–4**. More parallelism means more parent-verification cost + higher chance of subtle conflicts. Lean conservative.
- **Retry budget per story = 3**. After 3 retries, mark the story `blocked` with a `## Retry notes` summary of all attempts. Do NOT loop forever.
- **Honor `priority: high`**. Within a single epic's ready set, high-priority stories dispatch first (de-risk-first). Tiebreak: earliest ID. Across epics, priority is incomparable — order by epic ID then story ID.
- **Local-only status-flip commits piggyback on the next push**. Some stories (CI watch-loop stories with "do not push status-flip commits" in `## Notes`) intentionally produce a local-only `T<NN>: <slug>` commit after their pushed green-CI commit. These accumulate locally and ride the next dispatched fix-push (or final user-initiated push). Working as intended; mention as `[unpushed]` in the final summary so the user can `git push` when ready.

## Abort conditions

- User interrupts via signal or hook.
- A story moves to `blocked` AND no other stories in the ready set can proceed → halt, report.
- A `## Acceptance` command exits with code that suggests environment failure (e.g. `gh: command not found`) → halt the batch, surface to user. Don't retry environment errors.

## Pre-flight (run once at invocation, before batching)

- Git working tree clean (`git status --porcelain` empty). If not, ask user to commit or stash before orchestrating — concurrent agents on a dirty tree leak state.
- `tasks/` directory exists and contains at least one `T*.md`.
- `tasks/_templates/` exists (bootstrap if missing — see Bootstrap section above).
- For epics-scoped runs (`--epic E<NN>`): epic file `tasks/epics/E<NN>-*.md` exists.
- **Per-story external-service tooling check.** For each story in the immediate ready set, scan its `## Acceptance` and `## Notes` for external-service tooling (`gh`, `gcloud`, `aws`, `npm publish`, `cargo publish`, `kubectl`, `docker push`, etc.). Verify auth + required scopes BEFORE constructing the dispatch prompt. Common gotchas:
  - `gh` push to a repo containing `.github/workflows/*` requires `workflow` scope (`gh auth status` → token scopes).
  - `gh secret set` requires `repo` scope.
  - `npm publish` requires `npm whoami` to succeed against the target registry.
  A wasted dispatch can leave irreversible side effects on the remote service (e.g. GitHub repo created on github.com, npm version published, cloud resource provisioned). Pre-flight catches it before the dispatch.

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
- Running `actionlint` against composite-action files (`.github/actions/<name>/action.yml`) — actionlint validates the *workflow* schema and will flag composite-action keys (`description`, `inputs`, `outputs`, `runs`) as unexpected. Use `prek run --files <action.yml>` (yamllint via pre-commit) for composite actions. Reserve `actionlint` for `.github/workflows/*.yml`.
