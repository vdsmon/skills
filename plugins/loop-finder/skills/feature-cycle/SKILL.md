---
name: feature-cycle
description: >-
  Feature-driven outer cycle for a converged loop-finder gate. One
  invocation = one cycle: flush the queued harness fix from the prior
  retro, ship the next feature against the current gate, retro with
  Pain / Workaround / Fix queued, log to per-class feature-log.jsonl.
  Across-cycle queued-fix chain optimizes the harness, not the product.
when_to_use: >-
  Use when the user says "ship feature X against the converged loop",
  "self-improvement loop", "ADX loop", "harness pressure-test", "dogfood
  the tooling against a feature backlog", or invokes
  /loop-finder:feature-cycle. Preconditions: a class baseline produced
  by /loop-finder must exist for the current repo (flake_rate=0, canary
  full). Do NOT use for ad-hoc one-off features — the queued-fix chain
  only pays off across multiple cycles. Do NOT use to find or refine
  the gate itself — that's the loop-finder sibling skill.
argument-hint: "[feature-slug | --status | --halt | --absorption-sprint]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
---

# loop-finder:feature-cycle

Outer cycle wrapping a converged loop-finder gate. Ship features against the gate, queue ONE harness fix per cycle, ship it BEFORE the next feature. Karpathy autoresearch discipline (one change, mechanical metric, git as memory, binary keep/discard) applied to development-environment optimization.

## Preconditions

A class baseline exists at `~/.claude/loop-finder/<class-id>/`. Specifically: `baseline.json` (with `flake_rate=0`), `gate.sh` (runnable), `known-bad/` fixtures all rejected. If missing, run `/loop-finder` first to converge a gate for this class. Feature-cycle is the outer loop; it does not produce gates.

