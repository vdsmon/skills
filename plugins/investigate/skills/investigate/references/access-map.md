# Access map — acme platform environment

Reachability of the systems an investigation touches. "Reachable" = dig directly, no raise. "Raise" = stop and ask the human (see the Prime Directive). MCP tools are deferred — load schemas with `ToolSearch "select:<tool_name>"` before calling.

| System | How you reach it | If blocked |
|---|---|---|
| Code + git history (any repo under `~/bitbucket` or `~/repos`) | direct (Read, Bash `git`) — the failing code may live in an adjacent repo, not the one you're in | — |
| Jira / Confluence | Atlassian MCP (`mcp__claude_ai_Atlassian__getJiraIssue`, `searchJiraIssuesUsingJql`, `getConfluencePage`, …) | raise |
| Slack thread | Slack MCP (`mcp__claude_ai_Slack__slack_read_thread`, `slack_search_*`) | raise — ask for the thread link or a paste |
| StarRocks | `mcp__starrrocks__*` (`read_query`, `table_overview`, `analyze_query`) | raise |
| MariaDB core / filing | `mcp__mariadb-core__*`, `mcp__mariadb-filing__*` (`execute_sql`, `get_table_schema`, `list_tables`) | raise |
| Acme form / register / DSL logic | `mcp__domain-search__*` + `mcp__code-index__*` | raise |
| AWS CloudWatch / EMR / S3 | `aws` CLI — **authenticate yourself first** with `mise sso` (opens a browser, returns; idempotent). Do NOT ask the human to auth. | raise only if `mise sso` itself fails or the account lacks the resource |
| Airflow — local reproduction | `mise run airflow:*` tasks (see the `airflow-local` skill: `airflow:dag-status`, `airflow:task-log`, `airflow:trigger`) | — |
| **Airflow — prod runtime state / logs** | **no programmatic access (web UI only, `workflows.acme.com`)** | **raise: ask the human to paste the failing task's full log** |

## The two chronic blockers

1. **Prod Airflow logs.** Web-UI-only. When the report points at a prod run, you cannot pull the log yourself — ask for a paste of the *full* failing task log (not just the error word; the traceback discriminates the cause).
2. **A system you're simply not connected to.** If an MCP isn't loaded/available or a DB connection is missing, that's a raise — don't infer the data.

AWS is **not** a blocker: authenticate with `mise sso` yourself and proceed.

## Identity sanity-check

Before digging, confirm the report's identifiers actually resolve against the real platform. Reporters paraphrase: a DAG name, run-id shape, host, or storage path that doesn't match anything real is a signal the report is imprecise — `git log --all -S '<identifier>'` proves "never existed here" vs "renamed." A close-but-wrong mapping sends the fix to the wrong code path. If identifiers don't resolve, that's a raise (which DAG/repo/run did you mean?), not a guess.
