# Jira API inventory

Source: `~/.claude/skills/jira-workflow/{SKILL.md,references/*.md}` — the proven
8-stage pipeline that JiraAdapter must replicate as REST calls.

Distinct MCP Atlassian functions exercised: **7**. Direct REST replacements
listed below. Anything in the Tracker Protocol not exercised by jira-workflow is
marked **NEW** — implemented for cross-backend completeness and validated via
mocks (no live jira-workflow precedent).

## Calls used by jira-workflow

| # | jira-workflow MCP function                 | call sites (refs/*.md)             | REST endpoint                                                              | Tracker Protocol method                       |
|---|--------------------------------------------|------------------------------------|----------------------------------------------------------------------------|-----------------------------------------------|
| 1 | `getAccessibleAtlassianResources`          | preflight.md:55 (init bootstrap)   | `GET https://api.atlassian.com/oauth/token/accessible-resources`           | constructor-time helper (not a Protocol method) |
| 2 | `atlassianUserInfo`                        | preflight.md:16 (init bootstrap)   | `GET /rest/api/3/myself`                                                   | constructor-time helper (not a Protocol method) |
| 3 | `getJiraIssue`                             | ticket.md:52, ticket.md:61         | `GET /rest/api/3/issue/{issueIdOrKey}?fields=...`                          | `get(key) -> Ticket`                          |
| 4 | `searchJiraIssuesUsingJql`                 | ticket.md:35, ticket.md:53, ticket.md:55 | `POST /rest/api/3/search/jql` (v3 paginated)                         | `list_assigned(filter)`, `list_linked(key)`, subtasks (folded into `get` ticket build) |
| 5 | `getJiraIssueRemoteIssueLinks`             | ticket.md:54                       | `GET /rest/api/3/issue/{issueIdOrKey}/remotelink`                          | folded into `get(key).links` field            |
| 6 | `getTransitionsForJiraIssue`               | planning.md:11                     | `GET /rest/api/3/issue/{issueIdOrKey}/transitions?expand=transitions.fields` | `list_transitions(key) -> list[Transition]`  |
| 7 | `transitionJiraIssue`                      | planning.md:11                     | `POST /rest/api/3/issue/{issueIdOrKey}/transitions`                        | `transition(key, transition_id, fields) -> TransitionResult` |

JQL used:
- assigned filter: `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`
- subtasks: `parent = <KEY>`
- linked: `issue in linkedIssues(<KEY>)`

## Tracker Protocol surface NOT exercised by jira-workflow

These are required by the Tracker Protocol for cross-backend parity. No reference
in jira-workflow — implemented from Atlassian REST API v3 docs + Agile REST API.

| Protocol method            | REST endpoint                                                                  | Notes |
|----------------------------|--------------------------------------------------------------------------------|-------|
| `create`                   | `POST /rest/api/3/issue`                                                        | Body: `fields: {project, issuetype, summary, description (ADF), parent, labels, assignee, priority}`. |
| `set_summary`              | `PUT /rest/api/3/issue/{key}` `{fields:{summary}}`                              | replaces dropped generic `edit` |
| `set_description`          | `PUT /rest/api/3/issue/{key}` `{fields:{description: <ADF>}}`                   | ADF when capability `comments_adf=true` |
| `set_priority`             | `PUT /rest/api/3/issue/{key}` `{fields:{priority:{name}}}`                      | |
| `set_labels`               | `PUT /rest/api/3/issue/{key}` `{fields:{labels:[...]}}`                         | |
| `set_assignee`             | `PUT /rest/api/3/issue/{key}/assignee` `{accountId}`                            | |
| `comment(body)`            | `POST /rest/api/3/issue/{key}/comment` `{body: <ADF>}`                          | ADF v3 required |
| `link(from,to,kind)`       | `POST /rest/api/3/issueLink` `{type:{name:kind}, inwardIssue, outwardIssue}`    | kind ∈ {`Blocks`, `Relates`, `Depends`, ...} |
| `state(key)`               | `GET /rest/api/3/issue/{key}?fields=status,resolution`                          | derives `TicketState` with normalized + diagnostic |
| `project_requires_pr()`    | `GET /rest/api/3/workflow/search?projectKey=<P>&expand=transitions.rules` (workflow scheme) | flag iff any transition to Done category has linked-PR validator. **Conservative default = False** if endpoint unauthorized. |
| `is_shipped(key)`          | PURE READ: frozen `.flow/<ns>/ship-events/<key>.json` → return shipped; else `state()` + ship predicate | adapter MUST NOT write |
| `set_sprint(key, sprint_id)` | `POST /rest/agile/1.0/sprint/{sprintId}/issue` `{issues:[key]}`                | capability: `sprints` |
| `list_sprints(project)`    | `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future,closed` (needs board lookup) | capability: `sprints` |
| `add_watcher(key, account_id)` | `POST /rest/api/3/issue/{key}/watchers` `"<accountId>"`                     | capability: `watchers` |
| `set_fix_versions(key, versions)` | `PUT /rest/api/3/issue/{key}` `{fields:{fixVersions:[{name}...]}}`        | capability: `fix_versions` |
| `set_components(key, components)` | `PUT /rest/api/3/issue/{key}` `{fields:{components:[{name}...]}}`         | capability: `components` |
| `set_epic_link(key, epic_key)` | `PUT /rest/api/3/issue/{key}` `{fields:{parent:{key:epic_key}}}` (Jira Cloud unified parent) | capability: `epic_link` |
| `board_rank(key, after_key)` | `PUT /rest/agile/1.0/issue/rank` `{issues:[key], rankAfterIssue:after_key}`   | capability: `boards` |
| `set_custom_field(key, field_key, value, schema)` | `PUT /rest/api/3/issue/{key}` `{fields:{<customfield_id>: ...}}` | capability: `custom_fields` — `field_key` is the schema-named alias, adapter resolves to `customfield_NNNNN` |
| `get_attachments(key)`     | `GET /rest/api/3/issue/{key}?fields=attachment`                                 | capability: `attachments` |
| `upload_attachment(key,p)` | `POST /rest/api/3/issue/{key}/attachments` (multipart, `X-Atlassian-Token: no-check`) | capability: `attachments` |

