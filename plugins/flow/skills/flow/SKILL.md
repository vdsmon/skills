---
name: flow
description: Multi-tracker pipeline (Jira | beads) with pluggable per-stage handlers, immutable ship-event evidence, and a compounding memory layer fed by the reflect stage and recalled at SessionStart. Workspace-configurable stages via stage-registry.toml + workspace.toml.
when_to_use: User runs /flow init, /flow do <ticket>, /flow plan, /flow implement, /flow code_review, /flow e2e, /flow commit, /flow create_pr, /flow review_loop, /flow reflect, /flow recall, /flow status, /flow recover, /flow sync, or /flow baseline. Also use proactively when the user opens a worktree under a project that has .flow/.initialized present, to remind them of the pipeline verbs.
---

# /flow

Pipeline router. Tracker is pluggable (Jira | beads). Stages, handlers, memory namespace come from `.flow/workspace.toml` + `stage-registry.toml`.

This skill is currently a **skeleton** (build phases 1-4 of the implementation plan complete). The tracker Protocol, factory, JiraAdapter, bundle discovery, and transactional init wizard exist; BeadsAdapter, dispatcher, and memory layer land in later phases.

## Verbs (planned surface)

`init`, `do`, `ticket`, `plan`, `implement`, `code_review`, `e2e`, `commit`, `create_pr`, `review_loop`, `reflect`, `recall`, `status`, `recover`, `sync`, `baseline`.

## Stages

Canonical stages live in `stage-registry.toml`. Workspaces pick a subset via `[pipeline] stages = [...]` in `.flow/workspace.toml`. Each stage maps to a handler string (`inline`, `subagent:<type>`, `skill:<name>[:<args>]`, or `none`).

## Memory layer

`.flow/<namespace>/knowledge.jsonl` — single-writer (`memory-append.py`), single-reader (`recall.py`). Six entry types: LEARNED, DECISION, FACT, PATTERN, INVESTIGATION, DEVIATION. SessionStart hook auto-recalls top-N entries by branch + open tickets.

## Status

Phases 1-4 complete: `plugin.json`, `stage-registry.toml`, `scripts/tracker.py` (Protocol + factory + types), `scripts/tracker_jira.py` (full JiraAdapter — stdlib urllib, env-var auth, ADF-only comments, error-classification per `scripts/inventory.md`), `scripts/bundle_discover.py` (`.flow-bundle.toml` schema v1 walker + validator), `scripts/init.py` (pure-CLI transactional workspace bootstrap: `.flow/.initializing` → atomic rename to `.flow/.initialized` only after postconditions; `--resume` reads `.flow/.init-progress`; bundle compose handles bare/recommended/custom with conflict-refusal). BeadsAdapter, dispatcher, memory layer = not yet built. Do not call verbs against this skill until phase ≥7.
