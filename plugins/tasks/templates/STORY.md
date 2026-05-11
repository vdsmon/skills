---
id: T<NN>
title: <kebab-slug>
status: pending
size: S | M | L
depends_on: []                    # e.g. [T07, T01]
epic: E<NN>                       # omit if story is not part of an epic
parallel_cluster: tier-N          # tier-N batches for non-epic stories; omit for epic-grouped stories
agent_type: cavecrew-builder | general-purpose | orchestrator-direct
priority: normal                  # epic-stories only; "high" marks de-risk-first
estimated_minutes: 30
---

## Goal

One paragraph. What does this story deliver and why? Keep it tight. The
agent reads this first; if it's vague, the agent flounders.

## Files

Declare every file the story creates / edits / appends. The orchestrator
uses this for collision avoidance. Pure-infrastructure stories with no
file deltas write `None — <one-line reason>` instead.

- Create: `path/to/new_thing.ext` — one-line purpose
- Edit: `path/to/existing.ext` — what changes
- Append: `path/to/shared.ext` — what gets appended (flags this story as
  serial-dispatch on shared files)

## Preconditions (optional)

Tools, scopes, secrets, or environment state the orchestrator's pre-flight
must verify BEFORE dispatching this story. Each item is a check the parent
runs once at orchestrate time; failure = halt dispatch, surface to user.

- `gitleaks` binary on PATH (install: `brew install gitleaks`)
- `gh` auth token scope includes `workflow` (verify: `gh auth status` shows `workflow` in token scopes)
- `CLAUDE_CODE_OAUTH_TOKEN` repo secret exists (verify: `gh secret list --json name -q '.[] | .name' | grep -q '^CLAUDE_CODE_OAUTH_TOKEN$'`)

Most stories OMIT this section. Use it when the story depends on tooling /
scope / secret state not guaranteed by the standard dev env. Without this
section, the orchestrator has to grep `## Notes` heuristically for tooling
mentions — unreliable.

## Acceptance

Every item is shell-runnable OR explicitly marked `[structural-only]`.
Implementation is whatever makes acceptance pass — agents are NOT bound
to a specific approach as long as the acceptance commands exit cleanly.

1. `<exact command>` exits 0 / prints `<expected substring>`.
2. `<exact command>` produces `<exact artifact path>` with `<property>`.
3. [structural-only — runtime unreachable locally] `actionlint <file>` exits 0.
4. [mock-fixture] `VLM_MOCK=tests/fixtures/x.json <cmd>` exits 0.

Stories without machine-checkable (or structurally-proxied) acceptance
get refused at dispatch time.

## Human handoff (optional)

Present ONLY when the story requires interactive user action (browser auth,
secret paste, manual workflow trigger, physical device tap). Triggers
orchestrator-direct handling — no subagent dispatch — because subagents
can't drive interactive flows.

Shape: a numbered list of steps the user performs, with exact commands
where possible. The orchestrator prompts the user step-by-step, runs
non-interactive shell follow-ups (e.g. `gh secret set`), then verifies
acceptance.

Example:

1. User runs `claude setup-token` locally, copies the printed token.
2. Orchestrator runs `gh secret set CLAUDE_CODE_OAUTH_TOKEN --body "$token"`.
3. Orchestrator verifies via acceptance #1.

Most stories OMIT this section.

## Notes

Guidance, not contract. Use this to hand the agent context it would
otherwise re-derive (or get wrong).

- Anti-goals — what NOT to do
- Gotchas — known traps in the codebase
- Pointer reads — "look at T07's contract before writing this plugin"
- Non-obvious decisions — explain the why, not the what
- **Process constraints** (iteration ceilings, retry budgets) — these are
  agent instructions, NOT acceptance items. Acceptance asserts end-state
  only; process metrics ("≤ 5 pushes") belong here.

## Blocker (only present when status: blocked)

Filled by the agent if it cannot complete. Two shapes seen in the wild:

- **Stub** — parenthetical placeholder left when the story has an
  iteration ceiling that hasn't yet tripped (e.g. T31, T32).
- **Full** — when the block is real: what was attempted, why it failed,
  what needs to change before retry (schema extension? upstream dep?
  user decision?). Use `### Candidate <X>` subsections if the agent
  evaluated multiple options before blocking. Include a read-only
  verification trail when claims need backing.

<!-- TODO: consider a `## Resolution (YYYY-MM-DD)` section convention for
     status: wontfix — seen once in T02, not yet a pattern. -->