## Capabilities advertised by JiraAdapter

Closed enum (`tracker.py:CAPABILITY_ENUM`). All `supported=true` for Jira Cloud:

```
comments_adf=true, comments_markdown=false, attachments=true, watchers=true,
sprints=true, fix_versions=true, components=true, epic_link=true,
pr_links=true, ci_links=true, boards=true, custom_fields=true,
transitions_with_validators=true, resolutions=true
```

`comments_markdown=false` is intentional. Jira Cloud's comment API requires ADF;
markdown round-trips lose formatting. Callers MUST send either:

- `Content{fmt="adf"}` — body is a pre-built ADF JSON string. Adapter parses + sends as-is.
- `Content{fmt="plain"}` — adapter wraps as single-paragraph ADF: `{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":body}]}]}`.

`Content{fmt="md"}` is REJECTED with `NotSupported("markdown not supported by Jira; use fmt=adf or fmt=plain")`. No heuristic md→ADF conversion; richer markdown silently breaks in Jira UI without errors, so we refuse rather than guess.

## Status normalization mapping

`TicketState.normalized` is derived from Jira's `status.statusCategory.key` (the
3-bucket category: `new` / `indeterminate` / `done`) combined with native status
string heuristics:

| Jira statusCategory.key | Jira native status (case-insensitive) | NORMALIZED_STATES |
|-------------------------|---------------------------------------|--------------------|
| `new`                   | *                                     | `open`             |
| `indeterminate`         | contains "block" / "hold" / "wait"    | `blocked`          |
| `indeterminate`         | contains "review" / "qa" / "merge"    | `in_review`        |
| `indeterminate`         | *                                     | `in_progress`      |
| `done`                  | resolution == "Won't Do" / "Cancelled" / "Duplicate" / "Won't Fix" | `cancelled` |
| `done`                  | *                                     | `done`             |

`adapter_mapping_diagnostic` records which rule fired (e.g.
`"category=indeterminate + native='In Review' matched in_review heuristic"`)
so dashboards can audit unexpected categorizations.

## Authentication

**Basic auth with API token**, per user decision. Adapter reads:

- `ATLASSIAN_EMAIL` — Atlassian account email (the username for basic auth)
- `ATLASSIAN_API_TOKEN` — token from `https://id.atlassian.com/manage-profile/security/api-tokens`

Auth header: `Authorization: Basic base64(email:token)`.

Adapter raises `TrackerConfigError` at construction if either env var is missing
or empty.

`cloud_id` is taken from `workspace.toml` ([tracker.jira].cloud_id) — cached at
init time via `getAccessibleAtlassianResources`. Not re-queried per request.

## HTTP error → exception / TransitionResult mapping

All `_request()` responses flow through one classifier. This table is the
contract — every Jira REST call returns one of these outcomes.

