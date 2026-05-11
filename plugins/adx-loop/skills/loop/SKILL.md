---
name: loop
description: >-
  ADX (Agent Development Experience) self-improvement loop. Use when the
  user wants to systematically improve a development environment by
  dogfooding it against a series of features, with a mandatory retro
  after each that names the top pain and queues one harness fix shipped
  before the next feature. Optimizes the harness, not the product.
when_to_use: >-
  Use when the user says "ADX loop", "self-improvement loop", "harness
  pressure-test", or asks to dogfood tooling against a feature backlog.
  Also: when a development environment (test harness, dev loop, CI flow,
  scaffolder) feels slow or "blind" and the user wants structured
  improvement rather than ad-hoc fixes. Not for shipping product features
  on their own — that's tasks:orchestrate. ADX loop intentionally couples
  feature work to harness work.
argument-hint: "[--cycle N | --halt | --status]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
---

# adx-loop:loop

Self-improvement loop. One cycle = one product feature + one harness fix.
Each cycle the harness improves a little; each retro queues the next fix.

## Invocation

```
/adx-loop:loop                # process the next cycle
/adx-loop:loop --cycle N      # start an explicit cycle N (skip auto-numbering)
/adx-loop:loop --status       # read tasks/adx-metrics.csv tail, show state
/adx-loop:loop --halt         # write Loop summary, exit cleanly
```

## Bootstrap

If `tasks/adx-metrics.csv` does not exist, this is cycle 1 (baseline).

Create it with header:
```
ts,feature_id,t_iter_s,t_dev_s,n_runs,m_files,n_blindness,adx_score,top_pain,fix_queued
```

If `tasks/<retro-notes>.md` does not exist (the per-cycle pain log), create
it with a `## Pain log` heading. Default filename: `tasks/ADX_NOTES.md` (user
can rename — the loop reads the CSV, not this file, for state).

If no feature backlog exists, prompt the user for one: 4-8 features ordered
by ascending challenge, each chosen to surface a *different* kind of harness
pain. Diversity is the point — homogeneous backlogs over-fit harness fixes
to one surface.

## The cycle

Each cycle = the 7 steps below. Mark each in the conversation so the user can
follow.

### 1. PRE — read state

Read the last row of `tasks/adx-metrics.csv`. If it has a non-empty
`fix_queued`, that's the first thing to ship this cycle. Otherwise skip to
step 3.

If `tasks/adx-metrics.csv` only contains the header, this is the BASELINE
cycle (F1). No fix queued, no prior comparison. F1's metrics define the
baseline, not the target.

### 2. SHIP harness fix (queued)

Implement the queued fix. Commit on its own:
```
experiment(adx): F<n-1> fix_queued -> <slug>
```

Update the user-facing surface (CLAUDE.md / README.md / mise tasks / etc.)
if the fix introduces a new agent-facing knob.

If the queued fix turns out to be wrong-direction or already obsolete (e.g.,
the surface it targeted disappeared in the meantime), document that in the
retro and move on — do not ship a fix just to honor a stale note.

### 3. SHIP feature

Implement the next feature from the backlog. Use ONLY the existing harness
toolkit; do not invent new harness primitives mid-feature.

Record blindness incidents *as they happen* in a scratch list. A blindness
incident = a moment the agent had to grep source, extract a frame manually,
revert a file to back out an experiment, or otherwise grope around because
the harness didn't surface the answer cheaply.

Commit:
```
experiment(adx-loop): F<n> <feature-slug>
```

### 4. RETRO

Append to the retro file a `## F<n> retro (YYYY-MM-DD)` section with three
mandatory bullets:

- **Pain** — top friction encountered (1-3 sentences). Be specific. Not
  "things were slow" but "X took N seconds because Y."
- **Workaround** — how the agent got around it this cycle. If no workaround
  exists (pain blocked progress), say so.
- **Fix queued** — ONE concrete harness improvement for the next cycle. Or
  "none — pain tolerable." Frequent "none" entries trip a stop condition
  (see below); use sparingly.

### 5. METRICS

Append one row to `tasks/adx-metrics.csv`:
```
<unix_ts>,F<n>,<t_iter_s>,<t_dev_s>,<n_runs>,<m_files>,<n_blindness>,<adx_score>,<top_pain_slug>,<fix_queued_slug>
```

- `t_iter_s` — wall-clock seconds from cycle start to retro logged.
  Take a `date -u +%s` at step 1 and at the end of step 5.
- `t_dev_s` — equal to t_iter_s for now; future versions might split out
  pure-coding time vs orchestration overhead.
- `n_runs` — count of `mise run` / equivalent invocations (rough proxy for
  iteration cost).
- `m_files` — files mutated OUTSIDE the feature's own directory (excludes
  retro file + CSV, since those are tracker overhead).
- `n_blindness` — count from the scratch list captured during step 3.
- `adx_score` — `100 - (t_iter_s / 60) * 10 - n_blindness * 5 - m_files * 2`,
  clamped to [0, 100]. Higher is better.
- `top_pain_slug` and `fix_queued_slug` — hyphenated snippets, no commas.

Commit:
```
experiment(adx-loop): F<n> retro + metrics
```

### 6. DECIDE — Karpathy keep/discard

