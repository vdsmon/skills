---
id: E<NN>
title: <kebab-slug>
status: draft
created: <YYYY-MM-DD>
stories: []   # populated after decomposition: [T22, T23, T24]
---

## Goal

One sentence. What does this epic deliver? Drop "as a developer I want…"
boilerplate — say what gets built.

## Constraints

What must hold true while building this. Examples:

- Deterministic / reproducible
- Single-machine (no live services)
- No new top-level dependencies
- macOS-only for this pass; Linux/Windows follow-up

## Out of scope

What we explicitly will NOT do. Future-tasks bucket. Examples:

- Multi-tenant / multi-user
- Performance optimization beyond functional correctness
- UI polish

## Success criteria

Optional. Epic-level, measurable when possible. Examples:

- All generated stories ship and turn `tasks/T*.md` to `status: done` / `wontfix`
- `mise run scenarios` exits 0 on macOS host with cold cache

## Architecture sketch

### Contracts touched

Shared surfaces multiple stories interact with. Identify ownership upfront.

| Contract | Owner story | Consumer stories | Action |
|---|---|---|---|
| `tools/run_scenario.sh` env contract | T07 | T08, T14, T20 | extend |
| `tests/scenarios/SCHEMA.md` | T01 | T11, T14, T23 | extend |
| `tools/verifiers/<NN>-*.sh` plugin protocol | T07 | T10, T11, T14, T20 | obey |

### Append-only files (force serial dispatch)

Files where every consuming story appends a block. Concurrent edits collide;
orchestrator serializes:

- `mise.toml` (each `[tasks.*]` block)
- `project.godot` `[autoload]` (each new autoload)
- `AGENT_GUIDE.md` named sections

### Anticipated extensions

Refactors visible at epic-time that should land ONCE up-front, not as
N drive-by extensions during dispatch. Without this list you pay N times.

- run_scenario.sh mode-dispatch (visual / headless / video): own in ONE story
- Manifest schema fields: define ALL new fields in T01-equivalent before
  downstream stories consume them

## Open questions

Resolved before decomposition. Don't write stories with open questions in scope.

- [x] Q1 — resolved: …
- [ ] Q2 — still open
