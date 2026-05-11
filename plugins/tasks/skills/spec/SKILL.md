---
name: spec
description: >-
  Spec phase of the tasks plugin. Takes a high-level epic statement and breaks
  it into atomic stories with `depends_on` + shell-runnable acceptance. Writes
  `tasks/epics/E<NN>-<slug>.md` + `tasks/T<NN>-<slug>.md` files using the
  shared templates. Includes architecture sketch with contracts-touched +
  append-only-files awareness so downstream dispatch knows what to serialize.
when_to_use: >-
  Use when the user says "/tasks:spec", "spec out a new epic", "break this
  down into stories", "decompose this feature", "draft tasks for X", or
  brings a feature goal that obviously needs multi-story decomposition. Also
  trigger when the user has an idea sketch and wants atomic tasks before
  dispatching work to agents. Skip for one-shot edits — this skill is for
  multi-story epics, not single tasks.
argument-hint: "[<epic statement>]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Bash(find *)
  - Bash(grep *)
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git add *)
  - Bash(git commit *)
---

# tasks:spec

Spec phase. Epic statement → atomic stories with deps + shell-runnable acceptance, written to `tasks/`.

## Invocation

```
/tasks:spec [<epic statement>]
```

Examples:
- `/tasks:spec push branch + verify CI lanes to first-green`
- `/tasks:spec "scaffolder for new scenarios — scene + macro + manifest + baseline + ASSETS row in one command"`
- `/tasks:spec` (no args → prompt user for the epic)

Empty `$ARGUMENTS` → ask user for the epic statement before proceeding.

## Bootstrap

Before any spec work, ensure templates are in place. Templates are the source-of-truth shape for epics + stories.

```!
if [ ! -d "tasks/_templates" ]; then
  mkdir -p tasks/_templates tasks/epics
  cp "${CLAUDE_SKILL_DIR}/../../templates/EPIC.md" tasks/_templates/EPIC.md
  cp "${CLAUDE_SKILL_DIR}/../../templates/STORY.md" tasks/_templates/STORY.md
  cp "${CLAUDE_SKILL_DIR}/../../templates/README.md" tasks/_templates/README.md
  echo "bootstrapped tasks/_templates/ from plugin defaults"
fi
ls tasks/_templates/ 2>/dev/null
```

After bootstrap: read `tasks/_templates/EPIC.md`, `STORY.md`, `README.md` (in that order) to internalize the current shape. Templates are project-customizable — never hardcode field lists; always read from the templates.

## Workflow

### 1. Receive epic

Take `$ARGUMENTS` as the epic statement. If empty, ask the user. The statement should describe a goal — one sentence to one paragraph. Reject if it's a single-line "fix bug X" — that's a one-story task, not an epic.

### 2. Clarify (2–5 questions, skip if unambiguous)

Use `AskUserQuestion` to resolve ambiguities BEFORE drafting the architecture sketch. Common ambiguities:

- Scope boundary — what's out of scope?
- Platform / target constraints — macOS only? Linux + Windows?
- External-system dependencies — API keys, secrets, accounts needed?
- Bar for "done" — first green / N greens / parity-checked?
- Failure handling — iterative push vs clean cut?

If the epic statement already answers these, skip. Don't ask for the sake of asking.

### 3. Architecture sketch

Draft in-message (not yet in a file). Include:

- **Contracts touched** — shared surfaces multiple stories will read or modify. Common: env-variable contracts, manifest schemas, plugin protocols, shared config files. Identify owner story per contract (one story defines or extends; others consume).
- **Append-only / shared surface** — files where every consuming story appends a block (e.g. `mise.toml`, GitHub workflow files, `README.md` sections). These force serial dispatch.
- **Anticipated extensions** — refactors visible at epic-time that should land ONCE upfront, not as N drive-by extensions during dispatch. This is the highest-leverage part — call out what would otherwise get re-edited 3 times.

### 4. Decompose into stories

Atomic stories with frontmatter per `tasks/_templates/STORY.md`:

- `id: T<NN>` — next free ID in the project
- `depends_on: [...]` — strict deps; orchestrator uses this for DAG
- `epic: E<NN>` — link to the epic file
- `agent_type: cavecrew-builder | general-purpose | orchestrator-direct`
- `priority: normal | high` — optional; flags de-risk-first stories
- `size: S | M | L`
- `estimated_minutes: N`

Each story gets:

- `## Goal` — one paragraph
- `## Files` — every file the story creates / edits / appends. Orchestrator uses this for collision avoidance. `None — <reason>` for pure-infrastructure stories.
- `## Acceptance` — shell-runnable commands. Each `<command>` exits 0 / prints `<expected>`. End-state assertions only, not process metrics.
- `## Notes` — guidance, anti-goals, gotchas, process constraints (iteration ceilings live HERE, not in Acceptance).
- `## Human handoff` (optional) — for `orchestrator-direct` stories. Numbered steps user performs.
- `## Blocker` (only when status:blocked) — populated by agent when stuck.

### 5. Collision audit

Before writing files, walk the proposed story list and identify:

- Which pairs touch the same files in `## Files` → serialize.
- Which stories touch append-only surfaces (`mise.toml`, workflow files, shared docs) → serial unless those surfaces have ZERO overlap between the appending stories (usually they don't).
- Which `agent_type` is appropriate per story:
  - `cavecrew-builder` for 1–2 file surgical edits
  - `general-purpose` for multi-file, self-acceptance-running work
  - `orchestrator-direct` for interactive flows, secret handling, coordination work

### 6. Preview + confirm

Present the decomposition in-message BEFORE writing files:

- Epic shape (goal, constraints, out-of-scope)
- Story table (id, title, size, deps, agent_type)
- DAG diagram (ASCII)
- Collision audit summary
- Open questions remaining

Get user nod. Push back is normal — iterate before writing.

### 7. Write files + commit

After nod:

- Write `tasks/epics/E<NN>-<slug>.md`
- Write `tasks/T<NN>-<slug>.md` for each story
- Update `tasks/README.md` with the new epic section + story rows
- Single commit: `E<NN>: <epic slug> + N-story decomposition`

Status starts at `pending` for every new story. Spec phase NEVER flips status to `in-progress` or `done` — that's orchestrate's job.

## Constraints

- Templates are the source-of-truth shape. Read them; don't hardcode the field list.
- Stories without machine-checkable (or structurally-proxied) acceptance get refused — push back to the user.
- "Atomic" ≠ "small". A 200-line single-file story is atomic. A 30-line story touching 5 cross-cutting files is NOT — flag for refactor.
- Process constraints (iteration ceilings, retry budgets, max-runtime) live in `## Notes`, never `## Acceptance`.
- `## Human handoff` content carries sensitive instructions (tokens, secrets) — never leak into subagent prompts at dispatch time. The orchestrate skill handles this; spec just writes the section faithfully.

## Anti-patterns

- Skipping the architecture sketch — leads to 3 stories independently extending the same file, paying integration cost 3 times.
- Writing stories before user nod — sunk-cost on a flawed decomposition.
- Subjective acceptance ("code is clean", "tests pass") — push to manual review, NOT into the `## Acceptance` block.
- Inventing new frontmatter fields — only fields documented in `tasks/_templates/STORY.md` are valid. Want a new field? Update the template first, project-wide.
- One-shot tasks dispatched through spec — this skill is for multi-story epics. Single tasks go straight to dispatch.

## Final output

A committed `tasks/epics/E<NN>-<slug>.md` + N committed `tasks/T<NN>-<slug>.md` files + an updated `tasks/README.md` index. User can now invoke `/tasks:orchestrate` to dispatch.
