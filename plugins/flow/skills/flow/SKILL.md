---
name: flow
description: Fire-and-forget ticket pipeline. /flow <ticket> plans in plan mode (ExitPlanMode = the one gate), then hands the autonomous implement→PR tail to claude --bg; you spec and review the draft PR. Multi-tracker engine (Jira | beads), pluggable handlers, compounding memory.
when_to_use: User runs /flow <ticket> or /flow spec <ticket> to spec-and-background a ticket, /flow do <ticket> to run the pipeline (foreground or the bg tail), or /flow init, recall, status, recover, sync, baseline. A bare ticket key with no verb defaults to spec. Also use proactively when opening a worktree under a project with .flow/.initialized.
allowed-tools: Bash(python3:*), Bash(git:*), Bash(bd:*), Bash(jq:*), Bash(cat:*), Bash(mkdir:*), Bash(mktemp:*), Bash(rm:*), Read, Write, Edit, Agent, AskUserQuestion, PushNotification
---

# /flow

Fire-and-forget ticket pipeline.
You spec the work and review the PR; the machine owns everything in between, unattended.

```
ME                 MACHINE (unattended)                ME
spec  ─────────→  implement → … → draft PR  ─────────→  PR review
plan mode         claude --bg, in a worktree           the deliverable
ExitPlanMode = the one gate                            claude agents = cockpit
```

`/flow <ticket>` (or `/flow spec <ticket>`) runs the read-only front half — fetch the ticket, design the plan WITH you, in plan mode.
`ExitPlanMode` is the single human gate.
On approval it seeds a git worktree and hands the autonomous tail (implement → code_review → e2e → commit → draft PR) to a backgrounded `claude --bg "/flow do <ticket>"`.
You run 3–5 at once, manage them with `claude agents`, and the deliverable is a draft PR you review.
See `references/background-pipeline.md`.

`/flow do` is the **executor primitive** — the full pipeline, resuming at the next pending stage.
`spec` normally backgrounds it in a seeded worktree, but it also runs foreground for one interactive pass.
Everything else (`recall`, `status`, `recover`, `sync`, `baseline`) is a work-state verb around the same pipeline.

Built on a multi-tracker engine: the tracker is pluggable (Jira | beads); stages, handlers, and the memory namespace come from `.flow/workspace.toml` + `stage-registry.toml`.
The memory layer compounds across tickets (reflect-stage extraction, SessionStart recall).
`skill:<name>` handler dispatch, the run lease + canonical snapshot, and the work-mode quality gate are all wired.

## Argument parsing

Match the **first whitespace-delimited token** of `$ARGUMENTS` against the verb set below by exact string equality.
If it equals a verb, route there.
If `$ARGUMENTS` is empty, print the verb listing.
Otherwise — a first token that is not any verb (a bare ticket key like `FT-123`, or a beads key like `sync-42`) — route to **spec**, taking that positional token as the ticket key (same key-resolution as spec step 2).
Spec is the default because fire-and-forget is the primary path.
(Exact-token match is what keeps this unambiguous: `sync-42` ≠ the verb `sync`, so a ticket key never collides with a verb.)

| First token | Verb |
|------|------|
| `init` (optionally `--reconfigure`, `--resume`) | init |
| `spec` (optionally `<ticket>`) | spec (read-only front half → bootstrap → bg handoff) |
| `do` (optionally `<ticket>`, `--notify`) | do (executor primitive / tail) |
| `recall <query> [--branch X --top-n N]` | recall |
| `recall --metric tickets-per-week [...]` | metric (recall passthrough) |
| `status` (optionally `<ticket>`) | status |
| `recover` (optionally `<ticket>`) | recover |
| `sync` | sync |
| `baseline` | baseline |
| (empty) | print verb listing |
| anything else (e.g. `FT-123`) | spec; that positional token is the ticket key |

## init verb

1. Check whether `.flow/.initialized` already exists in the current workspace.
   If yes AND `--reconfigure` was NOT passed, refuse with the message: "workspace already initialized; re-run with `/flow init --reconfigure` to redo."
   Stop.

