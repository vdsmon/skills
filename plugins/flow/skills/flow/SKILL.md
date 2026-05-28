---
name: flow
description: Multi-tracker pipeline (Jira | beads) with pluggable per-stage handlers, immutable ship-event evidence, and a compounding memory layer fed by the reflect stage and recalled at SessionStart. Workspace-configurable stages via stage-registry.toml + workspace.toml.
when_to_use: User runs /flow init, /flow do <ticket>, /flow recall <query>, /flow status, /flow recover, /flow sync, or /flow baseline. Also use proactively when opening a worktree under a project that has .flow/.initialized to remind users of the pipeline verbs.
allowed-tools: Bash(python3:*), Bash(git:*), Bash(bd:*), Bash(jq:*), Bash(cat:*), Bash(mkdir:*), Bash(mktemp:*), Bash(rm:*), Read, Write, Edit, Agent, AskUserQuestion
---

# /flow

Multi-tracker pipeline. Tracker is pluggable (Jira | beads). Stages, handlers,
and memory namespace come from `.flow/workspace.toml` + `stage-registry.toml`.

This skill is in **phase 8c**: `/flow init`, `/flow do`, `/flow recall`,
`/flow status`, and `/flow recover` work end-to-end against bare and
skill-bundled workspaces. `skill:<name>` handler dispatch and
per-subagent-stage reference docs are wired (see the do verb). `/flow sync`
and `/flow baseline` are stubbed with a "not yet implemented" warning + a
workaround hint.

## Argument parsing

Match `$ARGUMENTS` against the verb:

| Args | Verb |
|------|------|
| `init` (optionally `--reconfigure`, `--resume`) | init |
| `do [<ticket>]` | do |
| `recall <query> [--branch X --top-n N]` | recall |
| `status [<ticket>]` | status |
| `recover [<ticket>]` | recover |
| `sync` | stub |
| `baseline` | stub |
| (empty) | print verb listing |

For stubs, surface:
```
/flow <verb> is not implemented yet.
Workaround: <verb-specific hint>.
Track progress in plugins/flow/skills/flow/scripts/inventory.md.
```

Stub hints:
- `sync` / `baseline` → work-mode quality-gate verbs; deferred to phase 8d.

## init verb

1. Check whether `.flow/.initialized` already exists in the current
   workspace. If yes AND `--reconfigure` was NOT passed, refuse with the
   message: "workspace already initialized; re-run with `/flow init
   --reconfigure` to redo." Stop.

2. Collect answers via `AskUserQuestion`:
   - **backend**: `jira` or `beads`.
   - **bundle**: `bare` (no skill handlers), `recommended` (auto-resolved
     from installed `.flow-bundle.toml` manifests), or `custom` (user
     supplies per-stage overrides).
   - For `backend=jira`: ask for `cloud_id`, `project_key`, and optional
     `assignee_account_id`.
   - For `backend=beads`: ask for `prefix` (lowercase slug, default derived
     from current dir name).

3. Write the answers to a tmp JSON file:
   ```bash
   ANSWERS=$(mktemp /tmp/flow-init-XXXXXX.json)
   cat > "$ANSWERS" <<EOF
   {
     "backend": "<backend>",
     "bundle": "<bundle>",
     "workspace_root": "$(pwd)",
     "jira": {"cloud_id": "...", "project_key": "...", "assignee_account_id": "..."},
     "beads": {"prefix": "..."}
   }
   EOF
   ```
   Omit the irrelevant block (`jira` or `beads`) based on backend.

4. Run init:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/init.py --config "$ANSWERS"
   ```
   - Exit 0 → init.py emits result JSON to stdout. Surface to user:
     "Workspace initialized. Backend: <backend>. Namespace: <namespace>.
     Next step: `/flow do <ticket>`."
   - Non-zero → surface stderr. If `.flow/.initializing` marker exists,
     suggest `/flow init --resume`. (Partial state is transactional;
     init.py handles resume internally.)

5. Clean up:
   ```bash
   rm -f "$ANSWERS"
   ```

## do verb

Drive the dispatcher state machine. The dispatcher emits handler-descriptor
JSON; this prose acts on each descriptor and calls back to `finish`.

1. Resolve the ticket key. If `$ARGUMENTS` had a positional, use it. Else:
   ```bash
   KEY=$(python3 ${CLAUDE_SKILL_DIR}/scripts/branch_ticket.py --workspace-root .)
   ```
   Exit 0 → use `$KEY`. Exit 3 → no key on branch; ask user via
   AskUserQuestion for the ticket key. Exit 1 → workspace not initialized;
   abort with `/flow init` hint.

