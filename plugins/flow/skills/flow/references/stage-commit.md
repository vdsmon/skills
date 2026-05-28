# Stage: commit

## Purpose

Compose a conventional commit, apply the recorded implement-stage diff, and
transition the tracker ticket. Bare workspace default.

The commit message header is deterministic (built by `compose_commit.py`);
the body is filled in by the main agent based on the implement-stage
context. The applied patch comes from the recorded `implement.diff` — NOT
from `git add .` — so unrelated edits in the working tree are NOT included.

## Inputs

- `<ticket-dir>/baseline.json` — written by implement-stage's pre-handler
  `record-baseline` hook.
- `<ticket-dir>/implement.diff` — the captured implement-stage diff (binary
  + raw).
- `.flow/tickets/<KEY>.md` — ticket frontmatter (needs
  `commit_message` field per `lint_ticket` HARD GATE).
- Current working tree.

## Steps

1. HARD GATE: validate ticket frontmatter has `commit_message`:
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/lint_ticket.py \
     --stage commit \
     --ticket-path .flow/tickets/<KEY>.md
   ```
   - Exit 0 → continue.
   - Exit 1 → frontmatter missing required field. Surface stderr; ask user
     to populate `commit_message` in `.flow/tickets/<KEY>.md` then rerun.
     Abort with status=failed.

2. Capture the implement-stage diff (idempotent if already captured):
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/diff_extract.py capture-implement-diff \
     --ticket <KEY> \
     --ticket-dir <ticket-dir> \
     --cwd .
   ```
   - Exit 0 → `<ticket-dir>/implement.diff` exists.
   - Exit 1 → no baseline. Abort; surface `/flow recover --reset-baseline`
     hint.
   - Exit 2 → git error. Abort.

3. Compose the commit skeleton. Read `commit_type` + `commit_summary` from
   the ticket frontmatter (or ask the user if missing):
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/compose_commit.py \
     --ticket <KEY> \
     --type <feat|fix|chore|...> \
     --summary "<short summary>" \
     [--scope <scope>] \
     [--files <comma-list-from-baseline.planned_files>] \
     > /tmp/flow-commit-<KEY>.txt
   ```
   - Exit 0 → commit skeleton at `/tmp/flow-commit-<KEY>.txt`.
   - Exit 1 → invalid type or missing args. Abort.

4. Fill in the body. Read the skeleton, append a body section describing
   *why* (not what — the diff shows what). Reference any failing-tests-now-
   green progress from implement stage. Write the completed message back to
   the same path.

5. Apply the recorded patch:
   ```bash
   git apply --cached --binary <ticket-dir>/implement.diff
   ```
   If apply fails:
   - The working tree drifted from the baseline. Surface the error.
   - Abort with status=failed; `/flow recover --reapply-implement` (phase 8c).

6. Commit:
   ```bash
   git commit -F /tmp/flow-commit-<KEY>.txt
   ```

7. Transition the tracker ticket:
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/tracker_cli.py \
     --workspace-root . \
     transition --key <KEY> --to-state in_review
   ```
   - Exit 0 → continue. Stage completes.
   - Exit 1 → tracker error. Commit is already made; surface the error and
     continue (stage completes with a warning logged, not status=failed —
     the diff is in git, the ticket transition is best-effort).
   - Exit 3 → no such transition (workflow doesn't support `in_review`).
     Try `--to-state done` as fallback; if also unavailable, surface and
     continue.

## Outputs

- A git commit on the current branch.
- `.flow/tickets/<KEY>.md` — frontmatter stays unchanged (status mutation
  belongs to ticket / reflect stages, not commit).

## Errors

- `lint_ticket.py` exit 1 → user must populate frontmatter.
- `git apply --cached` fail → working tree drift. `/flow recover` in 8c.
- `tracker_cli.py transition` exit 1 → log warning, do not block. The
  commit is the source of truth.

## Skip conditions

- Skipped entirely if `workspace.toml [pipeline.handlers] commit = "none"`.
  (Bare workspace never sets this; rare configuration.)