2. Collect answers via `AskUserQuestion`:
   - **backend**: `jira` or `beads`.
   - **bundle**: `bare` (no skill handlers), `recommended` (auto-resolved from installed `.flow-bundle.toml` manifests), or `custom` (user supplies per-stage overrides).
   - For `backend=jira`: ask for `cloud_id`, `project_key`, and optional `assignee_account_id`.
   - For `backend=beads`: ask for `prefix` (lowercase slug, default derived from current dir name).

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
   - Exit 0 → init.py emits result JSON to stdout.
     Surface to user: "Workspace initialized. Backend: <backend>. Namespace: <namespace>. Next step: `/flow do <ticket>`."
   - Non-zero → surface stderr.
     If `.flow/.initializing` marker exists, suggest `/flow init --resume`.
     (Partial state is transactional; init.py handles resume internally.)

5. Clean up:
   ```bash
   rm -f "$ANSWERS"
   ```

## spec verb

The read-only front half of the fire-and-forget model: fetch the ticket, design the plan WITH the user, then seed a worktree and hand the autonomous tail to a backgrounded `/flow do`.
This is the human/machine boundary — you own the spec and the eventual PR review; the machine owns everything between.

1. **Be in plan mode.** The front half must perform no writes.
   If you are not already in plan mode, call `EnterPlanMode` before doing anything else.
   (Plan mode also makes `ExitPlanMode` the natural approval gate.)

2. Resolve the ticket key (positional `$ARGUMENTS`, else
   `branch_ticket.py --workspace-root .`).