2. HARD GATE the workspace:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/validate_workspace.py --workspace-root .
   ```
   Non-zero → surface stderr violations; abort.

3. Initialize the run. `init` acquires the per-ticket run lease and writes the
   canonical snapshot (workspace.toml + stage-registry + handler plugin trees)
   before returning:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py init \
     --workspace-root . --ticket "$KEY"
   ```
   Capture the `run_id` from stdout JSON if needed later. Handle the exits:
   - Exit 0 → run initialized; proceed to the loop.
   - Exit 1 **with a `holder` block in the stdout JSON** → the ticket is locked
     by a live run. Surface the holder JSON and the hint
     `/flow recover <ticket>`, then abort. (Exit 1 *without* a
     `holder` block is a validate-workspace failure: surface stderr violations
     and abort, same as step 2.)
   - Exit 5 → a stale lease from a dead run holds the ticket. Surface the holder
     JSON and the hint `/flow recover <ticket>`, then abort.
   - Do NOT auto-clear a lease on exit 1 or 5. The run acquired nothing on these
     paths, so do not call `release` (see step 5).

4. **Orchestration loop** — repeat until done:

   a. Ask the dispatcher for the next stage:
      ```bash
      DESCRIPTOR=$(python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py next \
        --workspace-root . --ticket "$KEY")
      ```
      `next` refreshes the lease and verifies the snapshot before returning a
      descriptor. Handle the exits before parsing:
      - Exit 0 → continue to (b).
      - Exit 1 **with a config/version-drift error** (the workspace.toml, the
        stage-registry, or a handler plugin changed since the run started) →
        surface the drift detail and the hint `/flow recover <ticket>`, then
        break the loop. (Exit 1 *without* a drift detail is a
        validate-workspace failure: surface stderr violations and break.)
      - Exit 7 → lost lease; another run took over this ticket. Surface the hint
        `/flow recover <ticket>`, then break the loop.

   b. Parse `DESCRIPTOR` (JSON). Check shape:
      - `{"done": true}` → all stages completed. Break loop. Stage 5 prints
        the success message.
      - `{"done": false, "blocked_by": "<stage>", "reason": "<text>"}` →
        a prior stage is in `failed` state. Surface the block + reason +
        `/flow recover <ticket>` hint. Break loop.
      - Otherwise → handler descriptor with `stage`, `handler_type`,
        `head_sha`, `ticket_dir`, `output_path`, `roles`, optional
        `reference_doc`, `subagent_type`, `skill_name`, `skill_args`.

   c. **Pre-handler hook (records_diff_baseline)**: if
      `descriptor.roles` includes `"records_diff_baseline"`:
      ```bash
      python3 ${CLAUDE_SKILL_DIR}/scripts/diff_extract.py record-baseline \
        --stage "$STAGE" --ticket "$KEY" \
        --ticket-dir "$TICKET_DIR" \
        --files "$PLANNED_FILES" \
        --capture-blobs --cwd .
      ```
      `PLANNED_FILES` comes from `.flow/tickets/<KEY>.md` frontmatter
      (`planned_files = [...]`). If absent, ask the user. Exit non-zero
      aborts the stage with status=failed.

   d. Dispatch by `handler_type`:

      - **`inline`** — Read `${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}`
        via the Read tool. Follow its prose. The reference doc contains
        explicit script invocations and exit-code handling. When done,
        determine `status = completed` or `failed` based on whether the
        stage succeeded.

      - **`subagent:<type>`** — If `descriptor.reference_doc` is present,
        Read `${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}` first (e.g.
        `references/stage-plan.md`, `references/stage-implement.md`); it
        carries the per-stage protocol the subagent must follow. Then spawn
        an Agent, embedding that protocol (or a pointer to its path) in the
        prompt:
        ```
        Agent(
          subagent_type=descriptor.subagent_type,
          description="<stage> for <ticket>",
          prompt="""
          Ticket: <KEY>
          Stage: <STAGE>
          Ticket dir: <TICKET_DIR>

          You are the <subagent_type> agent for the <STAGE> stage of /flow.
          Read .flow/runs/<KEY>/ticket.json for ticket context. Read
          .flow/tickets/<KEY>.md for ticket frontmatter.

          Per-stage protocol (from <reference_doc>):
          <contents of the reference doc, or its path if it is large>

          Do the stage's work and return your report.
          """
        )
        ```
        **Capture the Agent's response string.** Use the Write tool (NOT
        Bash + shell redirect — long responses with `"` or `\` would break
        the shell command):
        - First ensure the dir exists:
          ```bash
          mkdir -p "$TICKET_DIR/stages"
          ```
        - Then call the Write tool with `file_path = <TICKET_DIR>/stages/
          <STAGE>.out` and `content = <the Agent's full response string>`.
        Remember `$TICKET_DIR/stages/<STAGE>.out` for the `--output-path`
        flag on the `finish` call below.

      - **`skill:<name>[:<args>]`** — The descriptor carries `skill_name`
        and `skill_args` (no raw handler string). Reconstruct it:
        `skill:<skill_name>` when `skill_args` is null/empty, else
        `skill:<skill_name>:<skill_args>`. Then:

        1. Resolve + verify the handler is installed:
           ```bash
           python3 ${CLAUDE_SKILL_DIR}/scripts/resolve_handler.py \
             --handler "<handler_string>"
           ```
           - Exit 1 → skill not installed. Surface "handler
             `<handler_string>` not installed; `/flow init --reconfigure`
             or install the skill." Set `STATUS=failed` and fall through to
             step (f) to record the failure in state.json (do not bare-break
             the loop).
           - Exit 2 → skill installed but manifest invalid. Surface the
             stderr error. Set `STATUS=failed` and fall through to (f).
           - Exit 0 → proceed. The stdout JSON gives `skill_name`,
             `skill_args`, and `invocation`; use those as authoritative.
        2. Invoke the skill via the Skill tool (or its slash command) using
           `skill_name`, passing `skill_args` verbatim as the argument
           string. Wait for it to finish (synchronous).
        3. Capture the skill's final response. `mkdir -p
           "$TICKET_DIR/stages"`, then call the Write tool with
           `file_path = <TICKET_DIR>/stages/<STAGE>.out` and
           `content = <the skill's full response string>` (same pattern as
           the subagent branch; NOT shell redirection). Remember that path
           for the `--output-path` flag on the `finish` call. Set
           `STATUS=completed` (or `failed` if the skill reported failure).

      - **`none`** — Skip. Immediately transition to step (f) with
        status=completed.

      - **`unknown`** — Should never reach here (validate_workspace catches
        it). If it does, surface and abort.

   e. Capture the current HEAD sha:
      ```bash
      HEAD_SHA=$(git rev-parse HEAD)
      ```

   f. Finish the stage:
      ```bash
      python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py finish \
        --workspace-root . --ticket "$KEY" \
        --stage "$STAGE" --status "$STATUS" \
        --head-sha "$HEAD_SHA" \
        [--output-path "$OUTPUT_PATH"]
      ```
      The `--output-path` flag is included for subagent stages where you
      captured the response. For inline stages, omit unless the inline
      prose explicitly produced a captured output.

   g. Loop back to (a).

