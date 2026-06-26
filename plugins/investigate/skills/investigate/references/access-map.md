# Access map: your platform environment

Reachability of the systems an investigation touches. "Reachable" = dig directly, no raise. "Raise" = stop and ask the human (see the Prime Directive). MCP tools are deferred, so load schemas with `ToolSearch "select:<tool_name>"` before calling.

Fill this table in for your own stack. The rows below are the common shapes, so swap the tool names and hosts for the ones you actually have.

| System | How you reach it | If blocked |
|---|---|---|
| Code + git history (any repo under your source root, e.g. `~/repos`) | direct (Read, Bash `git`), but the failing code may live in an adjacent repo, not the one you're in | - |
| Issue tracker / wiki | tracker MCP (e.g. `mcp__<tracker>__getIssue`, `searchIssues`, `getPage`, ...) | raise |
| Chat thread | chat MCP (e.g. `mcp__<chat>__read_thread`, `search_*`) | raise: ask for the thread link or a paste |
| OLAP / analytics warehouse | warehouse MCP (`read_query`, `table_overview`, `analyze_query`) | raise |
| Operational databases | DB MCP (`execute_sql`, `get_table_schema`, `list_tables`) | raise |
| Domain business logic (forms / rules / DSL) | your domain MCP servers (`mcp__<domain>__*`) | raise |
| Cloud (logs / compute / object storage) | cloud CLI: **authenticate yourself first** (e.g. an SSO login that opens a browser and returns; idempotent). Do NOT ask the human to auth. | raise only if the auth itself fails or the account lacks the resource |
| Orchestrator: local reproduction | local task runner (see your project's run skill) | - |
| **Orchestrator: prod runtime state / logs** | **often web-UI only (no programmatic access)** | **raise: ask the human to paste the failing task's full log** |

## The two chronic blockers

1. **Prod orchestrator logs.** Frequently web-UI-only. When the report points at a prod run, you cannot pull the log yourself, so ask for a paste of the *full* failing task log (not just the error word; the traceback discriminates the cause).
2. **A system you're simply not connected to.** If an MCP isn't loaded/available or a DB connection is missing, that's a raise, so don't infer the data.

Cloud access is usually **not** a blocker: authenticate yourself and proceed.

## Identity sanity-check

Before digging, confirm the report's identifiers actually resolve against the real platform. Reporters paraphrase: a job name, run-id shape, host, or storage path that doesn't match anything real is a signal the report is imprecise, and `git log --all -S '<identifier>'` proves "never existed here" vs "renamed." A close-but-wrong mapping sends the fix to the wrong code path. If identifiers don't resolve, that's a raise (which job/repo/run did you mean?), not a guess.