3. Fetch ticket context **into the conversation** — do NOT write files (plan
   mode forbids it):
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/tracker_cli.py --workspace-root . get --key "$KEY"
   ```
   Read the stdout.
   Explore the codebase read-only (Read/Grep/Glob, or a subagent).
   `recall` is auto-injected at SessionStart; weave relevant prior knowledge into the plan.

4. Iterate the implementation plan with the user: goal, files to change, approach, test strategy, risks.
   This is the same depth a `subagent:Plan` handler would produce — but interactive, so the user shapes it.
   **If the workspace opts into e2e** (`workspace.toml [pipeline.handlers] e2e` is not `none`), the plan MUST also settle the **e2e recipe** — this is the moment to decide it, while you (and any live tracker/AWS auth) are present.
   Elicit from the user: which suite/runner the e2e stage runs, the exact command + any env-prep it needs, the fixture (the concrete input — a sample id, account, dataset), and the expected pass signal.
   If this ticket has no meaningful e2e, settle that too — the recipe value becomes `skip: <reason>` or `test-ci-only`. The point is a conscious decision per ticket, never a silent omission.
   The bootstrap in step 6 **refuses** when e2e is enabled and no recipe is passed, so do not skip this.

5. **`ExitPlanMode`** with the plan = Gate 1, the one human gate.
   On approval you return to normal mode.

6. (Normal mode) Persist the approved plan and bootstrap the worktree.
   The tail branches off whatever `--base` you pass, so run `/flow spec` from your integration branch (the example uses the current branch):
   ```bash
   PLAN=/tmp/flow-plan-$KEY.md   # write the approved plan text here (Write tool)
   python3 ${CLAUDE_SKILL_DIR}/scripts/flow_worktree.py create \
     --ticket "$KEY" \
     --plan-from "$PLAN" \
     --base "$(git rev-parse --abbrev-ref HEAD)" \
     --branch "feature/$KEY-<slug>" \
     --main-root . \
     --planned-files "<comma-separated files the plan will touch>" \
     --commit-type <feat|fix|chore|...> \
     --commit-summary "<one-line summary from the plan>" \
     --e2e-recipe "<the e2e recipe from step 4 — omit ONLY when e2e is none>"
   ```
   Derive `<slug>` from the ticket summary, and `--planned-files` from the plan's "files to change" list.
   `--e2e-recipe` carries the recipe settled in step 4 (runner + command + env-prep + fixture + expected, or `skip: <reason>` / `test-ci-only`); pass it whenever e2e is enabled and omit it only when the handler is `none`.
   The bootstrap seeds state (plan pre-completed, ticket left pending), injects the plan, stamps `planned_files` + `commit_type` + `commit_summary` (+ `e2e_recipe` when given) into frontmatter (so the implement pre-hook, the commit stage, and the e2e stage never pause to ask the user — the whole point of an unattended tail), points the worktree's memory store at this checkout's `.flow` (shared, so memory compounds across worktrees), copies gitignored config, and `mise trust`s the worktree.
   If e2e is enabled and you omit `--e2e-recipe`, create exits 2 (`_ConfigError`) — go back to step 4 and settle the recipe.
   Surface any `WARN` lines (e.g. mise trust failures — the tail would die on the first `mise run`).

7. **Hand off the tail.** The bootstrap prints a `launch_cmd` of the form `cd <worktree> && claude --bg "/flow do $KEY"` — **without** `--notify`.
   Append `--notify` to its inner command yourself; this appended line is what you surface or run in **both** branches below, so the tail pings you when it lands the PR or hits a blocker (see the do-verb `--notify` note):
   ```bash
   cd <worktree> && claude --bg "/flow do $KEY --notify"
   ```
   Whether you fire that line or the skill fires it for you is gated on one marker in the main checkout.
   Probe it first:
   ```bash
   test -f .flow/.bg-autofire-enabled && echo AUTOFIRE || echo PRINT
   ```
   - **`PRINT` (marker absent, default)** → print the appended line above; the user fires it.
     This is the v1 path, and it is how bg auth gets proven on the first ticket: a `--bg` session inherits cached MCP / keychain creds, but a claude.ai OAuth refresh can 401 silently (see `references/background-pipeline.md`).
   - **`AUTOFIRE` (marker present)** → run the appended line above yourself via Bash (zero-touch).
     Tell the user to create the marker (`touch .flow/.bg-autofire-enabled`) only after one ticket has gone end-to-end and bg auth is confirmed.

   Either way: manage in-flight tickets with `claude agents` (attach to peek, answer a blocker, detach); the deliverable is a draft PR you review.
   See `references/background-pipeline.md`.

## do verb

The **executor primitive**: the full ticket→PR pipeline, driven off the dispatcher state machine.
`spec` normally backgrounds it in a seeded worktree (`claude --bg "/flow do <ticket> --notify"`), where `init` resumes at the next pending stage — a spec-seeded worktree picks up at `implement`.
It also runs foreground for one interactive pass.
The dispatcher emits handler-descriptor JSON; this prose acts on each descriptor and calls back to `finish`.

**`--notify` (set by the bg handoff).** When `$ARGUMENTS` carries `--notify`, the tail pings you via the PushNotification tool at two points: (1) after the `create_pr` stage finishes `completed`, with the PR URL (`"flow <KEY>: PR ready for review — <url>"`); (2) before any `AskUserQuestion` this run would raise, naming the blocker (`"flow <KEY> blocked: <reason> — attach via claude agents"`), then it asks (which pauses the bg session).
PushNotification is harness-local (your terminal, plus your phone if Remote Control is on), so it fires even when tracker / MCP auth has died in the bg session — that is how you learn the tail stalled.
`--notify` is a flag, not the ticket key; ignore it when reading the positional in step 1.
Foreground `/flow do` without `--notify` stays silent.

1. Resolve the ticket key. If `$ARGUMENTS` had a positional, use it. Else:
   ```bash
   KEY=$(python3 ${CLAUDE_SKILL_DIR}/scripts/branch_ticket.py --workspace-root .)
   ```
   Exit 0 → use `$KEY`.
   Exit 3 → no key on branch; ask user via AskUserQuestion for the ticket key.
   Exit 1 → workspace not initialized; abort with `/flow init` hint.

2. HARD GATE the workspace:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/validate_workspace.py --workspace-root .
   ```
   Non-zero → surface stderr violations; abort.