| Status | Endpoint family            | Body signal                                                | Outcome                                                                                  |
|--------|----------------------------|------------------------------------------------------------|------------------------------------------------------------------------------------------|
| 2xx    | any                        | —                                                          | success — return parsed JSON                                                             |
| 401    | any                        | —                                                          | raise `TrackerConfigError("invalid credentials: check ATLASSIAN_EMAIL/ATLASSIAN_API_TOKEN")` |
| 403    | `/transitions` (POST)      | —                                                          | return `TransitionResult{success=False, failure_kind="permission_denied", failure_detail=msg}` |
| 403    | other                      | —                                                          | raise `TrackerError("forbidden: {endpoint}: {msg}")`                                     |
| 404    | `/issue/{key}` (any)       | —                                                          | raise `TrackerError("ticket not found: {key}")`                                          |
| 404    | other                      | —                                                          | raise `TrackerError("endpoint not found: {path}")`                                       |
| 400    | `/transitions` (POST)      | `errorMessages` contains "transition" + "not valid"        | return `TransitionResult{failure_kind="wrong_source_state"}`                             |
| 400    | `/transitions` (POST)      | `errors` has required-field keys                           | return `TransitionResult{failure_kind="missing_required_field", failure_detail=keys}`    |
| 400    | `/transitions` (POST)      | `errorMessages` contains "validator" / "validation"        | return `TransitionResult{failure_kind="validator_failed"}`                               |
| 400    | `/transitions` (POST)      | other 400                                                  | return `TransitionResult{failure_kind="validator_failed", failure_detail=raw_message}` (catch-all) |
| 409    | mutation (PUT/POST)        | —                                                          | raise `TrackerError("conflict: {body}")` — caller writes to `pending-mutations.jsonl`    |
| 429    | any                        | `Retry-After` header                                       | sleep + retry up to 3× then raise `TrackerError("rate-limited after 3 retries")`         |
| 5xx    | any                        | —                                                          | retry up to 2× (exponential 1s/3s); raise `TrackerError("upstream 5xx: {status}")` if persists |

`ambiguous_transition` is a CLIENT-side classification: when `list_transitions()`
returns multiple entries sharing the same `name`, callers see them all and MUST
select by id. If a caller passes a `name` that resolves to >1 id, that's a
client-side error; the Protocol contract is strictly id-keyed (see tracker.py
docstring for `Transition.id`). The Jira REST call itself never reports
"ambiguous_transition" — it just runs whichever id was sent.

Status normalization to `TransitionFailureKind` happens in
`_classify_transition_error(response_json) -> TransitionFailureKind`. Regex
patterns for 400-body signal detection:

```python
_RE_WRONG_SOURCE  = re.compile(r"(?i)\btransition\b.*\b(not valid|invalid|cannot be applied)\b")
_RE_VALIDATOR     = re.compile(r"(?i)\bvalidat(or|ion)\b.*\b(fail|error|reject)\b")
_RE_REQUIRED_HINT = re.compile(r"(?i)\b(required|must be)\b")
```

`errors` dict (key-by-fieldname) takes precedence over `errorMessages` list
when both are present — `errors` is structured and unambiguously identifies
missing fields.

## Board strategy for `list_sprints(project)`

Jira sprints belong to boards, not projects. Adapter resolves:

1. `GET /rest/agile/1.0/board?projectKeyOrId={project}&type=scrum`
2. Pick the **first active scrum board** returned.
3. `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future,closed&maxResults=50`

If step 1 returns zero boards → raise `NotSupported("no scrum board configured for project={project}")`.
If multiple boards exist → adapter picks first, logs a diagnostic. Callers
needing deterministic board selection should set `tracker.jira.board_id` in
`workspace.toml` (future enhancement; not phase 3).

## Epic link strategy

`set_epic_link` uses the team-managed (next-gen) shape:

```
PUT /rest/api/3/issue/{key}  body: {"fields": {"parent": {"key": epic_key}}}
```

If the Jira project is **classic / company-managed**, the field name is
`customfield_10014` (legacy Epic Link). Adapter probes project style at first
`set_epic_link` invocation:

- `GET /rest/api/3/project/{projectKey}` → `style` field: `"next-gen"` vs `"classic"`
- Cache result on the adapter instance.
- For classic: emit `customfield_10014` payload instead.

This handles both project styles without forcing users to know which they're on.

## `.flow-bundle.toml` schema (phase 4)

External plugins declare which flow stages they provide handlers for via a top-
level `.flow-bundle.toml`. `bundle-discover.py` walks `~/.claude/plugins/*/` and
`<repo>/.claude/plugins/*/` (override: `FLOW_BUNDLE_SEARCH_ROOTS`, colon-separated)
and parses each manifest. Schema:

