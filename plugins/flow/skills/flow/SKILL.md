---
name: flow
description: Multi-tracker pipeline (Jira | beads) with pluggable per-stage handlers, immutable ship-event evidence, and a compounding memory layer fed by the reflect stage and recalled at SessionStart. Workspace-configurable stages via stage-registry.toml + workspace.toml.
when_to_use: User runs /flow init, /flow do <ticket>, /flow plan, /flow implement, /flow code_review, /flow e2e, /flow commit, /flow create_pr, /flow review_loop, /flow reflect, /flow recall, /flow status, /flow recover, /flow sync, or /flow baseline. Also use proactively when the user opens a worktree under a project that has .flow/.initialized present, to remind them of the pipeline verbs.
---

# /flow

Pipeline router. Tracker is pluggable (Jira | beads). Stages, handlers, memory namespace come from `.flow/workspace.toml` + `stage-registry.toml`.

This skill is currently a **skeleton** (build phases 1-4 + 6 + 7-mvp + 8-mvp + 8b-mvp of the implementation plan complete; phase 5 + 7-full + 8c/8d + 9-12 still pending). The tracker Protocol, factory, both adapters (Jira + beads), bundle discovery, transactional init wizard, minimum-viable dispatcher (state.py + validate_workspace.py + dispatch_stage.py), bookkeeping helpers (branch_ticket + ticket_frontmatter + lint_ticket + diff_extract + compose_commit), and the memory cohort (memory_append + recall + reflect_inputs + observe_ship_event) exist; SKILL.md MCP-call refactor, lease lifecycle + TOCTOU snapshot, recover.py, and the work-mode quality gate (`recall.py --metric`, pending-mutations, sync, baseline-collect, validate-postmortem) land in later phases.

## Verbs (planned surface)

`init`, `do`, `ticket`, `plan`, `implement`, `code_review`, `e2e`, `commit`, `create_pr`, `review_loop`, `reflect`, `recall`, `status`, `recover`, `sync`, `baseline`.

## Stages

Canonical stages live in `stage-registry.toml`. Workspaces pick a subset via `[pipeline] stages = [...]` in `.flow/workspace.toml`. Each stage maps to a handler string (`inline`, `subagent:<type>`, `skill:<name>[:<args>]`, or `none`).

## Memory layer

`.flow/<namespace>/knowledge.jsonl` — single-writer (`memory-append.py`), single-reader (`recall.py`). Six entry types: LEARNED, DECISION, FACT, PATTERN, INVESTIGATION, DEVIATION. SessionStart hook auto-recalls top-N entries by branch + open tickets.

## Status

Phases 1-4 + 6 + 7-mvp + 8-mvp + 8b-mvp complete: `plugin.json`, `stage-registry.toml`, `scripts/tracker.py` (Protocol + factory + types), `scripts/tracker_jira.py` (full JiraAdapter), `scripts/tracker_beads.py` (full BeadsAdapter), `scripts/bundle_discover.py` (`.flow-bundle.toml` schema v1 walker + validator), `scripts/init.py` (pure-CLI transactional workspace bootstrap), `scripts/state.py` (atomic per-ticket state.json r/w with flock + rolling backups + quarantine path), `scripts/validate_workspace.py` (HARD GATE schema validator), `scripts/dispatch_stage.py` (state-machine driver — `init` / `next` / `finish` / `status` subcommands; emits handler-descriptor JSON; pending → in_progress → completed | failed lifecycle; validate-workspace re-runs on every `next` as TOCTOU mvp invariant), the 8-mvp bookkeeping cohort: `scripts/branch_ticket.py`, `scripts/ticket_frontmatter.py`, `scripts/lint_ticket.py`, `scripts/diff_extract.py`, `scripts/compose_commit.py`, and the 8b-mvp memory cohort: `scripts/_memory_paths.py` (shared namespace + path resolution), `scripts/memory_append.py` (single-writer JSONL append with sha256 idempotency + sidecar quarantine), `scripts/recall.py` (hand-rolled BM25 ranker, --metric mode deferred to 8d), `scripts/reflect_inputs.py` (reflect-stage bundler), `scripts/observe_ship_event.py` (sole writer of ship-events via O_EXCL + dupe.n fallback + intent-log crash-safe). Lease lifecycle, canonical-snapshot TOCTOU, heartbeat hung-detection, recover.py, sync.py, baseline-collect, validate-postmortem = not yet built. Do not call verbs against this skill until SKILL.md prose is rewritten (phase 5).