3. Initialize the run.
   `init` acquires the per-ticket run lease and writes the canonical snapshot (workspace.toml + stage-registry + handler plugin trees) before returning:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py init \
     --workspace-root . --ticket "$KEY"
   ```
   Capture the `run_id` from stdout JSON if needed later.
   Handle the exits:
   - Exit 0 → run initialized; proceed to the loop.
   - Exit 1 **with a `holder` block in the stdout JSON** → the ticket is locked by a live run.
     Surface the holder JSON and the hint `/flow recover <ticket>`, then abort.
     (Exit 1 *without* a `holder` block is a validate-workspace failure: surface stderr violations and abort, same as step 2.)
   - Exit 5 → a stale lease from a dead run holds the ticket.
     Surface the holder JSON and the hint `/flow recover <ticket>`, then abort.
   - Do NOT auto-clear a lease on exit 1 or 5.
     The run acquired nothing on these paths, so do not call `release` (see step 5).

4. **Orchestration loop** — repeat until done:

   a. Ask the dispatcher for the next stage:
      ```bash
      DESCRIPTOR=$(python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py next \
        --workspace-root . --ticket "$KEY")
      ```
      `next` refreshes the lease and verifies the snapshot before returning a descriptor.
      Handle the exits before parsing:
      - Exit 0 → continue to (b).
      - Exit 1 → distinguish by the stdout JSON payload, then break the loop:
        - `detail` present → config/version drift (the workspace.toml, the stage-registry, or a handler plugin changed mid-run).
          Surface the drift detail + the hint `/flow recover <ticket>`.
        - `violations` present → a validate-workspace failure.
          Surface the violations and abort.
        - bare `error` (e.g. `unrecoverable state.json`) → the run state is corrupt.
          Surface the error + the `/flow recover <ticket>` hint.
      - Exit 7 → lost lease; another run took over this ticket.
        Surface the hint `/flow recover <ticket>`, then break the loop.

   b. Parse `DESCRIPTOR` (JSON). Check shape:
      - `{"done": true}` → all stages completed.
        Break loop.
        Stage 5 prints the success message.
      - `{"done": false, "blocked_by": "<stage>", "reason": "<text>"}` →
        a prior stage is in `failed` state.
        Surface the block + reason + `/flow recover <ticket>` hint.
        Break loop.
      - Otherwise → handler descriptor with `stage`, `handler_type`, `head_sha`, `ticket_dir`, `output_path`, `roles`, optional `reference_doc`, `subagent_type`, `skill_name`, `skill_args`.

   c. **Pre-handler hook (records_diff_baseline)**: if
      `descriptor.roles` includes `"records_diff_baseline"`:
      ```bash
      python3 ${CLAUDE_SKILL_DIR}/scripts/diff_extract.py record-baseline \
        --stage "$STAGE" --ticket "$KEY" \
        --ticket-dir "$TICKET_DIR" \
        --files "$PLANNED_FILES" \
        --capture-blobs --cwd .
      ```
      `PLANNED_FILES` comes from `.flow/tickets/<KEY>.md` frontmatter (`planned_files = [...]`).
      If absent, ask the user (under `--notify`, push first — see the `--notify` note).
      Exit non-zero aborts the stage with status=failed.

   d. Dispatch by `handler_type`:

      - **`inline`** — Read `${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}` via the Read tool.
        Follow its prose.
        The reference doc contains explicit script invocations and exit-code handling.
        When done, determine `status = completed` or `failed` based on whether the stage succeeded.

      - **`subagent:<type>`** — If `descriptor.reference_doc` is present, Read `${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}` first (e.g. `references/stage-plan.md`, `references/stage-implement.md`); it carries the per-stage protocol the subagent must follow.
        Then spawn an Agent, embedding that protocol (or a pointer to its path) in the prompt:
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
        **Capture the Agent's response string.** Use the Write tool (NOT Bash + shell redirect — long responses with `"` or `\` would break the shell command):
        - First ensure the dir exists:
          ```bash
          mkdir -p "$TICKET_DIR/stages"
          ```
        - Then call the Write tool with `file_path = <TICKET_DIR>/stages/
          <STAGE>.out` and `content = <the Agent's full response string>`.
        Remember `$TICKET_DIR/stages/<STAGE>.out` for the `--output-path` flag on the `finish` call below.

      - **`skill:<name>[:<args>]`** — The descriptor carries `skill_name` and `skill_args` (no raw handler string).
        Reconstruct it: `skill:<skill_name>` when `skill_args` is null/empty, else `skill:<skill_name>:<skill_args>`.
        Then:

        1. Resolve + verify the handler is installed:
           ```bash
           python3 ${CLAUDE_SKILL_DIR}/scripts/resolve_handler.py \
             --handler "<handler_string>"
           ```
           - Exit 1 → skill not installed.
             Surface "handler `<handler_string>` not installed; `/flow init --reconfigure` or install the skill."
             Set `STATUS=failed` and fall through to step (e) to record the failure in state.json (do not bare-break the loop).
           - Exit 2 → skill installed but manifest invalid.
             Surface the stderr error.
             Set `STATUS=failed` and fall through to (e).
           - Exit 0 → proceed.
             The stdout JSON gives `skill_name`, `skill_args`, and `invocation`; use those as authoritative.
        2. Invoke the skill via the Skill tool (or its slash command) using `skill_name`, passing `skill_args` verbatim as the argument string.
           Wait for it to finish (synchronous).
        3. Capture the skill's final response.
           `mkdir -p "$TICKET_DIR/stages"`, then call the Write tool with `file_path = <TICKET_DIR>/stages/<STAGE>.out` and `content = <the skill's full response string>` (same pattern as the subagent branch; NOT shell redirection).
           Remember that path for the `--output-path` flag on the `finish` call.
           Set `STATUS=completed` (or `failed` if the skill reported failure).

      - **`none`** — Skip.
        Immediately transition to step (e) with status=completed.

      - **`unknown`** — Should never reach here (validate_workspace catches it).
        If it does, surface and abort.

   e. Finish the stage:
      ```bash
      python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py finish \
        --workspace-root . --ticket "$KEY" \
        --stage "$STAGE" --status "$STATUS" \
        [--output-path "$OUTPUT_PATH"]
      ```
      `finish` records the current HEAD sha itself (via `git rev-parse` in the workspace root); you do not pass it.
      The `--output-path` flag is included for subagent/skill stages where you captured the response.
      For inline stages, omit unless the inline prose explicitly produced a captured output.

      If `--notify` is set and `$STAGE` is `create_pr` with `$STATUS` completed, send the PR-ready PushNotification now (read the PR URL from the captured `create_pr.out`).
      See the `--notify` note above.

   f. Loop back to (a).