```toml
schema_version = 1     # closed enum: { 1 }; mismatch = invalid (warning unless --select)

[bundle]
name        = "ship-it"   # bundle slug, used by --bundle-name selectors
description = "Push branch + open draft PR + CI loop"

# One [skills.<stage>] table per stage the bundle provides. `stage` MUST be a
# closed-vocabulary flow stage (ticket | plan | implement | code_review | e2e |
# commit | create_pr | review_loop | reflect). Unknown stages = invalid manifest.
[skills.create_pr]
handler_string         = "skill:ship-it:create"   # required; MUST start with "skill:"
required_capabilities  = []                       # optional, list[str]; CAPABILITY_ENUM names
args_schema            = {}                       # optional, dict; opaque, validated by skill
required_outputs       = ["pr_url"]               # optional, list[str]
side_effects           = ["git push", "gh pr create"]   # optional, list[str]
stage_compatibility    = ["create_pr"]            # optional, list[str]; cross-check vs stage roles

[skills.review_loop]
handler_string = "skill:ship-it:feedback"
```

### Discovery contract

| Condition                                       | Result                                         |
|-------------------------------------------------|------------------------------------------------|
| Manifest absent                                 | not discovered; not an error                   |
| Manifest parses + schema valid                  | listed in `valid`                              |
| Manifest invalid + UNRELATED to selected bundle | listed in `invalid` (warning; `cli_main` exit 0)|
| Manifest invalid + IS the `--select`ed bundle   | `cli_main` exit 2; init.py exit 1              |
| Two valid manifests advertise the same stage    | listed in `duplicates`; `recommended` refuses  |

### Composition rules

- **bare**: every stage in `pipeline.stages` uses `stage-registry.toml`'s
  `default_handler`. Always available.
- **recommended**: discovered manifests' `handler_string` values override the
  defaults for every stage they advertise. Two-provider conflict on ANY stage
  rejects the whole `recommended` choice (caller must use `--bundle custom` to
  disambiguate). Day-1 design choice: don't try to auto-rank conflicting
  providers — surface the conflict.
- **custom**: caller supplies `--handler <stage>=<handler_string>` flags. Init
  validates handler strings against the closed grammar
  (`inline | none | subagent:<type> | skill:<name>[:<args>]`) and rejects
  unknown stages.

### Transactional bootstrap markers

| File                          | Lifecycle                                                  |
|-------------------------------|------------------------------------------------------------|
| `.flow/.initializing`         | created BEFORE any mutation; left in place on failure      |
| `.flow/.init-progress`        | append-only JSONL of completed phases; consumed by --resume |
| `.flow/.initialized`          | atomic rename from `.initializing` ONLY after postconditions pass |
| `~/.config/flow/checkpoint-manifest.jsonl` | append-only ledger of participating workspaces (one line per init / reconfigure) |

Pre-flight refusal:

| Marker state                        | Default behavior        | Override            |
|-------------------------------------|-------------------------|---------------------|
| `.initialized` present              | exit 4 (`InitPreflightError`) | `--reconfigure`     |
| `.initializing` present (no marker) | exit 4 (`InitPreflightError`) | `--resume` or `--reconfigure` |

### Postconditions (verified before atomic rename)

1. `.flow/workspace.toml` parses as valid TOML.
2. `[tracker]` block has `backend` matching the chosen backend.
3. `[pipeline.stages]` matches the computed stage list (drops `reflect` iff
   `memory.compounding = false`).
4. `[pipeline.handlers]` contains an entry for every stage in
   `[pipeline.stages]`.
5. `[memory]` block has `namespace`, `compounding`, `auto_recall`, `recall_by`,
   `recall_top_n`.
6. For backend=beads: `bd ready --json` returns parseable JSON.

## Beads CLI surface (phase 6)

`bd` is the local-only beads tracker (v1.0.4). JSON output is supported globally
via `--json`. Adapter wraps a subprocess runner; tests inject a fake.

### Subcommands used by BeadsAdapter