5. After the loop exits — on **every** path (clean done, blocked, drift, or
   lost lease) — release the lease:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py release \
     --workspace-root . --ticket "$KEY"
   ```
   `release` is a no-op when the lease is not ours (the exit-7 takeover case),
   so it is safe to call unconditionally here. Do not call it on the init-abort
   paths of step 3, which acquired no lease.

   When the loop exited cleanly: surface "ticket <KEY> pipeline complete. State:
   `cat .flow/runs/<KEY>/state.json | jq`."

### Timeout note (mvp hole)

The descriptor's `timeout_min` is informational only. Agent tool does not
accept a timeout argument; nothing in the prose enforces it. The prose-driven
model has no live poller, so hung detection is post-hoc: `/flow recover` reads
the lease state (after a stage returns, or on demand) to surface and take over
a stalled run.

### Working-tree drift

If `git apply --cached --binary <implement.diff>` fails in stage-commit, the
working tree has drifted from the baseline. The commit stage handler
documents the recovery path. Do not silently overwrite or `--force`.

## recall verb

Pass-through to `recall.py`. Build the argv from `$ARGUMENTS`:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/recall.py "<query>" \
  [--branch <name>] \
  [--tickets <csv>] \
  [--top-n <n>] \
  --workspace-root .
```

- Exit 0 → JSON array to stdout. Surface as a formatted list to the user.
- Exit 1 → workspace unresolvable. Surface stderr + `/flow init` hint.

## status verb

Read-only. `/flow status [<ticket>]` reports run state, stage progress, the
lease, and any drift / attention flags.