5. After the loop exits — on **every** path (clean done, blocked, drift, or
   lost lease) — release the lease:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/dispatch_stage.py release \
     --workspace-root . --ticket "$KEY"
   ```
   `release` is a no-op when the lease is not ours (the exit-7 takeover case), so it is safe to call unconditionally here.
   Do not call it on the init-abort paths of step 3, which acquired no lease.

   When the loop exited cleanly: surface "ticket <KEY> pipeline complete. State:
   `cat .flow/runs/<KEY>/state.json | jq`."

### Timeout note (mvp hole)

The descriptor's `timeout_min` is informational only.
Agent tool does not accept a timeout argument; nothing in the prose enforces it.
The prose-driven model has no live poller, so hung detection is post-hoc: `/flow recover` reads the lease state (after a stage returns, or on demand) to surface and take over a stalled run.

### Working-tree drift

If `git apply --cached --binary <implement.diff>` fails in stage-commit, the working tree has drifted from the baseline.
The commit stage handler documents the recovery path.
Do not silently overwrite or `--force`.

## recall verb

Pass-through to `recall.py`.
Build the argv from `$ARGUMENTS`:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/recall.py "<query>" \
  [--branch <name>] \
  [--tickets <csv>] \
  [--top-n <n>] \
  --workspace-root .
```

