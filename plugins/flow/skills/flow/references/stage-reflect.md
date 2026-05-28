# Stage: reflect

## Purpose

Extract durable knowledge from this ticket's run, append entries to the
compounding memory layer, and (if the ticket shipped) record an immutable
ship-event evidence record.

Reflect is the closing stage. The discipline here is what makes `/flow`
compounding: every ticket's run produces 0..N knowledge entries that future
tickets in the same workspace can recall via BM25.

The taxonomy is closed:
- **LEARNED** — technical insight that future-you should know about.
- **DECISION** — design choice + rationale that's not obvious from the code.
- **FACT** — codebase / environment observation that surprised you.
- **PATTERN** — recurring technique worth naming.
- **INVESTIGATION** — research artifact (links, papers, prior art).
- **DEVIATION** — unexpected surprise (a thing that didn't work as
  documented).

## Inputs

- `<ticket-dir>/state.json` — full run history.
- `.flow/tickets/<KEY>.md` — ticket frontmatter.
- `<ticket-dir>/stages/*.out` — captured subagent reports.
- The git diff since stage `ticket`.

## Steps

1. Bundle the reflect inputs:
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/reflect_inputs.py \
     --ticket <KEY> \
     --ticket-dir <ticket-dir> \
     --ticket-frontmatter .flow/tickets/<KEY>.md \
     --cwd .
   ```
   - Exit 0 → JSON payload to stdout: `{ticket, run_id, state,
     ticket_frontmatter, final_diff, subagent_reports[]}`.
   - Exit 1 → state.json missing / corrupt. Abort with status=failed.
   - Exit 2/3 → diff or I/O error. Abort.

2. Read the bundle JSON carefully. Look for novel signal:
   - **What** did the ticket teach you that wasn't already documented?
   - **What** design choice did you make + why (DECISION)?
   - **What** about the codebase or environment surprised you (FACT /
     DEVIATION)?
   - **What** recurring technique did you discover (PATTERN)?
   - **What** would you want to know if you came back to this code in 3
     months?

   **REJECT** narrative summaries. "We added a feature" is not novel. "The
   X system's caching layer breaks when Y conditions hold" IS novel.

3. For EACH extracted entry (0 or more), append to knowledge.jsonl:
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/memory_append.py \
     --type <LEARNED|DECISION|FACT|PATTERN|INVESTIGATION|DEVIATION> \
     --text "<entry body>" \
     --branch "$(git rev-parse --abbrev-ref HEAD)" \
     --ticket <KEY> \
     --workspace-root .
   ```
   - Exit 0 → appended.
   - Exit 1 → duplicate id (no-op). Fine; continue to next entry.
   - Exit 2 → lock contention. Retry once. If retry fails, log and skip.
   - Exit 3 → invalid type. Bug in your prompt; fix and retry.
   - Exit 4 → I/O error. Log and skip.

4. **Zero novel signal path**: if you genuinely have nothing to append,
   emit exactly:
   ```
   no novel signal
   ```
   Skip all writes. Do NOT manufacture entries. Reflect-empty IS a valid
   outcome; the compounding rate doesn't need every ticket to add an
   entry.

5. Check if the ticket has shipped:
   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/tracker_cli.py \
     --workspace-root . \
     is-shipped --key <KEY>
   ```
   - Exit 0 → JSON `{state, shipped_at, evidence, source}`.
   - Exit 1 → tracker error. Skip ship-event observation; reflect still
     completes successfully.

6. If `state == "shipped"`:
   - Read `<ticket-dir>/state.json` to get `run_id`:
     ```bash
     RUN_ID=$(jq -r '.run_id' <ticket-dir>/state.json)
     ```
   - Build the evidence JSON. The shape MUST be exactly:
     ```json
     {
       "ticket": "<KEY>",
       "shipped_at": "<UTC ISO from is-shipped output>",
       "evidence": {<tracker-specific fields from is-shipped output>}
     }
     ```
     No extra top-level keys (observe-ship-event rejects them).
   - Observe the ship event:
     ```bash
     ${CLAUDE_SKILL_DIR}/scripts/observe_ship_event.py \
       --ticket <KEY> \
       --evidence-json '<json>' \
       --run-id "$RUN_ID" \
       --workspace-root .
     ```
     - Exit 0 → primary ship-event file written. Continue.
     - Exit 1 → bad evidence JSON. Abort stage with status=failed.
     - Exit 2 → duplicate (dupe.<n>.json written). Continue normally; this
       is informational, not an error.
     - Exit 3 → I/O error (intent log written). Surface warning; continue.

7. Stage completes with status=completed.

## Outputs

- 0..N new lines in `.flow/<namespace>/knowledge.jsonl`.
- 0..1 ship-event file at `.flow/<namespace>/ship-events/<KEY>.json` (or
  `.dupe.<n>.json` on EEXIST).

## Errors

- `reflect_inputs.py` exit 1 → state corrupt; abort.
- `memory_append.py` exit 1 → duplicate id; fine, continue.
- `observe_ship_event.py` exit 1 → bad evidence JSON; abort.
- `observe_ship_event.py` exit 2 → duplicate ship-event; informational,
  continue.

## Skip conditions

- Skipped entirely if `workspace.toml [pipeline.handlers] reflect = "none"`.
  Reflect is `required_when_compounding = true` in the registry so it
  appears in any workspace with `[memory] compounding = true`.
