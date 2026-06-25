# Loop-finder retro: cycles 1-4 on mic-mute UI-visual + about-window-conformance

Date: 2026-05-27. First substantive deployment of `loop-finder` skill against two real classes.

## Classes exercised

| Class id | Task | Outcome |
|---|---|---|
| `4aa9e37f9396` | mic-mute settings-window snapshot regression (`UI-visual` + `exit-code`) | 1 cycle. V2 adopted (drop magick montage, -24% wall-clock). |
| `60bc3b8f2621` | mic-mute about-window matches user-provided target image (`about-window-conformance` + `similarity`) | 4 cycles. V1→G2→V5→V7. Threshold not crossed; halted at -36% dissim reduction with diminishing returns. |

## 7 skill-meta findings (queued upgrades)

### 1. Agent type for variant measurement

**Pain**: `caveman:cavecrew-builder` lacks Bash tool. Variant agents need to run `cargo build` + 10× measurement loops. Without Bash they edit-only and report "halted, need Bash for measurement".

**Workaround this run**: switched to `general-purpose` (full toolkit) or `codex:codex-rescue` (substantial Rust). Both have Bash.

**Fix for SKILL.md**: explicit guidance in Step 3 — variant agents MUST be `general-purpose` or `codex:codex-rescue`. Never `caveman:cavecrew-builder` for variants that measure. Caveman builders only for tasks that emit a diff and return without measurement.

### 2. ROOT derivation in iterate.sh templates

**Pain**: `tools/settings-preview/iterate.sh` hardcoded `ROOT="/Users/victordsm/repos/mic-mute"`. Worktree-isolated variants built and ran in the main repo. Concurrent variants raced on the same binary + about.rs. Surfaced TWICE — first in settings cycle 1, again in about cycle 1.

**Workaround**: each variant agent independently figured out the problem and either cloned `tools/` into their worktree + added `[workspace]` manually OR built a custom iterate.sh pointing at their worktree's target/. The agents diagnose themselves.

**Fix for menu.yaml** (`headless_probe_sidecar` pattern's `tooling_signature`): mandate that any harness script derive ROOT from `${BASH_SOURCE[0]}` location:

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -d "$ROOT/.git" ] || [ -f "$ROOT/.git" ]; then
  GIT_ROOT="$(cd "$ROOT" && git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$GIT_ROOT" ]; then ROOT="$GIT_ROOT"; fi
fi
```

Also add to Step-1 Smoke-test checklist: "verify iterate.sh works in a worktree by running it from a fresh worktree path; if it reaches into another path, it fails."

### 3. Worktree bootstrap from uncommitted state

**Pain**: V1 of cycle 1 left the about-window redesign in main's working tree, uncommitted. Cycle-2 gate-variant worktrees branched from `HEAD=4e77b04`, predating V1's edit. Variants measured the OLD design, not V1. G4 only got V1's data because it accidentally ran main's binary (target/ in main).

**Workaround**: agents manually copied main's WIP about.rs into their worktree. Most figured it out within a few steps.

**Fix for SKILL.md Step 3**: orchestrator must `git commit` WIP main state before launching variant agents. If user objects to committing experimental code, then template a bootstrap script that variants run as their first action:

```bash
# Bootstrap WIP main state into worktree if missing
if ! grep -q "DIVIDER_TOP" src/about.rs; then
  git checkout main -- src/about.rs assets/icons/
