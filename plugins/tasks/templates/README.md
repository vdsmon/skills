# Task templates

Source-of-truth shape for epics + stories. Two files:

- `EPIC.md` — one feature/goal. Holds the architecture sketch + contract map.
- `STORY.md` — one atomic deliverable. Bounded blast radius, machine-checkable acceptance.

## Layout

```
tasks/
├── epics/
│   ├── E01-<slug>.md     # one per epic
│   └── E02-<slug>.md
├── T01-<slug>.md         # one per story (flat; epic ID in frontmatter)
├── T02-<slug>.md
├── ...
└── README.md             # human-readable index across all epics+stories
```

Stories stay flat (no per-epic subdirs) so dependency graph traversal is one `find tasks -name 'T*.md'`. The `epic:` frontmatter field groups them when needed.

## Status state machine

| status | meaning |
| --- | --- |
| `draft` | epic only — still being shaped, no stories yet |
| `pending` | story or epic ready for work; deps satisfied if applicable |
| `in-progress` | currently owned by an agent. Reserved state — current orchestrator implementation goes `pending` → `done` directly; do not set by hand. |
| `done` | merged; downstream unblocked |
| `blocked` | could not complete; see `## Blocker` section |
| `wontfix` | resolved by decision, not implementation |

## Two-phase workflow

### Phase 1 — spec (`/tasks:spec`)

1. User brings an epic statement (goal + constraints + out-of-scope).
2. Orchestrator (Claude) asks 2–5 clarifying questions; skips if unambiguous.
3. Drafts architecture sketch — contracts touched, append-only files, anticipated extensions.
4. Decomposes into atomic stories with `depends_on` + shell-runnable acceptance.
5. Collision audit — which stories parallelize, which serialize (file conflicts).
6. Writes `tasks/epics/E<NN>-<slug>.md` + `tasks/T<NN>-<slug>.md` files. Updates `tasks/README.md` index.

### Phase 2 — orchestrate (`/tasks:orchestrate`)

1. Read `tasks/T*.md` frontmatter. Compute ready set: `status == pending && every dep is done|wontfix`.
2. Compute parallel-safe batches from the ready set: stories that don't share `Files` entries can run in parallel. Append-only files force serial.
3. Pick batch size (3–4 max). Dispatch per agent_type rules (cavecrew-builder = files-only, parent commits; general-purpose = self-commits).
4. After each subagent returns: parent runs `## Acceptance` commands. On pass → flip status + commit. On fail → revert + add `## Retry notes`.
5. Loop until ready set is empty.

## Atomic ≠ small

Atomic = bounded blast radius + self-contained acceptance. A 200-line single-file story is atomic. A 30-line story touching 5 cross-cutting files is NOT — flag for refactor before dispatch.

## Acceptance discipline

Shell-runnable whenever possible. Three escape hatches:

- `[structural-only]` for unreachable runtime (CI workflows pre-push).
- `[mock-fixture]` for external APIs (use deterministic fixture).
- Push true subjectivity to manual review — NOT into the acceptance block.

**End-state only**: acceptance asserts the resulting shape, not the path
taken. "Total push-iterations ≤ 5" is a process metric — push it to
Notes. "`gh run list --status=success` returns ≥ 1 row" is an end-state
assertion — that goes in Acceptance.

Story without acceptance is a wish. Refuse to dispatch.

## Agent types

| agent_type | Who runs it | When to use |
| --- | --- | --- |
| `cavecrew-builder` | Subagent. Read/Edit/Write/Grep/Glob only — no Bash. | Surgical 1–2 file edit (hard cap; agent refuses on 3+ files). Parent runs acceptance + commits. |
| `general-purpose` | Subagent. Full toolset. | Multi-file work, acceptance scripting, self-commits. |
| `orchestrator-direct` | Orchestrator (main thread) itself, no subagent. | Stories requiring interactive user steps, secret handling, or coordination work that can't be safely delegated. |

## Human handoff stories

Some stories require interactive user action (browser auth, token paste,
manual workflow trigger). These get `agent_type: orchestrator-direct` +
a non-empty `## Human handoff` section listing the steps.

Orchestrator behavior: handle directly. Read the handoff steps, prompt
the user, run non-interactive shell follow-ups itself, verify
acceptance. NO subagent dispatch — subagents can't drive interactive
flows and shouldn't see secrets.

Mixed stories (mostly automated, one interactive step in the middle)
should still pick `orchestrator-direct` — the dispatch boundary is the
story, not individual acceptance items.

Keep handoff sections terse — numbered steps with exact commands.

## Deliver vs converge

Two shapes of story show up:

- **Deliver**: compute one delta. File edits, scaffold a script, write a
  config block. One dispatch, agent finishes, parent verifies. Bulk of
  stories.
- **Converge**: drive an iterative external process (watch a CI run,
  push fixes until green, poll an API until ready). Internal loop inside
  one dispatch. Agent stops when end-state matches or iteration ceiling
  hits → `## Blocker` written.

Both use the same template + frontmatter. Difference lives in `## Notes`:
converge stories document the iteration ceiling there. If dispatch
behavior eventually diverges (longer timeouts, larger budgets), add a
`kind: deliver | converge` frontmatter field then. Not now.
