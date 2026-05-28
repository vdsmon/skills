---
name: flow
description: Multi-tracker pipeline (Jira | beads) with pluggable per-stage handlers, immutable ship-event evidence, and a compounding memory layer fed by the reflect stage and recalled at SessionStart. Workspace-configurable stages via stage-registry.toml + workspace.toml.
when_to_use: User runs /flow init, /flow do <ticket>, /flow recall <query>, /flow status, /flow recover, /flow sync, or /flow baseline. Also use proactively when opening a worktree under a project that has .flow/.initialized to remind users of the pipeline verbs.
allowed-tools: Bash(python3:*), Bash(git:*), Bash(bd:*), Bash(jq:*), Bash(cat:*), Bash(mkdir:*), Bash(mktemp:*), Bash(rm:*), Read, Write, Edit, Agent, AskUserQuestion
---

# /flow

Multi-tracker pipeline. Tracker is pluggable (Jira | beads). Stages, handlers,
and memory namespace come from `.flow/workspace.toml` + `stage-registry.toml`.

This skill is in **phase 5-mvp**: `/flow init`, `/flow do`, and `/flow recall`
work end-to-end against bare workspaces. `/flow status`, `/flow recover`,
`/flow sync`, and `/flow baseline` are stubbed with a "not yet implemented in
5-mvp" warning + a workaround hint. Skill-handler dispatch (the
`skill:<name>[:<args>]` handler type) is also deferred to phase 5b.

## Argument parsing

Match `$ARGUMENTS` against the verb:

| Args | Verb |
|------|------|
| `init` (optionally `--reconfigure`, `--resume`) | init |
| `do [<ticket>]` | do |
| `recall <query> [--branch X --top-n N]` | recall |
| `status [<ticket>]` | stub |
| `recover [<ticket>]` | stub |
| `sync` | stub |
| `baseline` | stub |
| (empty) | print verb listing |

For stubs, surface:
```
/flow <verb> is not implemented in phase 5-mvp.
Workaround: <verb-specific hint>.
Track progress in plugins/flow/skills/flow/scripts/inventory.md.
```

Stub hints:
- `status` → `cat .flow/runs/<ticket>/state.json | jq`
- `recover` → manually edit `.flow/runs/<ticket>/state.json`; remove `.lock`
  files if locks are stuck; rerun `/flow do <ticket>`.
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

3. Initialize the run:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py init \
     --workspace-root . --ticket "$KEY"
   ```
   Captures the `run_id` from stdout JSON if needed later.

4. **Orchestration loop** — repeat until done:

   a. Ask the dispatcher for the next stage:
      ```bash
      DESCRIPTOR=$(python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py next \
        --workspace-root . --ticket "$KEY")
      ```

   b. Parse `DESCRIPTOR` (JSON). Check shape:
      - `{"done": true}` → all stages completed. Break loop. Stage 5 prints
        the success message.
      - `{"done": false, "blocked_by": "<stage>", "reason": "<text>"}` →
        a prior stage is in `failed` state. Surface the block + reason +
        `/flow recover` hint (stub). Break loop.
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

      - **`subagent:<type>`** — Spawn an Agent:
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

      - **`skill:<name>[:<args>]`** — NOT IMPLEMENTED in 5-mvp. Surface:
        "Skill handler `<name>` is not wired in phase 5-mvp. Reconfigure
        workspace to use `inline` or `subagent:` for this stage." Abort
        the loop.

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

5. After loop exits cleanly: surface "ticket <KEY> pipeline complete. State:
   `cat .flow/runs/<KEY>/state.json | jq`."

### Timeout note (mvp hole)

The descriptor's `timeout_min` is informational only. Agent tool does not
accept a timeout argument; nothing in the prose enforces it. Phase 7-full
ships heartbeat-based hung detection that makes this enforceable.

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

## Stage handler routing

Inline stages (handler `inline`) read their `reference_doc` from
`${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}`. Currently in 5-mvp the
following reference docs exist:

- `references/stage-ticket.md` — fetch + cache ticket, stamp frontmatter.
- `references/stage-code_review.md` — inline self-review of implement diff.
- `references/stage-commit.md` — compose + apply + transition.
- `references/stage-reflect.md` — knowledge extraction + ship-event.

Subagent stages (`subagent:Plan` for plan; `subagent:general-purpose` for
implement) do NOT have reference docs in 5-mvp. The spawned agent receives
the stage name + ticket dir; it figures out the rest from context. Phase 5b
adds richer per-subagent-stage context docs.

## Status

Phases 1-4 + 6 + 7-mvp + 8-mvp + 8b-mvp + 5-mvp complete. The skill is now
**usable** for end-to-end `/flow do <ticket>` against a bare workspace.

Still pending:
- `/flow status`, `/flow recover` (phase 8c).
- `/flow sync`, `/flow baseline` (phase 8d).
- Skill-handler dispatch + subagent stage reference docs + SessionStart
  recall hook (phase 5b).
- Lease lifecycle + canonical-snapshot TOCTOU + heartbeat (phase 7-full).
- `recall.py --metric` + work-mode quality gate (phase 8d).
