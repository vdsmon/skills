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

Templates are source-of-truth shape. Idempotent; safe to re-run.

```!
set -eu
SRC="${CLAUDE_SKILL_DIR}/../../templates"
if [ ! -d "$SRC" ]; then
  echo "ERROR: plugin templates missing at $SRC" >&2
  exit 1
fi
if [ ! -d "tasks/_templates" ]; then
  mkdir -p tasks/_templates tasks/epics
  cp "$SRC/EPIC.md" tasks/_templates/EPIC.md
  cp "$SRC/STORY.md" tasks/_templates/STORY.md
  cp "$SRC/README.md" tasks/_templates/README.md
  echo "bootstrapped tasks/_templates/ from plugin defaults"
fi
ls tasks/_templates/ 2>/dev/null
```

Then read `tasks/_templates/EPIC.md`, `STORY.md`, `README.md` in that order. Templates are project-customizable — never hardcode field lists; always read from the templates.

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

**Question construction rules:**

- **Single-select** when options are mutually exclusive (one branch protection profile, one license, one storage backend).
- **Multi-select** ONLY when options genuinely combine (audit checks: secret scan + LICENSE + README polish can all run together).
- **Never mix "skip / none" with positive options in multi-select** — the user can pick contradictory combinations ("skip + add LICENSE"). Either: make it single-select with "skip" as one option, OR split into a yes/no gating question first ("audit at all?") followed by the multi-select.
- **Use previews on AskUserQuestion options** when the choice has a visible artifact (file layout, dashboard format, API payload shape, generated commit subject). Previews close the loop on "what does this actually look like" — saves a round-trip.
- **Don't ask defaults that can be sourced from project state.** See step 3b (Source defaults).

### 3. Architecture sketch

Draft in-message (not yet in a file). Include:

- **Contracts touched** — shared surfaces multiple stories will read or modify. Common: env-variable contracts, manifest schemas, plugin protocols, shared config files. Identify owner story per contract (one story defines or extends; others consume).
- **Append-only / shared surface** — files where every consuming story appends a block (e.g. `mise.toml`, GitHub workflow files, `README.md` sections). These force serial dispatch.
- **Anticipated extensions** — refactors visible at epic-time that should land ONCE upfront, not as N drive-by extensions during dispatch. This is the highest-leverage part — call out what would otherwise get re-edited 3 times.

### 3b. Source defaults from project state — NEVER fabricate

Before proposing any default value in the architecture sketch (copyright names, email addresses, repo descriptions, organization slugs, file paths, version numbers, dates, owner labels), check the project for the canonical source. Common sources, in priority order:

| Default needed | Where to check |
|---|---|
| Author / copyright name | `git config user.name` → `gh api user --jq .name` → `gh api user --jq .login` |
| Author email | `git config user.email` |
| Repo description | `gh api repos/<owner>/<name> --jq .description` (null = need to write one) |
| Repo URL / owner | `git remote get-url origin` |
| Project slug | basename of repo root |
| Current date | `date -u +%Y-%m-%d` |
| Required toolchain versions | `mise.toml`, `pyproject.toml`, `package.json`, `go.mod`, etc. |
| License | existing `LICENSE` file, or `gh api repos/<owner>/<name>/license` |

Fabricating a default is a spec defect. The user catches it during the preview step (step 6) and the round-trip cost is wasted. If a value genuinely has no canonical source (e.g. a brand-new feature name), surface it as an `Open question` in the architecture sketch — don't guess.

### 4. Decompose into stories

Frontmatter shape is whatever `tasks/_templates/STORY.md` defines — read it; don't hardcode. As of this writing the template fields are: `id`, `title`, `status` (starts `pending`), `size`, `depends_on`, `epic`, `parallel_cluster` (omit for epic-grouped stories), `agent_type`, `priority`, `estimated_minutes`.

Sections per the template:

- `## Goal` — one paragraph
- `## Files` — every file the story creates / edits / appends. Orchestrator uses this for collision avoidance. `None — <reason>` for pure-infrastructure stories.
- `## Acceptance` — shell-runnable commands. Each `<command>` exits 0 / prints `<expected>`. End-state assertions only, not process metrics.
- `## Human handoff` (optional) — only for `orchestrator-direct` stories. Numbered steps user performs.
- `## Notes` — guidance, anti-goals, gotchas, process constraints (iteration ceilings live HERE, not in Acceptance).
- `## Blocker` and `## Retry notes` — orchestrator-appended at runtime; spec phase never writes these.

Sizing rule: a `cavecrew-builder` story should declare ≤2 entries in `## Files`. 3+ files → either split, or promote `agent_type` to `general-purpose`. The cavecrew-builder subagent refuses large multi-file dispatches.

**Preconditions discipline.** When a story uses external tooling not guaranteed by the project's default dev env (`gitleaks`, `gcloud`, `aws`, `npm publish`, etc.) or needs specific auth scopes / secrets, add a `## Preconditions` section to the story file with one bullet per checkable precondition. The orchestrate skill's pre-flight uses this section (per orchestrate's "per-story external-service tooling check" rule) to fail-fast before a wasted dispatch hits a remote service. Without this section the orchestrator has to grep `## Notes` heuristically, which is unreliable.

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

Wait for user nod. Iterate before writing.

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

- Skipping the architecture sketch — leads to 3 stories independently extending the same file (e.g. `run_scenario.sh` mode-dispatch), paying integration cost N times. Land shared refactors ONCE upfront.
- Writing stories before user nod — sunk-cost on a flawed decomposition.
- Subjective acceptance ("code is clean", "tests pass") — push to manual review, NOT into the `## Acceptance` block.
- Inventing new frontmatter fields — only fields documented in `tasks/_templates/STORY.md` are valid. Want a new field? Update the template first, project-wide.
- One-shot tasks dispatched through spec — this skill is for multi-story epics. Single tasks go straight to dispatch.
- Telemetry / observation stories that read sibling-story output without owning a contract on it — caller of the contract must point at fixtures the contract guarantees, not at incidental on-disk state. Otherwise the story produces empty results when run standalone.
- Assigning `cavecrew-builder` to a 3+ file story — agent refuses. Either split, or use `general-purpose`.
- Spec'ing a story whose Files / Acceptance depends on the subagent invoking another skill (e.g. "subagent runs `/humanize:humanize` against README.md"), without confirming the subagent has access to that skill. Subagent skill availability depends on the parent's invocation context. Two safer patterns: (a) inline the skill's logic into the story's prompt (paste the canonical pattern from the skill's SKILL.md body), or (b) move the cross-skill step to a separate `orchestrator-direct` story where the parent (not subagent) invokes the skill. Default to (a) for prose passes (humanize, security-review) and (b) for skills with mandatory user interaction.

## Final output

A committed `tasks/epics/E<NN>-<slug>.md` + N committed `tasks/T<NN>-<slug>.md` files + an updated `tasks/README.md` index. User can now invoke `/tasks:orchestrate` to dispatch.