1. Run:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/status.py [--ticket <KEY>] \
     --workspace-root .
   ```
   Pass `--ticket <KEY>` when `$ARGUMENTS` had a positional; otherwise run
   bare (it lists every run in the workspace). Add `--json` only when a
   machine consumer needs the raw payload; default is the human table.

2. Handle the exit:
   - Exit 0 → surface the table verbatim.
   - Exit 1 → workspace not initialized. Surface stderr + the
     `/flow init` hint; stop.

## recover verb

`/flow recover [<ticket>]` inspects a run for stuck leases, failed stages, and
config drift, then drives the matching remediation. It does not run stages;
after a successful fix it hands back to `/flow do`.

1. Resolve the ticket. If `$ARGUMENTS` had a positional, use it. Else:
   ```bash
   KEY=$(python3 ${CLAUDE_SKILL_DIR}/scripts/branch_ticket.py --workspace-root .)
   ```
   Exit 0 → use `$KEY`. Exit 3 → no key on branch; ask via AskUserQuestion.
   Exit 1 → workspace not initialized; abort with the `/flow init` hint.

2. Detect:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/recover.py detect \
     --ticket "$KEY" --workspace-root .
   ```
   Surface the report. It carries (at minimum) `lease.state`, the failed
   stage if any, `snapshot.ok`, and `ship_event_attention`.

3. Drive remediation from the report + the user's intent. When a step is
   destructive, confirm with AskUserQuestion first.

   - **Stale / expired lease** — `lease.state` is `expired_foreign` or
     `expired_reboot_clearable` (or the user explicitly wants the ticket):
     ```bash
     python3 ${CLAUDE_SKILL_DIR}/scripts/recover.py takeover \
       --ticket "$KEY" --workspace-root .
     ```
     Confirm first: takeover clears the run lock and resets `in_progress`
     stages back to `pending`. It refuses (exit 1) when the lease is `live`;
     surface that and stop rather than forcing it.

   - **Failed stage** — the report names a stage in `failed`. Offer the
     three choices via AskUserQuestion:
     - retry: `recover.py retry --stage <S> --ticket "$KEY" --workspace-root .`
     - skip: `recover.py skip --stage <S> --ticket "$KEY" --workspace-root .`
     - abort: `recover.py abort --ticket "$KEY" --workspace-root .`

   - **Config / version drift** — `snapshot.ok` is false (workspace.toml,
     stage-registry, or a handler plugin changed since the run started).
     Offer:
     - accept the current config:
       `recover.py reload-snapshot --ticket "$KEY" --workspace-root .`
     - abort: `recover.py abort --ticket "$KEY" --workspace-root .`

4. After a successful recover action, tell the user to rerun
   `/flow do <KEY>`.

**Ship-event attention**: `ship_event_attention > 0` means duplicate or
corrupt ship-event files exist for the ticket. Surface the count and tell the
user to review them manually. Deep ship-event reconciliation is not automated
in this phase.

## Stage handler routing

Inline stages (handler `inline`) read their `reference_doc` from
`${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}`. The inline reference docs:

- `references/stage-ticket.md` — fetch + cache ticket, stamp frontmatter.
- `references/stage-code_review.md` — inline self-review of implement diff.
- `references/stage-commit.md` — compose + apply + transition.
- `references/stage-reflect.md` — knowledge extraction + ship-event.

Subagent stages now carry a `reference_doc` too. The dispatcher includes it
in the descriptor when the registry stage defines one. The spawned agent
receives the per-stage protocol embedded in its prompt:

- `references/stage-plan.md` — `subagent:Plan` for the plan stage.
- `references/stage-implement.md` — `subagent:general-purpose` for implement.

(`e2e` ships `references/stage-e2e.md` for the same reason, though it
defaults to handler `none` and only becomes a subagent stage when a
workspace reconfigures it.)

Skill stages (handler `skill:<name>[:<args>]`) resolve through
`resolve_handler.py` before invocation: it confirms the bundle is installed
and its `.flow-bundle.toml` manifest is valid, then returns the concrete
`skill_name` + `skill_args` to feed the Skill tool.

## Status

Phases 1-4 + 6 + 7-mvp + 7-full + 8-mvp + 8b-mvp + 8c + 5-mvp + 5b complete.
Phase 5b wired skill-handler dispatch (via `resolve_handler.py`), subagent
stage reference docs (plan / implement / e2e), and the SessionStart recall
hook. Phase 7-full added the run-lease lifecycle and the canonical-snapshot
TOCTOU defense (init acquires the lease + writes the snapshot; next refreshes
the lease + verifies the snapshot; release drops the lease post-loop). Phase 8c
added `/flow status` (read-only run/stage/lease report) and `/flow recover`
(lease takeover, failed-stage retry/skip/abort, snapshot reload). Hung
detection is post-hoc: there is no live poller, so `/flow recover` reads the
lease state after a stage returns or on demand. The skill is now **usable** for
end-to-end `/flow do <ticket>` against bare and skill-bundled workspaces.

Still pending:
- `/flow sync`, `/flow baseline` (phase 8d).
- `recall.py --metric` + work-mode quality gate (phase 8d).
- Deep ship-event reconciliation (duplicate / corrupt ship-event files;
  `/flow recover` flags them via `ship_event_attention` but does not auto-fix).