Apply autoresearch discipline:

- `adx_score` improved AND `t_iter_s` <= 110% of best-so-far → KEEP, advance.
- `adx_score` regressed AND retro shows a real new pain surface → KEEP. New
  features open new pain — that's expected. The fix_queued is the next
  cycle's lever.
- Feature failed to ship (crash, can't get to working state): retry once. If
  still failing, mark feature blocked. Halt loop and surface to user.

### 7. REPEAT

Return to step 1 for the next feature. Stop when ANY stop condition fires.

## Stop conditions

The loop halts when any of these triggers:

- **Feature budget exhausted** — all backlog features shipped + retros logged.
- **Cycle budget exhausted** — default 10. The loop can ship harness-only
  cycles (skip step 3) when consecutive features have low ROI; cap remains.
- **Plateau** — 2 consecutive cycles with `fix_queued = none`. Pain has
  saturated; ROI on more iterations is unclear.
- **Hard regression** — 3 consecutive cycles with `adx_score` monotonically
  decreasing. The loop itself may be broken; halt for human review.
- **Pivot pressure** — when the harness surface obviously needs a refactor
  before more features land (e.g., several queued fixes overlap, or feature
  code duplicates harness-shaped patterns). Halt and trigger the
  *Absorption Sprint* (see below).
- **User interrupts** — always wins.

After halt, write a final `## Loop summary` section to the retro file
covering: features shipped, harness improvements landed, ADX score
progression, biggest unresolved pain, sequence recommendation for the next
sprint.

## Absorption Sprint

Once the loop ships several features through a single playground product
(pong, scenarios, etc), generic-shaped code accumulates in product files
that *should* live in the harness. Symptoms:

- Duplicated env-knob parsing across scenes.
- Trajectory-emit / state-log scaffolding repeated per scene.
- Per-scene retries of the same "wait until paused / quit-at-frame" plumbing.
- Multiple features touching the same handful of harness-adjacent lines.

Absorption Sprint = a non-feature cycle dedicated to extracting these into
the harness proper (autoload, helper module, mise task, verifier plugin).

Steps:
1. Audit the playground product file(s) line-by-line. Classify each block as
   `product` (stays) or `generic` (absorb candidate).
2. Pick a target module / autoload / location for the absorbed code.
3. Move + re-wire. Run the existing test/verification flow after each move;
   if anything breaks, revert and try a smaller chunk.
4. Update CLAUDE.md / AGENT_GUIDE.md to point at the new harness surface.
5. Commit: `experiment(adx): absorption sprint <n> — <slug>`.

Measure success: feature LoC in playground product should drop materially.
Run the full loop one more cycle after the absorption to confirm the
harness is still usable (the harness's own users — agents — should be the
first to use the new surface).

## Transferability Validation

After absorption, validate by building a SECOND playground product (a
different game, a different scenario type, a different domain). The new
playground should reuse the harness without modification. Measure:
- shipping time vs F1 of the original playground (should be much lower)
- LoC of new product vs F1-equivalent of original (should be much lower)

If the new playground requires significant harness changes, those changes
themselves get queued through the next loop cycle.

## Anti-patterns

- **Skipping retros** — the queued fix is what powers the next cycle. Skip
  one and the loop drifts back to ad-hoc.
- **Inflating metrics** — `n_blindness=0` on every cycle is suspicious; the
  agent often misses moments it was groping in the dark. Bias toward
  honest counting.
- **Gameable adx_score** — deleting feature work to inflate the score is
  the obvious cheat; less obvious is "deferring real pain to the retro
  rather than fixing it during the cycle so t_iter looks good." If a fix
  is small (< 10 min) and the pain is biting NOW, fix mid-cycle and note
  it as such. The retro distinguishes "consumed F<n-1> queued fix" from
  "landed a new mid-cycle fix prompted by F<n> pain."
- **Adding features just to keep the loop running** — backlog should be
  driven by real product / agent needs, not loop continuity. If the
  backlog runs out, halt rather than invent.
- **Over-instrumenting** — the CSV is 10 columns for a reason. Adding more
  columns to track marginal effects creates retroactive bookkeeping with
  little payoff. Keep schema stable.
- **Dispatching the loop to a subagent** — the loop is iterative + holds
  state across cycles. Subagent isolation breaks the queued-fix chain.
  Run inline.

## File contract

The loop maintains these files. Other consumers may read them — keep
schemas stable across cycles.

- `tasks/adx-metrics.csv` — 10-column append-only ledger. Reads: last row
  for fix_queued, full file for trend analysis at halt.
- `tasks/ADX_NOTES.md` (or user-renamed) — append-only retro log + final
  Loop summary. Section per cycle: `## F<n> retro (YYYY-MM-DD)`.
- Git commits — one per step 2, 3, 5. Commit subjects use `experiment(adx)`
  for harness fixes, `experiment(adx-loop)` for feature + retro pairs.

## Origin

Pattern derived from Karpathy autoresearch (one change, mechanical metric,
git as memory) applied to development-environment optimization rather than
research-experiment selection. First proving ground: Godot scenario harness
+ pong (7 cycles, t_iter dropped 4.26x F1→F7, adx_score 1 → 77).
