# Wave Composition

## The file-conflict matrix

Before dispatching ANY teammate, build this matrix from story specs:

```
Story  Story-Title              File-A   File-B   File-C   ...   New-Dir
T70    emit-state-dict          OWNER    OWNER    OWNER    ...   —
T71    save-load-fixture        SERIAL   SERIAL   SERIAL   ...   —
T72    per-subsystem-rng        SERIAL   —        SERIAL   ...   —
T59    import-sprite-script     —        —        —        ...   tools/art/
T53    hypothesis-infra         —        —        —        ...   tests/properties/
```

Categories:

- **OWNER**: story owns this file — establishes new content. Other stories reference but don't edit.
- **SERIAL**: story edits this file. Must wait for OWNER + earlier SERIAL stories to commit first.
- **—**: story doesn't touch this file. Free to dispatch in parallel.
- **NEW**: story creates this directory or file. No conflict because nothing existed before.

## Wave composition rules

### Wave 1 (initial)

- Stories with **zero deps** AND **zero SERIAL or OWNER cells with another wave-1 story** = parallelizable.
- Max 3 teammates in parallel — coordination overhead grows quadratically beyond.
- Domain spread: prefer different teammate types per story (don't put 3 verifier stories on one teammate).

### Wave 2+

- Re-evaluate after each wave-1 commit lands.
- Newly unblocked stories = stories whose `depends_on` are now all `status: done`.
- Re-check file conflicts against in-flight wave (some stories block their own siblings).

### Serial lanes

When N stories share an OWNER file (`runtime.gd`, `manifest.schema.json`), one teammate carries them sequentially:

```
state-emitter chain:
  T70 emit-state-dict (owner)
  → T71 save-load-fixture (after T70)
  → T72 per-subsystem-rng (after T71)
  → T73 bitmap-font-pin (after T72)
  → T76 tilemap-hash (after T72)
  → T75 text-assert (after T73)
```

One teammate, sequential dispatches. They retain context between stories — the runtime.gd file ownership is theirs.

## Append-only files (special handling)

These files exist primarily to grow over time. Multiple stories will append rows or sections. Examples:

| File | Pattern | Conflict shape |
|---|---|---|
| `mise.toml` | Each story adds a `[tasks.<name>]` block | Append-only, but file-level conflict for parallel commits |
| `ASSETS.md` | Each story adds a provenance row | Append-only |
| `CLAUDE.md` | Each story may extend a section | Section-level conflict possible |
| `invariants.json` | Each story appends invariants | Array-append conflict |
| `tasks/games.md` | Each cycle appends a row | Append-only |
| `tools/verifiers/README.md` | Each new verifier adds an entry | Append-only |
| `pyproject.toml` | Each story adds deps | Section-level |

**Discipline for append-only files:**

1. Declare ownership in the epic architecture sketch (which stories will append).
2. Even though edits are non-conflicting at content level, commit-level concurrency still races.
3. Lead serializes commits per the commit-window protocol — stories appending to the same file commit sequentially.
4. If a story modifies append-only files of MULTIPLE other in-flight stories, hold its commit until the others land — minimize the index merge surface.

## Story sizes and parallel budget

Story specs typically declare a size: S (≤30 min), M (60-120 min), L (≥180 min).

**Parallel budget heuristic:**
- 3 × S in parallel: low-risk, fast finish, minor commit-window churn.
- 2 × M in parallel: medium-risk, normal pace, manageable commit-window queue.
- 1 × L + 1-2 × S in parallel: complex story dominates, smaller stories fill teammate idle time.
- 3 × L in parallel: don't. They'll all hit the commit-window queue simultaneously.

## Dispatching to the right teammate

| Story shape | Best teammate domain |
|---|---|
| Runtime/engine state telemetry | Runtime-focused teammate (carries serial chain) |
| New verifier plugin | Verifier-focused teammate (knows plugin protocol) |
| Test/probe authoring | Test-infra teammate (knows fixtures + properties) |
| Asset import + lint | Asset-pipeline teammate |
| Docs / hard rules | Any teammate, but small dedicated doc-builder works |
| Third-party addon vendoring | Fresh teammate (sandbox approval is interactive — don't burn context on stretching) |
| Schema migration | Schema-focused teammate (owns the schema file across migrations) |

When in doubt, dispatch to whoever shipped the most adjacent story most recently. Context retention compounds.

## Rebalancing mid-epic

After ~5 ships, check teammate workload distribution:

- One teammate has shipped 4 stories, another 0 → overload risk on the first; redistribute.
- A teammate has been idle for 3 waves → either give them work or shutdown (with user OK) to free up swarm.
- A teammate keeps hitting sandbox gates on every assignment → their domain mismatches the current backlog; reassign or spawn replacement.

## When to spawn a fresh teammate vs reuse

**Fresh teammate (spawn new Agent):**
- Domain shift — current teammates' context doesn't apply.
- Existing teammates all in-flight; you need parallel capacity now.
- Recovery from a stuck/confused teammate (spawn replacement, idle the broken one).

**Reuse existing teammate:**
- New story is in the same domain as their recent ships.
- They've already learned project-specific conventions worth retaining.
- Repo knowledge from prior commits speeds their setup.

Default to reuse. Spawn fresh only when context mismatch is real.
