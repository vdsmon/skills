# Dispatch Patterns

## Atomic-imperative template (canonical)

```
Read `tasks/T<NN>-<slug>.md`. Implement it. Commit `<conventional-commit-msg>`. Flip T<NN> frontmatter status to done. TaskUpdate task #<N> completed. Report.
```

Five sentences. Pure imperative. No context, no congratulations, no previous-task references.

## Why atomic-imperative

Agent-spawned teammates parse messages with a strong fixation on the first task-id they encounter. A message like:

> "T59 shipped cleanly — congrats on the dashboard. Next task is T60. Read..."

gets parsed as "team-lead is following up on T59." The teammate re-confirms T59 done. The T60 dispatch is ignored. Even an explicit "this is NEW work, not a re-dispatch of T59" preamble doesn't fully break the fixation.

Solution: never mention the previous task. Lead with the imperative on the new file. If the teammate needs context about what just shipped, they can `git log` it themselves.

## Observed failure shapes

### Failure 1: T-fixation from combined messages

**Message sent:**
> "T81 jrpg-distance-dashboard already shipped — congrats on the dashboard. T61 is small (M, 30 min): edit CLAUDE.md Hard Rules visual clause..."

**Teammate response (5x in a row):**
> "T81 jrpg-distance-dashboard is already complete from earlier in this same session. Standing by."

**Recovery:** ultra-minimal one-liner with no prior reference:
> "Read `tasks/T61-hardrule-relaxation-sprites.md`. Implement it. Commit `docs(hardrule): ship T61 (E11)`. Flip status. Report."

### Failure 2: Deferential teammate waiting on explicit "yes"

Some teammates are polite — they offer to claim a task but wait for explicit user confirmation:

> "I see task #9 (T61) is now pending. Per the spec it depends on T59 + T60 (both shipped by me) so it's ready to dispatch. Happy to claim if you want, or wait for explicit assignment."

**Recovery:** single-word "Yes" plus the task number:
> "Yes. Claim task #9 and ship T61."

### Failure 3: Sandbox-gate disguised as confusion

When third-party dependency vendoring (Godot addons, npm packages, etc.) hits the sandbox classifier, teammates can't proceed without explicit user-side approval. Their re-confirmation messages look like a confusion loop but are actually appropriate caution:

> "T64 implementation flagged a permission gate. Sandbox classifier denied 'vendoring an agent-chosen third-party Godot addon' because I selected the fork from a GitHub search rather than from an explicit user pin. The reasonable call before continuing."

**Recovery:** read the message carefully. If they cite a permission gate, respond with the explicit approval (fork name + version + path):
> "Approved. Vendor `Kiamo2/YATI` v2.2.7 GDScript build under `addons/YATI/`. Proceed end-to-end."

Don't send another atomic-imperative — that doesn't help. They need the gate cleared, not another dispatch.

### Failure 4: Wire-cross delays

Messages between lead and teammate can cross in flight. The teammate sends "ready to commit T<XX>" → lead sends "you have a new assignment" before processing the ready message → teammate now sees both messages out of order.

**Recovery:** trust the teammate's most recent message. Reply to what they actually said, not what you expected. If they say "ready to commit T78," send "go T78" — even if you thought you'd already dispatched T79 to them.

## Naming teammates

Use descriptive names that signal domain:

| Name | Domain |
|---|---|
| `state-emitter` | Runtime/engine state telemetry |
| `property-infra` | Property tests + scenario probes |
| `asset-importer` | Asset pipeline + provenance lint |
| `tilemap-builder` | Verifier plugins + addon vendoring |
| `doc-builder` | Documentation + markdown work |
| `migrator` | Schema migrations + data transforms |

Names get used in SendMessage `to` field, TaskUpdate `owner` field, and team-config discovery. Descriptive names = teammates self-organize when they read the team config.

Avoid:
- `dev-1`, `dev-2`, `dev-3` (no domain signal)
- Long phrases (`state-emission-and-runtime-helpers`)
- Underscores in names if you can avoid them (Agent tool sometimes hiccups on them)

## Conventional commit prefixes (project-agnostic guidance)

Always include the commit prefix in dispatch messages. Common prefixes:

| Prefix | Use |
|---|---|
| `feat` | New user-facing capability or runtime behavior |
| `fix` | Bug fix on existing behavior |
| `docs` | Documentation only — no code change |
| `refactor` | Code restructure without behavior change |
| `test` | Test additions or changes |
| `chore` | Tooling, deps, build, CI config |
| `lint` | Lint rule additions/fixes |

The teammate uses the prefix as you specify. Don't leave it open — they'll guess and produce inconsistent commits.

## Task lifecycle tracking

In team mode, two task lists exist:

1. **Team task list** (`~/.claude/tasks/<team-name>/`) — coordination tasks created via `TaskCreate`. One per story. Owner field tracks assignment.
2. **Project task list** (in-repo `tasks/T*.md` files) — canonical story specs.

These are mirrors. When team task #5 completes, in-repo `T60.md` should have `status: done` in frontmatter. The dashboard regen hook reconciles.

**Do NOT use the same task ID** for both — team tasks are #1, #2, #3..., in-repo are T70, T71, T72.... When dispatching, reference BOTH ("task #5 in your TaskList → ship `tasks/T60-...md`").
