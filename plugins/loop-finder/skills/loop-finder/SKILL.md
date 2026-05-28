---
name: loop-finder
description: >-
  Engineers a self-verifiable end-to-end feedback loop for a task class
  (no HITL at run time), measures it against a strict metric tuple, races
  parallel variants against the baseline, and converges on the best loop
  config. HITL is concentrated at permission boundaries (install CLI,
  register MCP, touch shared files) — never mid-iteration. Caches per
  task class so future runs reuse. Foundation skill that adx-loop
  consumes — adx-loop iterates against a gate; this skill produces and
  races the gate itself.
when_to_use: >-
  Use when the user says "find me a loop for X", "engineer a feedback
  loop", "race loop variants", "I keep hitting HITL", "set up a self-
  verifiable harness for X", or invokes /loop-finder. Also use when
  adx-loop needs an acceptance gate and none exists for the current
  task class. Do NOT use
  for one-shot fixes that don't repeat — the cache and exploration cost
  only pay off across multiple iterations.
argument-hint: "[task description | --status | --halt | --max-cycles N]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Agent
---

# loop-finder

Generalized procedure for engineering a self-verifiable feedback loop for any task class, then racing variants against it. Foundation underneath `adx-loop:loop` — adx-loop iterates against a gate; this skill produces the gate and pushes it toward the best loop config the available tooling can build.

## Core promise

Run-time loops never need HITL. All approval gates are concentrated at permission boundaries — installing a CLI, registering an MCP, writing to a file outside the working dir. Many small mid-iteration interrupts are traded for few large up-front approvals.

## Invocation

```
/loop-finder <task description>     # find or extend a loop for this task class
/loop-finder --status               # show baseline + history for cached classes
/loop-finder --halt                 # write summary and exit cleanly
/loop-finder --max-cycles N         # cap exploration at N cycles
```

## Vocabulary

- **Loop / gate** — a single command (script, CLI, or MCP-mediated call) that takes the current state of the repo + a representative input and returns a machine-checkable verdict (exit code 0 = accept, non-zero = reject; or a JSON object with a pinned `verdict` field).
- **Task class** — a stable signature for "this kind of work": `(repo, task domain, oracle type)`. Hashed → `class-id`.
- **Baseline** — the current best loop config for a class, with its metric tuple pinned.
- **Variant** — a candidate loop config explored in a cycle.
- **Menu** — `menu.yaml`, the catalog of loop patterns this skill picks variants from. Each entry has the fields needed for the decision matrix.
- **Cycle** — one iteration of the explore phase. Spawns `N` parallel agents, each implementing one variant.
- **HITL touchpoint** — a moment where the user is asked to approve a permission gate. Exactly two kinds: (1) Step-1 gap report, (2) Step-3 batched permission requests.

## Files

Per-class cache lives at `~/.claude/loop-finder/<class-id>/`:

```
config.yaml             current loop config (the chosen pattern, its wiring)
gate.sh                 runnable gate (single command, exit 0 on accept)
rubric.json             only if using LLM-judge path; pinned model + version + threshold
baseline.json           current baseline metric tuple
baseline-history.jsonl  append-only audit log of baseline changes
known-bad/              canary regression fixtures (frozen)
variants/               per-cycle exploration artifacts
summary.md              written on halt
```

Per-repo pin (optional, committed): `.loop-finder.yaml` at repo root pinning which `class-id` this repo uses and any repo-specific overrides.

Skill-level files (versioned with the plugin):
- `menu.yaml` — catalog of loop patterns. The Step-3 candidate menu.
- `~/.claude/loop-finder/blindness-rules.yaml` — checked-in regex/heuristic checklist for `blindness_count`. Adding a rule is itself an HITL approval moment.

## Metric

A loop is scored as a tuple, computed from 10 runs against a representative input.

### Hard gates (must hold to adopt)

- `flake_rate` — over 10 runs on the same input, fraction where verdict differs. **Must equal 0.**
- `canary_pass_count` — of the frozen known-bad fixture set, how many the gate correctly rejects. **Must equal full set size.**