fi
```

Better: cycle 4 onward expects WIP committed. Document as orchestrator contract.

### 4. magick SSIM is dissimilarity, not similarity

**Pain**: ImageMagick 7's `compare -metric SSIM` emits structural DISSIMILARITY (0=identical, 0.5=max different) in the parenthesised normalized value, despite the metric name. The initial iterate.sh wrote `s >= 0.92` as ACCEPT — backwards. V1's agent caught it during cycle 1 ("self-compare = 0", "black-vs-white = 0.5"). Verified directly.

**Fix for menu.yaml** `target_conformance_oracle` entry:

```yaml
- id: target_conformance_oracle
  tooling_signature:
    - magick compare -metric SSIM  # emits dissimilarity, NOT similarity. Verify direction with self-vs-self test before pinning threshold.
    - LPIPS python lib (alex/vgg backbone) — emits perceptual distance [0,1+]
    - DINO patch similarity — emits per-patch cosine distance
  gap_detection:
    - threshold semantic not verified (run self-vs-self to confirm direction)
    - predicate direction assumed without test
  applies_when:
    - design mockup or screenshot exists as target
    - small render-vs-target deltas iteratively closed
  breaks_when:
    - composition fundamentally different (rotation/aspect) — SSIM bottoms out non-monotonically (see finding #5)
    - feature scale << frame scale — scalar SSIM under-rewards small improvements (e.g. icon adds invisible to overall dissim)
```

Also add to SKILL.md Step 1 smoke-test: "verify oracle direction with a known-identical and a known-different pair before pinning the threshold."

### 5. magick SSIM non-monotone under extreme corruption

**Pain**: G1's smoke canary found `compare -metric SSIM target render_brightened_200%` gives LOWER dissim than `compare -metric SSIM target clean_render`. Pure white render gives dissim 0.606. The function is NOT order-preserving when comparisons are dominated by composition difference; extreme color shifts can coincidentally land closer to whatever value the resized-target compresses to.

**Fix for menu.yaml** `target_conformance_oracle`:

```yaml
caveats:
  - magick SSIM is NOT order-preserving for extreme corruption when source and target compositions differ substantially. Use SSIM only when render and target share approximate layout; for "different layouts" cases prefer LPIPS or per-region SSIM.
  - Canary fixtures for visual gates must test MID-RANGE corruption (1-3 element edits, color shifts <30%), not extremes (full white, full invert, full noise) — magick SSIM may give false-pass on extremes.
```

### 6. Concurrent variants race on shared /tmp output dir

**Pain**: gate's hardcoded `OUT="/tmp/safemic-about-snap"` is shared across all concurrent runs. V5 and V6 racing in parallel both wrote `target-q1.png` etc to the same dir. V6 saw flake_rate=0.20 (2 corrupted runs out of 10). Surfaced in cycle 3.

**Fix for `headless_probe_sidecar` template**:

```bash
# Per-run isolated artifact dir. Avoids races between concurrent variants.
OUT="${SAFEMIC_PREVIEW_OUT:-/tmp/safemic-snap-$$}"
mkdir -p "$OUT"
# Clean up at exit unless caller asks to keep
trap '[ "${KEEP_OUT:-0}" = "0" ] && rm -rf "$OUT"' EXIT
```

Or: parameterize OUT and have the orchestrator pass per-variant paths.

### 7. Lex rule for product variants vs gate variants

**Pain**: cycle 3 V5 won on oracle dissim (-10.8%) but had blindness unchanged (0), wall regressed (5.86 → 7.40s in isolation), tokens unchanged. Under loop-finder's lex rule (`blindness → wall → tokens`), no perf dim improved ≥5%. Strict rule: REJECT. But V5 is the clear product winner — the oracle output (dissim) is the actual success target for product iteration.

**Root cause**: SKILL.md uses a single lex rule for all variants. But:
- For GATE variants (cycle 2 G2 etc), lex perf dims ARE the goal — we're measuring loop-as-artifact quality.
- For PRODUCT variants (cycle 3 V4/V5/V6/V7), oracle output is the goal — perf dims are secondary.

**Fix for SKILL.md**: separate the rule into two cases:

```markdown
### Adoption rules

**Gate variants** (variants that change the gate pipeline): rank by lex perf-dim rule. Hard gates `flake_rate=0` + `canary_pass`. First differing perf dim ≥5% in winner's favor decides.

**Product variants** (variants that change the system under test, gate unchanged): rank by oracle output (the gate's verdict value or score). Hard gates same. Perf dims are surfaced but not decisive — they measure loop cost, not product progress.

The orchestrator declares which type of variant is running before Step 3 spawns.
```

## Other accumulated lessons (not in the 7 but worth)

- **G3 LPIPS pre-trained on ImageNet has weak priors for UI imagery**. AlexNet judges V1 (sim 0.88 per SSIM) at LPIPS 0.48 (far above its 0.15 "perceptually similar" threshold). Either V1 really is perceptually far, or AlexNet doesn't carry UI-design priors. VGG/Squeeze backbones might be better. Worth a cycle 5 if pursued.

- **Visual-lex blindness-rule undercoverage**: the existing rules in `~/.claude/loop-finder/blindness-rules.yaml` don't catch "binary artifact referenced in failure path requires inspection". Scalar dissim output is technically not blind by those rules — but agents must Read the PNG to understand WHERE the diff lives. New rule needed:

```yaml
- id: binary-artifact-in-failure-path
  description: Gate exits non-zero AND its output names a binary artifact path (PNG/JPG/etc) without spatial summary stats.
  match:
    exit_code: nonzero
    contains_any_path_ext: [.png, .jpg, .jpeg, .gif, .bmp, .webp, .mov, .mp4, .wav]
    contains_spatial_summary: false  # e.g., "q1:", "x:", "region:", "px_changed:", etc.
```

This rule would have penalized cycle-0 baseline (blindness 0 currently, should have been 1+).

## Sidecar version-source bug

`tools/about-preview/Cargo.toml` declares its own package version (0.0.0). `env!("CARGO_PKG_VERSION")` in about.rs returns 0.0.0 when compiled into the sidecar — so the version displayed in headless renders is wrong. V1 worked around by hardcoding "v0.5.1".

**Fix**: add `tools/about-preview/build.rs` that reads parent `Cargo.toml` and emits a compile-time constant. Or pass via env var `SAFEMIC_PARENT_VERSION` from iterate.sh.

Not on the 7 because it's repo-specific, not a skill-level concern. Note for future.

## Files this retro affects

- `~/repos/personal/skills/plugins/loop-finder/skills/loop-finder/SKILL.md` — adoption rules split, agent-type guidance, smoke-test oracle-direction check
- `~/repos/personal/skills/plugins/loop-finder/skills/loop-finder/menu.yaml` — `target_conformance_oracle` caveats, tooling_signature notes, `headless_probe_sidecar` ROOT derivation requirement
- `~/.claude/loop-finder/blindness-rules.yaml` — `binary-artifact-in-failure-path` rule
- iterate.sh template recommendation — per-PID OUT dir

## Halt state

- Class `4aa9e37f9396` (settings UI-visual): cycle 1 only, V2 adopted.
- Class `60bc3b8f2621` (about target-conformance): cycle 4, V7 adopted, halt on diminishing returns.

Resume conditions:
- Want G5 fine-patch gate (16×16 grid) → could push V7 further by rewarding octocat.
- Want LPIPS hybrid (per-quadrant LPIPS) → real perceptual judgment.
- Tighter target match → font rasterization debugging required (out of loop scope).

Otherwise: ship the 7 fixes into the skill plugin, then exercise loop-finder against a non-UI class to validate the algorithm generalizes (popup HUD, mic.rs unit-test class, etc).