- Exit 0 → JSON array to stdout. Surface as a formatted list to the user.
- Exit 1 → workspace unresolvable. Surface stderr + `/flow init` hint.

### recall --metric (the 14-day checkpoint calculator)

`/flow recall --metric tickets-per-week [...]` is a pass-through to the metric calculator (recall.py forwards `--metric` to `metric.py`):

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/recall.py --metric tickets-per-week \
  --namespace <ns> --workspace-root . \
  [--since YYYY-MM-DD] [--until YYYY-MM-DD] \
  [--checkpoint --mode personal|work --manifest-path <p>]
```

It counts shipped tickets in the window from the immutable ship-event evidence and splits `shipped_via_flow` (ticket+run+reflect three-way binding verified) from `shipped_backend_not_attributed`.
`--checkpoint --mode` aggregates across the checkpoint manifest's participants of that mode.
Surface the JSON report.

## sync verb

`/flow sync` drains `.flow/pending-mutations.jsonl` — tracker writes (transition / comment / link / edit) that an adapter queued after a transient failure — and reconciles them against live tracker state.
Work-mode verb.

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/sync.py --workspace-root .
```

- Exit 0 → JSON report `{applied, applied_externally, superseded, failed,
  removed}`.
  Surface counts; `applied_externally` = the op was already done (idempotency win), `superseded` = the pre-state changed under it (skipped).
- Exit 1 → some entries still failed; they stay queued for the next sync.
- Exit 2 → workspace / tracker unavailable. Surface stderr.

## baseline verb

`/flow baseline` manages the pre-migration time-to-PR baseline the work-mode gate compares against (±30%).
Live collection from Jira/Bitbucket is manual; this verb owns the file + the statistics.

```bash
# build from samples (a JSON list of {ticket, time_to_pr_hours}):
python3 ${CLAUDE_SKILL_DIR}/scripts/baseline_collect.py build \
  --samples-json <file-or-inline-json> [--path <p>] [--source <s>]
# show the stored baseline:
python3 ${CLAUDE_SKILL_DIR}/scripts/baseline_collect.py show [--path <p>]
```

- Exit 0 → writes/prints the baseline (median + p90 + n).
- Exit 1 → no samples, or an unparseable `--samples-json` value.
- Exit 2 → argparse usage error (missing subcommand or `--samples-json`).
- Exit 3 → I/O error, or `show` found no stored baseline.

## status verb

Read-only.
`/flow status [<ticket>]` reports run state, stage progress, the lease, and any drift / attention flags.