If either hard gate fails, the variant is rejected outright — no comparison, no adoption.

### Performance dims (lexicographic ranking)

1. `cycle_wall_s` — median wall-clock seconds, invocation → verdict.
2. `blindness_count` — sum of blindness-rule matches across the 10-run sample.
3. `cycle_tokens` — tokens an agent spends invoking + reading the gate.

Walk top-down. First differing dim by ≥5% favoring the variant decides. If no perf dim improves by ≥5%, the variant is **no improvement**.

**Per-class lex override.** For UI-visual / target-conformance / multi-modal classes where agent clarity dominates iteration cost, override the default order to `blindness_count → cycle_wall_s → cycle_tokens`. Pin in `<class-id>/config.yaml` as `lex_order: [...]`.

### Variant-type split for adoption (critical)

A cycle's variants come in two flavors. Apply different ranking rules.

**Gate variants** — modify the gate pipeline (the loop-as-artifact). Examples: G1 resize-flip, G2 per-quadrant, G3 LPIPS swap. Rank by **lex perf dims** above. Hard gates (`flake_rate=0` + canary) apply. First differing perf dim ≥5% in winner's favor decides.

**Product variants** — modify the system under test, gate unchanged. Examples: V1 about-window redesign, V5 spacing tune. Rank by **oracle output** (the gate's verdict value or score — dissim, ssim, test-count, latency, etc.). Hard gates same. Perf dims are surfaced but not decisive — they measure loop cost, not product progress. A product variant that improves oracle output by ≥5% adopts even if wall_s regresses.

The orchestrator declares variant type at Step 3 spawn time. Confusing them led to a real adoption-rule violation in the cycle-4 retro: V5 won on oracle (-10.8% dissim) but failed strict lex (wall regressed).

### Stop rule

Two consecutive cycles with no ≥5% improvement on any perf dim → halt.

## The 4 steps

### Step 1 — FIND

1. Compute `class-id` from task description: `sha256(repo_path + task_domain + oracle_type)[:12]`.
2. Cache hit → load `<class-id>/config.yaml`. Run Step 2 to confirm the cached gate still passes hard gates. If it does, skip to Step 3 (continue exploration). If not, log the regression and fall through to fresh find.
3. Cache miss:
   1. Classify task on TWO orthogonal axes:
      - **Domain**: code | UI | audio | RL env | text | multi-modal | distributed-system.
      - **Vision requirement**: vision-required (gate emits images, verdict needs perceptual judgment, agent must see rendered output) vs text-only (gate emits text/JSON/exit-codes, no rendered surface). Surface classification to user for confirmation if ambiguous. The vision axis drives agent-type selection (Step 3) and oracle-pattern filtering (only `target_conformance_oracle`, `visual_diff_oracle`, `multimodal_oracle`, `llm_judge` are valid for vision-required tasks; only text-emitting oracles for text-only).
   2. Walk `menu.yaml`. For each candidate pattern, evaluate `applies_when` against the task. Discard non-fits.
   3. For each viable candidate, check `tooling_signature` AND `tooling_preconditions` against what's installed locally (`which`, `ls`, MCP server registry). Emit a **gap report**.
   4. Surface gap report to user. **HITL touchpoint #1.** User picks which gaps to close (install CLI X, register MCP Y, write fixture Z). Skip patterns whose gaps the user denied.
   5. Compose the selected pattern(s) into a runnable gate. Start from `templates/iterate.sh.tmpl` in this plugin — do NOT hand-roll harness scripts; the template encodes ROOT-derivation, per-PID OUT dir, and verdict-tag conventions that were learned through repeated cycle-1-through-4 friction. Write the customized gate to `<class-id>/gate.sh`.
   6. **Verify oracle direction.** For any similarity / distance / score oracle: run self-vs-self AND a known-different input through the raw oracle (before the predicate). Confirm verdict semantics match the predicate direction. magick 7's `compare -metric SSIM` emits structural DISSIMILARITY (0=identical, 0.5=max), so the predicate must be `<= threshold` for ACCEPT, NOT `>= threshold`. Refuse to pin a threshold without this empirical check.
   7. **Floor probe (similarity / metric oracles only).** Render the gate 5 times against the SAME input. Compute pairwise oracle-output variance. The maximum pairwise delta is the noise floor. Threshold must be set above `floor + small margin`. If the user-requested threshold is below the floor, that threshold is physically unreachable — surface to user and renegotiate.
   8. **Smoke test.** Trivially-passing input must give the accept verdict. Trivially-failing input must give reject. If either fails, surface and stop.

### Step 2 — MEASURE / BASELINE

1. Run gate 10× on representative input. Time each run.
2. Compute `flake_rate`. If non-zero, surface and refuse to baseline.
3. Run canary regression test (all fixtures under `known-bad/`). If any pass, surface and refuse to baseline.
4. Compute the perf tuple:
   - `cycle_wall_s` — median of the 10-run wall-clock times.
   - `blindness_count` — for each run, apply the rules in `~/.claude/loop-finder/blindness-rules.yaml` to the captured gate output (stdout + stderr + presence of named-binary artifacts). Sum matches across the 10-run sample. Each rule is regex / heuristic-checkable.
   - `cycle_tokens` — estimate from output line count × tokens-per-line average, OR use a pre-measured count if the gate emits a structured single-line JSON verdict.
   Write `baseline.json`. Append to `baseline-history.jsonl`.

### Step 3 — EXPLORE

Per cycle:

1. Ask user for `N` (parallel agents) and `T` (per-agent time-box). Propose defaults `N=3, T=10min` on cycle 1; bump `N` if cycle 1 plateaued early.
2. Generate `N` variation candidates:
   - **Menu phase** (until exhausted): pick patterns from `menu.yaml` that differ from current baseline on at least one of `oracle_type`, `tooling_signature`, `environment_isolation`.
   - **Bottleneck phase** (after menu exhausted): profile baseline (time each gate step), generate variants targeting the slowest step.
3. Spawn `N` Agent subagents in parallel, each in `isolation: "worktree"`. Per-agent brief: implement variant, run 10× measurement protocol, run canary, return tuple + any permission gaps it hit. Time-box `T`.

   **Agent-type decision matrix:**

   | Variant work | Use |
   |---|---|
   | Edit-only (single file, no measurement) | `caveman:cavecrew-builder` — cheap, lacks Bash so cannot run gates |
   | Standard variant (edit + measure, text-only or non-rendering) | `general-purpose` — default, full toolkit |
   | Substantial Rust / algorithm work, **no GUI rendering** | `codex:codex-rescue` — deeper coding, but sandbox lacks NSScreen |
   | **Vision-required task** (UI domain, target-conformance, visual-diff) | **`general-purpose` only.** Never codex (sandbox panics on tao window construction); never caveman builder (lacks Bash for measurement). |
   | Edit-only diff-emitter | `caveman:cavecrew-builder` — caveman-compressed diff, ~60% smaller back-context |

   Rule of thumb: any variant that runs the gate to measure needs Bash. Caveman builders measure-blind. Codex variant agents are a no-go for any task whose gate touches the GUI surface.

   **Worktree bootstrap (mandatory first action for variants):** run `bash <plugin-path>/helpers/bootstrap-worktree.sh` as the first command in your worktree. The script syncs `tools/`, `src/`, `Cargo.toml`, `assets/` from main, adds `[workspace]` block if missing, trusts mise.toml. Idempotent. Variants that skip this consistently rediscover the same bootstrap problem (cycles 1-4 saw 8+ agents independently re-fix it).

   The orchestrator should ALSO commit any WIP main state that defines the baseline before spawning. The bootstrap script falls back to `origin/main` if local `main` is stale.

   **Gate's artifact dir** must be per-run isolated. Templates default to `OUT="/tmp/loopfinder-snap-$$"`. Never use a shared `/tmp/<class>-snap/` path — cycle 3's V5+V6 race on it cost a flake_rate=0.20 false-fail.
4. Agents that hit permission gates halt and report the gap. Collect all gaps from all agents at end of cycle → surface as a batch. **HITL touchpoint #2.** User approves which to grant. Approved agents restart; others stay halted.
5. For each completed variant: reject outright on hard-gate fail; otherwise rank vs baseline by lex perf-dim rule.
6. Adopt the highest-ranked surviving variant. If none improves baseline, mark cycle "no improvement".
7. If adopted: append old baseline to `baseline-history.jsonl`, write new `baseline.json`, update `config.yaml` + `gate.sh`.

### Step 4 — REPEAT or HALT

Halt conditions:

- **Diminishing returns**: 2 consecutive cycles with no ≥5% improvement on any perf dim.
- **Hard regression**: 3 consecutive cycles with no variant beating baseline at all.
- **Cycle budget**: optional user cap.
- **User interrupt**: always wins.

On halt, write `<class-id>/summary.md`: baseline progression (table of cycle # → `cycle_wall_s`, `blindness_count`, `cycle_tokens`), final winning config, unresolved gaps, list of approved permissions granted across the run.

**Then generate the deliverable: a project-scoped `loops` skill in the target repo.** When at least one class has been converged for a repo, write a project skill at `<repo>/.claude/skills/loops/` (NOT into the global `~/repos/personal/claude-skills/plugins/` marketplace — repo-specific content belongs with the code it documents). The skill should:
- List each registered class (id, gate command, oracle, threshold, current baseline)
- Bake in repo-specific caveats as files under `references/`
- Ship thin wrapper scripts in `scripts/` that resolve repo root from `${BASH_SOURCE[0]}` so they work from any cwd
- Trigger phrases that match the user's natural way of asking "test the UI" / "snapshot regression" / "does it match the design"
- Point back at `/loop-finder` for adding more classes

Reference implementation: `mic-mute/.claude/skills/loops/`. Cloning the repo gives the skill; Claude Code auto-discovers project skills under `.claude/skills/`.

## HITL contract

Only two run-time prompts are allowed, period:

1. **Step 1, gap report**: "to use pattern X, I need <gap>. Approve / deny / pick alternative." Batch one prompt for the whole report.
2. **Step 3, batched permission requests**: at the end of each cycle, all agents' gaps are batched into one prompt. User approves a subset.

Anything else surfaces only on halt or hard regression. No mid-iteration "should I…" prompts. If you find yourself wanting one, the loop is wrong — fix the gate or the menu entry, don't ask.

## Relationship to other skills

- **adx-loop:loop** — consumes the loop produced here for its inner iteration. ADX runs sequentially with queued harness fixes; loop-finder runs parallel variants. They compose: loop-finder picks the gate, ADX uses it to ship features.

Loop-finder is the foundation. If it has converged for a class, the downstream skills run smoother.

## Anti-patterns

- **Mid-iteration HITL prompts** — break the core promise. If a variant cannot self-verify, drop it from the cycle; do not ask the user to judge each iteration.
- **Skipping hard gates to make the metric look better** — variant that ships with `flake_rate > 0` is broken, not faster.
- **Letting `blindness_count` go un-counted** — agents will silently produce opaque output and the loop will "feel slow" without the metric showing why. Run the blindness checklist every cycle.
- **Auto-installing tools without HITL** — defeats the entire concentrate-HITL-at-permission-gates design. Every install crosses Step 1 or Step 3 batch approval.
- **Visual oracle without canary fixtures** — extends the gameability rule. magick SSIM is non-monotone under extreme corruption (full-white, full-noise can read as MORE similar than a real-but-wrong render). Insist on `known-bad/` fixtures for ANY of: `llm_judge`, `reward_model_preference_judge`, `target_conformance_oracle`, `visual_diff_oracle`. Fixtures must test MID-RANGE corruption (1-3 element edits, color shifts <30%) — not extremes.
- **Mixing gate + product variants in one cycle** — confuses adoption rule (lex for gates vs oracle-output for products) and contaminates measurement (gate changes shift the baseline). If a cycle's gate is unverified, run gate variants FIRST; only after the gate is canonical do product variants race.
- **Hardcoded ROOT path in iterate.sh** — any harness script with `ROOT="/abs/repo/path"` will race parallel worktree variants through main's binary. Always derive ROOT from `${BASH_SOURCE[0]}`. Use `templates/iterate.sh.tmpl` as the starting point — it encodes the correct pattern.
- **Shared artifact OUT dir across concurrent variants** — gates writing to `/tmp/shared-snap/` race when N>1 variants run in parallel. Always per-PID (`/tmp/foo-snap-$$`).
- **Codex variant agent for vision-required gates** — codex runtime is sandboxed without NSScreen; tao window construction panics on launch. Use codex for substantial Rust / algorithm work where rendering is NOT required; `general-purpose` for any vision-required task.
- **Caveman builder for measurement-required variants** — caveman:cavecrew-builder lacks the Bash tool; it can edit files but cannot run gates. Reserve for edit-only diff emitters.
- **Skipping the worktree bootstrap step** — every variant agent must run `helpers/bootstrap-worktree.sh` first. Without it, the agent measures stale state (older HEAD, missing tools/) and the result is meaningless.
- **Dispatching the entire skill to a subagent** — the cache and HITL touchpoints are stateful. Inner cycles can dispatch variants to subagents; the orchestration stays inline. Same constraint as `adx-loop:loop`.

## Bootstrap

If `~/.claude/loop-finder/blindness-rules.yaml` does not exist, write it with the default rule set:

```yaml
version: 1
rules:
  - id: opaque-exit
    description: Gate exits non-zero with empty stderr.
    match:
      exit_code: nonzero
      stderr: empty
  - id: orphan-artifact
    description: Gate writes an artifact to disk but does not print its path on stdout/stderr.
    match:
      wrote_file: true
      path_in_output: false
  - id: log-spam
    description: > 50 lines of output without a recognized verdict tag.
    match:
      stdout_lines_gt: 50
      contains_any:
        - PASS
        - FAIL
        - OK
        - ERR
        - ACCEPT
        - REJECT
        - '"verdict":'
      mode: none-of
  - id: binary-no-summary
    description: Gate writes a binary artifact (PNG/audio/video) without a textual summary line.
    match:
      wrote_binary: true
      stdout_has_summary: false
```

Adding a rule later is an HITL approval moment in itself.

## Origin

Derived from:
- `adx-loop:loop` (Karpathy autoresearch discipline applied to dev experience). Loop-finder is its prerequisite — adx-loop assumes the loop exists.
- mic-mute `tools/settings-preview/` (reference instance: headless probe sidecar + visual diff + odiff baseline + exit-code gate).
- Voyager / Self-Refine / AlphaEvolve (LLM-driven exploration with executable verifier).
- SWE-bench / Inspect harness (sandboxed agent harness as one menu pattern, not the whole story).

See `PRIOR_ART.md` in the plugin root for a 6-cluster landscape map comparing loop-finder to Meta-Harness (Lee 2026), AutoHarness (DeepMind 2026), DSPy/MIPRO/GEPA, TextGrad, FunSearch/AlphaEvolve, AFlow, ADAS, Karpathy autoresearch, Reflexion/Self-Refine, and others. Loop-finder's distinctness rests on the combination of: curated catalog + tooling preflight + lex+canary hard gates + worktree-parallel exploration + per-class cache keyed on `sha256(repo + domain + oracle)` + concentrated 2-batched-HITL discipline.

## Battle-test history

- 2026-05-27 first dogfood on mic-mute (4 cycles, 2 task classes). See `RETRO-CYCLE-4.md` for the 7 skill-meta findings shipped from that run.