| bd subcommand           | flags used                                         | --json | mutates | Protocol method(s)                          |
|-------------------------|----------------------------------------------------|--------|---------|---------------------------------------------|
| `bd version`            | —                                                  | ✗      | ✗       | constructor preflight                       |
| `bd show <key>`         | `--json`                                           | ✓      | ✗       | `get`, `state`, `is_shipped`, post-write verify |
| `bd list`               | `--status`, `--assignee`, `--json`                 | ✓      | ✗       | `list_assigned`                             |
| `bd dep list <key>`     | `--json`                                           | ✓      | ✗       | `list_linked`                               |
| `bd create`             | `--title`, `--description`, `--type`, `--parent`, `--labels`, `--assignee`, `--json` | ✓ | ✓ | `create` |
| `bd update <key>`       | `--title`, `--description`, `--labels`, `--assignee`, `--status` | ✗ | ✓ | setters, `transition` (non-close) |
| `bd close <key>`        | —                                                  | ✗      | ✓       | `transition` to closed                      |
| `bd reopen <key>`       | —                                                  | ✗      | ✓       | `transition` to open from closed            |
| `bd priority <key> <n>` | —                                                  | ✗      | ✓       | `set_priority`                              |
| `bd comment <key>`      | `--stdin`                                          | ✗      | ✓       | `comment` (markdown via stdin)              |
| `bd dep add <a> <b>`    | `--type`                                           | ✗      | ✓       | `link`                                      |
| `git log`               | `--grep=<key>`, `--pretty=format:%H`, `-n 1`       | ✗      | ✗       | `is_shipped` evidence probe (read-only)     |

### State normalization

| bd native      | NORMALIZED_STATES |
|----------------|-------------------|
| open           | open              |
| in_progress    | in_progress       |
| blocked        | blocked           |
| deferred       | cancelled         |
| closed         | done              |

Unknown natives default to `open` with an `adapter_mapping_diagnostic` flagging
the fallback so dashboards can surface the unfamiliar status.

### Transition synthesis

bd has no `list_transitions` subcommand; the workflow is "any state → any other
state". Adapter advertises the legal target set per current native status:

| current native | available targets                 |
|----------------|-----------------------------------|
| open           | in_progress, blocked, closed      |
| in_progress    | open, blocked, closed             |
| blocked        | open, in_progress, closed         |
| deferred       | open, closed                      |
| closed         | open  (via `bd reopen`)           |

`Transition.id` is `"bd:to:<target>"`. The `transition` method routes:
- `bd:to:closed` → `bd close <key>`
- `bd:to:open` from `closed` → `bd reopen <key>`; otherwise `bd update --status open`
- everything else → `bd update --status <target>`

Postcondition: re-read `bd show --json` and assert the normalized state moved
to the requested target.

### Stderr → failure_kind classification

| stderr pattern                         | TransitionFailureKind |
|----------------------------------------|-----------------------|
| `Error: no beads database found`       | wrong_source_state    |
| `Error: issue not found`               | wrong_source_state    |
| `permission denied` / `forbidden`      | permission_denied     |
| anything else (non-zero exit)          | validator_failed      |

### Capability advertisement

14 entries; only `comments_markdown` (bd accepts markdown via `bd comment
--stdin`) and `resolutions` (bd records `closure_reason` on `bd close`) flip
true. Every other capability is false → `set_sprint`, `add_watcher`,
`set_fix_versions`, `set_components`, `set_epic_link`, `board_rank`,
`set_custom_field`, `get_attachments`, `upload_attachment` raise
`NotSupported`.

### is_shipped contract (PURE READ; never writes under `.flow/`)

1. `bd show <key> --json`.
2. If `status != closed` → `not_shipped` (evidence None, source none).
3. If closed:
   - `git log --grep=<key> --pretty=format:%H -n 1`.
   - Commit found → `not_yet_observed` (evidence has tracker, status,
     commit_sha, closure_reason, closed_at; source `live_backend_query`).
   - No commit → `indeterminate` (evidence has tracker, status, commit_sha=null;
     source none).
4. Workspace's `observe-ship-event.py` (phase ≥7) is the writer that promotes
   `not_yet_observed` into a frozen `<key>.json` ship-event record. Adapter
   never returns `state="shipped"` — that's the frozen-file reader's domain.

### Transient-failure handling (deferred to phase 8)

Plan line 990 calls for transient `bd` failures (network blips, lock
contention) to append to `.flow/pending-mutations.jsonl` so `/flow sync` can
retry. `pending-mutations.py` is phase-8 work; the adapter currently surfaces
the error as `_BeadsError(TrackerError)` and lets the dispatcher (phase 7)
decide.

## Out-of-scope for phase 3

- `comments_markdown=true` (Jira would need a separate markdown wrapper; ADF
  satisfies all current call sites).
- Webhook subscription / live event push (the plan's ship-event observer is the
  workspace's job, not the adapter's).
- Bulk operations (`bulkCreateIssue`, `bulkEditIssues`). Adapter sticks to
  single-issue endpoints; the dispatcher batches client-side.
- Jira Server / Data Center (Cloud only — REST v3 + agile/1.0 differs on-prem).