1. Run:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/status.py [--ticket <KEY>] \
     --workspace-root .
   ```
   Pass `--ticket <KEY>` when `$ARGUMENTS` had a positional; otherwise run bare (it lists every run in the workspace).
   Add `--json` only when a machine consumer needs the raw payload; default is the human table.

2. Handle the exit:
   - Exit 0 → surface the table verbatim.
   - Exit 1 → workspace not initialized.
     Surface stderr + the `/flow init` hint; stop.

## recover verb

`/flow recover [<ticket>]` inspects a run for stuck leases, failed stages, and config drift, then drives the matching remediation.
It does not run stages; after a successful fix it hands back to `/flow do`.

1. Resolve the ticket. If `$ARGUMENTS` had a positional, use it. Else:
   ```bash
   KEY=$(python3 ${CLAUDE_SKILL_DIR}/scripts/branch_ticket.py --workspace-root .)
   ```
   Exit 0 → use `$KEY`.
   Exit 3 → no key on branch; ask via AskUserQuestion.
   Exit 1 → workspace not initialized; abort with the `/flow init` hint.

2. Detect:
   ```bash
   python3 ${CLAUDE_SKILL_DIR}/scripts/recover.py detect \
     --ticket "$KEY" --workspace-root .
   ```
   Surface the report.
   It carries (at minimum) `lease.state`, the failed stage if any, `snapshot.ok`, and `ship_event_attention`.

3. Drive remediation from the report + the user's intent.
   When a step is destructive, confirm with AskUserQuestion first.

   - **Stale / expired lease** — `lease.state` is `expired_foreign` or
     `expired_reboot_clearable` (or the user explicitly wants the ticket):
     ```bash
     python3 ${CLAUDE_SKILL_DIR}/scripts/recover.py takeover \
       --ticket "$KEY" --workspace-root .
     ```
     Confirm first: takeover clears the run lock and resets `in_progress` stages back to `pending`.
     It refuses (exit 1) when the lease is `live`; surface that and stop rather than forcing it.

   - **Failed stage** — the report names a stage in `failed`.
     Offer the three choices via AskUserQuestion:
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

**Ship-event attention**: `ship_event_attention > 0` means duplicate or corrupt ship-event files exist for the ticket.
Surface the count and tell the user to review them manually.
Deep ship-event reconciliation is not automated in this phase.

## Stage handler routing

Inline stages (handler `inline`) read their `reference_doc` from `${CLAUDE_SKILL_DIR}/${descriptor.reference_doc}`.
The inline reference docs:

- `references/stage-ticket.md` — fetch + cache ticket, stamp frontmatter.
- `references/stage-code_review.md` — inline self-review of implement diff.
- `references/stage-commit.md` — compose + apply + transition.
- `references/stage-reflect.md` — knowledge extraction + ship-event.

Subagent stages now carry a `reference_doc` too.
The dispatcher includes it in the descriptor when the registry stage defines one.
The spawned agent receives the per-stage protocol embedded in its prompt:

- `references/stage-plan.md` — `subagent:Plan` for the plan stage.
- `references/stage-implement.md` — `subagent:general-purpose` for implement.

(`e2e` ships `references/stage-e2e.md` for the same reason, though it defaults to handler `none` and only becomes a subagent stage when a workspace reconfigures it.)

Skill stages (handler `skill:<name>[:<args>]`) resolve through `resolve_handler.py` before invocation: it confirms the bundle is installed and its `.flow-bundle.toml` manifest is valid, then returns the concrete `skill_name` + `skill_args` to feed the Skill tool.

## Status

Phases 1-4 + 6 + 7-mvp + 7-full + 8-mvp + 8b-mvp + 8c + 5-mvp + 5b complete.
Phase 5b wired skill-handler dispatch (via `resolve_handler.py`), subagent stage reference docs (plan / implement / e2e), and the SessionStart recall hook.
Phase 7-full added the run-lease lifecycle and the canonical-snapshot TOCTOU defense (init acquires the lease + writes the snapshot; next refreshes the lease + verifies the snapshot; release drops the lease post-loop).
Phase 8c added `/flow status` (read-only run/stage/lease report) and `/flow recover` (lease takeover, failed-stage retry/skip/abort, snapshot reload).
Hung detection is post-hoc: there is no live poller, so `/flow recover` reads the lease state after a stage returns or on demand.
Phase 8d added the work-mode quality gate: `recall.py --metric tickets-per-week` (+ `--checkpoint --mode`), `/flow sync` (drain + reconcile pending tracker mutations), `/flow baseline` (time-to-PR baseline file + stats), `validate_postmortem.py` (postmortem schema + week-over-week trend), the commit content-ownership gate (`diff_extract.py check-ownership`), and the init checkpoint-mode + backend alignment matrix.
The skill is now **feature-complete** for end-to-end `/flow do <ticket>` against bare and skill-bundled workspaces.

Still pending (deliberately deferred, not blocking):
- Deep ship-event reconciliation (duplicate / corrupt ship-event files;
  `/flow recover` flags them via `ship_event_attention` but does not auto-fix).
- Live `baseline_collect` ingestion from Jira changelog + Bitbucket PR history
  (the file format + stats ship; collection is manual for now).
- Cross-project `/flow status --all` dashboard.
- Hunk-level commit ownership (current gate is filename-level).