The repo should have a project-scoped `loops` skill at `<repo>/.claude/skills/loops/` (the deliverable from `/loop-finder`'s Step 4). Feature-cycle uses it to invoke the gate by name.

## Invocation

```
/loop-finder:feature-cycle <feature-slug>     # process one cycle
/loop-finder:feature-cycle --status            # tail feature-log.jsonl, show queued fix + plateau state
/loop-finder:feature-cycle --halt              # write Loop summary, exit cleanly
/loop-finder:feature-cycle --absorption-sprint # non-feature cycle, see below
```

## The cycle

One invocation = one cycle = the 7 steps below. Mark each in the conversation so the user can follow.

### 1. PRE — read state

Resolve `class-id` from `<repo>/.loop-finder.yaml` (or prompt user). Tail `~/.claude/loop-finder/<class-id>/feature-log.jsonl`. If the last row's `fix_queued` is non-empty, that's the first thing this cycle ships. Otherwise skip to step 3.

If `feature-log.jsonl` does not exist, this is cycle F1 (baseline). No fix queued, no prior comparison.

### 2. SHIP queued harness fix

Implement the queued fix. Commit on its own:

```
experiment(feature-cycle): F<n-1> fix_queued -> <slug>
```

Update the agent-facing surface (CLAUDE.md / project mise tasks / loops-skill references) if the fix introduces a new knob.

If the queued fix turns out to be wrong-direction or already obsolete (the surface it targeted disappeared in the meantime), document that in the retro and move on. Do not ship a fix just to honor a stale note.

### 3. SHIP feature

Implement the feature from the user's arg or the next backlog entry. Use ONLY the existing harness toolkit; do not invent new harness primitives mid-feature. Invoke the gate via the project `loops` skill to verify.

Record blindness moments in a scratch list as they happen. A blindness moment = the agent had to grep source, manually extract a frame, revert a file to back out an experiment, or otherwise grope around because the harness did not surface the answer cheaply.

Commit:

```
experiment(feature-cycle): F<n> <feature-slug>
```

### 4. RETRO

Append to `~/.claude/loop-finder/<class-id>/retro.md` a `## F<n> retro (YYYY-MM-DD)` section with three mandatory bullets:

- **Pain** — top friction this cycle (1-3 sentences). Be specific. Not "things were slow" but "X took N seconds because Y."
- **Workaround** — how the agent got around it this cycle. If no workaround (pain blocked progress), say so.
- **Fix queued** — ONE concrete harness improvement for the next cycle. Or `none — pain tolerable`. Frequent `none` entries trip the plateau halt; use sparingly.

### 5. METRICS

Append one row to `~/.claude/loop-finder/<class-id>/feature-log.jsonl`:

```json
{"ts": <unix-ts>, "feature_id": "F<n>", "gate_id": "<class-id>", "wall_s": <int>, "blindness_subjective": <int>, "files_outside_feature": <int>, "gate_verdict": "accept|reject", "top_pain": "<slug>", "fix_queued": "<slug>"}
```

- `ts` — `date -u +%s` taken at step 1 start.
- `wall_s` — seconds from step 1 to end of step 5.
- `blindness_subjective` — count from the scratch list in step 3. Distinct from the gate's mechanical `blindness_count` (see loop-finder Vocabulary).
- `files_outside_feature` — files mutated outside the feature's own directory, excluding `retro.md` + `feature-log.jsonl`.
- `gate_verdict` — last gate verdict at step 3 completion.
- `top_pain` and `fix_queued` — hyphenated slugs, no commas.

No composite scalar. Lex-rank progression lives in loop-finder's `baseline-history.jsonl`; feature-cycle's signal is the queued-fix chain + gate verdicts.

Commit:

```
experiment(feature-cycle): F<n> retro + metrics
```

### 6. DECIDE — Karpathy keep/discard

- Gate accepted feature → KEEP, advance.
- Gate rejected, retro shows a real new pain surface → KEEP. New features open new pain; the queued fix is next cycle's lever.
- Feature failed to ship (crash, can't reach working state): retry once. Still failing → mark blocked, halt loop, surface to user.

### 7. REPEAT

Return to step 1 for the next feature. Stop when any stop condition fires.

## Stop conditions

- **Feature budget exhausted** — backlog drained.
- **Cycle budget** — default 10. Optional user cap.
- **Plateau** — 2 consecutive cycles with `fix_queued = none`. Pain has saturated; ROI on more iterations unclear.
- **Hard regression** — 3 consecutive cycles with `gate_verdict = reject` and no progress on `top_pain`. The loop itself may be broken; halt for human review.
- **Pivot pressure** — queued fixes overlap or feature code duplicates harness-shaped patterns. Halt and trigger the Absorption Sprint.
- **User interrupts** — always wins.

After halt, append a `## Loop summary` section to `retro.md`: features shipped, harness improvements landed, gate-verdict progression, biggest unresolved pain, sequence recommendation for the next sprint.

## Absorption Sprint

Once the cycle has shipped several features through a single system-under-test, generic-shaped code accumulates in product files that *should* live in the harness (gate, helpers, menu entries). Symptoms:

- Duplicated env-knob parsing across features.
- Trajectory-emit / state-log scaffolding repeated per feature.
- Multiple features touching the same handful of harness-adjacent lines.
- Several queued fixes pointing at the same surface.

Absorption Sprint = a non-feature cycle dedicated to extracting these into the harness proper.

Steps:

1. Audit product file(s) line-by-line. Classify each block as `product` (stays) or `generic` (absorb candidate).
2. Pick a target location for the absorbed code (helper script, gate step, menu entry).
3. Move + re-wire. Run the gate (`gate.sh` via project `loops` skill) after each move; if anything breaks, revert and try a smaller chunk.
4. Update CLAUDE.md / project loops-skill references / mise tasks to point at the new harness surface.
5. Commit: `experiment(feature-cycle): absorption sprint <n> — <slug>`.

Measure success: feature LoC in product files should drop materially. Run one more feature cycle after the absorption to confirm the harness is still usable (the harness's own users — agents — should be the first to use the new surface).

## Transferability Validation

After absorption, validate by registering a SECOND class via `/loop-finder` (different domain or oracle), then running feature-cycle against it. The new playground should reuse the harness without modification. Measure:

- Time-to-first-pass vs F1 of the original (should be much lower).
- LoC of the new playground vs F1-equivalent of original (should be much lower).

If the new playground requires significant harness changes, those changes queue into the next cycle of the original class.

## Anti-patterns

- **Skipping retros** — the queued fix is what powers the next cycle. Skip one and the loop drifts back to ad-hoc.
- **Inflating subjective blindness count** — `blindness_subjective = 0` every cycle is suspicious; the agent often misses moments it was groping in the dark. Bias toward honest counting.
- **Adding features just to keep the loop running** — backlog should be driven by real product / agent needs, not loop continuity. If the backlog runs out, halt rather than invent.
- **Deferring real mid-cycle pain to retro to keep wall_s low** — if a fix is small (<10 min) and the pain is biting NOW, fix mid-cycle and note it. The retro distinguishes "consumed F<n-1> queued fix" from "landed a new mid-cycle fix prompted by F<n> pain."
- **Inventing new harness primitives mid-feature** — that's the next cycle's queued fix, not this cycle's scope. Capture it in the retro and ship it next cycle.
- **Dispatching the cycle to a subagent** — the cycle is iterative and holds state across invocations via the queued-fix chain. Subagent isolation breaks the chain. Run inline.
- **Mixing this with `/loop-finder`** — loop-finder finds and races gates (the loop-as-artifact). feature-cycle ships features against a fixed gate (the system-under-test). Confusing them contaminates measurement.

## File contract

The cycle maintains these files. Other consumers may read them; keep schemas stable.

- `~/.claude/loop-finder/<class-id>/feature-log.jsonl` — append-only ledger. Reads: last row for `fix_queued`, full file for trend analysis at halt.
- `~/.claude/loop-finder/<class-id>/retro.md` — append-only retro log + final Loop summary. Section per cycle: `## F<n> retro (YYYY-MM-DD)`.
- Git commits — one per step 2, 3, 5. Commit subjects use `experiment(feature-cycle)`.

## Origin

Pattern derived from Karpathy autoresearch (one change, mechanical metric, git as memory) applied to development-environment optimization. Sibling to the `loop-finder` skill: loop-finder converges the gate, feature-cycle runs the outer queued-fix chain against it. Folds in the adx-loop discipline that previously shipped as a separate plugin (queued-fix chain, retro bullets, Absorption Sprint, Transferability Validation).

Battle tests:

- Godot scenario harness + pong (7 cycles, `wall_s` dropped 4.26× F1→F7) — proving ground for the queued-fix chain and Absorption Sprint patterns.
- mic-mute settings-preview (4 cycles, 2 classes) — proving ground for the loop-finder gate-discovery half.
