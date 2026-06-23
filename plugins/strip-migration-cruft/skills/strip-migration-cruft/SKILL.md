---
name: strip-migration-cruft
argument-hint: "[path or scope]"
disable-model-invocation: true
description: Scan a repo for transitional / migration / phase / wave / story / "old box" / "moved from X" / "legacy alias" cruft comments that document past project history rather than current behavior, categorize hits into safe-to-strip vs keep-semantic buckets, then propose surgical edits and execute after confirmation. Use whenever the user says "scan for migration comments", "remove phase comments", "nuke wave 1/wave 2 / story refs", "strip transitional cruft", "kill the migration matrix doc", "clean up roadmap pointers", "I don't want these old-box / replaced / formerly comments", "the codebase has too many migration / wave / phase narratives", or any variation expressing fatigue with project-history breadcrumbs in code and docs. Also covers complaints about repo noise from "punchlist", "rollout", "cutover", "Story 25", "Wave 2", "(Phase 1)", or "Authored as part of …" annotations.
---

# strip-migration-cruft

Repos accrue history breadcrumbs: `# Wave 1 gotcha`, `# Authored: Story 25, Wave 2`, `# moved from X to Y`, `## Phase 1 — Enable IOMMU`, `# Old Lenovo died, replaced 2026-05-06`, dedicated `migration-matrix.md` planning docs, archived roadmap pointers. They were useful while the work was in flight; once the work shipped they become noise — readers ask "is this still live?" and have to chase context that no longer matters.

This skill finds those breadcrumbs, separates **cruft** (safe to strip) from **semantic** (must keep — refers to live code behavior or active runbook step labels), proposes a precise edit list, and executes after the user confirms.

## When this skill triggers

Direct phrases:
- "scan for migration comments"
- "nuke / strip / remove wave 1 / wave 2 / story / phase / migration / transitional / roadmap / legacy / formerly / previously refs"
- "kill the migration matrix doc"
- "I don't want these old-box / replaced / lenovo / 'moved from X' comments"
- "clean up roadmap / archive pointers in CLAUDE.md / README.md"

Less direct cues:
- User shows a grep hit list and says "I don't want it" / "all of them"
- User complains about noise from `(Wave N)`, `Story N`, `Phase N`, `EXECUTED on YYYY-MM-DD`, `Authored as part of …`
- Code review where breadcrumb comments about past data-shape upgrades clutter the file

## Workflow

The skill runs in four phases. Stop after each and report — do not chain.

### 1. Scan

Run `scripts/scan.sh <repo-root>` (or run ripgrep directly with the patterns in `references/patterns.md`). The script searches for the full pattern catalog and emits `path:line: <matched_text>` rows.

Default excludes:
- `.git/`
- `node_modules/`, `dist/`, `build/`, `.venv/`, `target/`
- `docs/archive/**` (intentional historical archive — never strip without explicit user opt-in)

If the repo has its own archive directory under another name (e.g. `historical/`, `old/`, `attic/`), ask the user before scanning it.

### 2. Categorize

For every hit, assign one of five buckets. The categorization rules live in `references/buckets.md`. In short:

| Bucket | Default action | Example |
|---|---|---|
| **A. Transitional preamble** | Strip | `# Old Lenovo died, replaced 2026-05-06` |
| **B. Wave / Story / Phase narrative** | Strip | `# Authored: Story 25, Wave 2` |
| **C. Migration / roadmap docs** | Delete file (or strip if mixed) | `docs/migration-matrix.md` |
| **D. Procedural step labels** | KEEP, offer rename | VFIO `RUNBOOK.md`'s `## Phase 1 — Enable IOMMU` |
| **E. Code-semantic refs** | KEEP semantic, offer reword | `# legacy alias, used internally below` |

The critical judgment is **D vs B** and **E vs A/B**:

- A doc that uses `## Phase N — <title>` headers as sequential procedural steps (RUNBOOK / PLAYBOOK / GUIDE / HOWTO) is bucket D. Stripping the labels would break navigability. Default: keep; offer to rename `Phase` → `Step` if the user wants the word gone.
- A code comment that says `# legacy field` or `# Backfill path:` next to code that actively handles that field/path is bucket E — the comment describes *current* code behavior, not past history. Default: keep meaning, offer a reword that drops the "legacy"/"migration" framing.

If unsure, classify as borderline and ask the user.

### 3. Propose

Emit a categorized list. Group by bucket so the user can accept/reject per bucket rather than per line. Use this exact shape:

```
**A. Transitional preamble (cruft — strip)**
- path:line — quoted hit

**B. Wave / Story / Phase narrative (cruft — strip)**
- path:line — quoted hit

**C. Migration / roadmap docs (delete file or strip)**
- path — full file delete + N cross-refs to strip

**D. Procedural step labels (KEEP — these are step labels, not migration phases)**
- path:line — quoted hit
- offer: rename Phase → Step? (default no)

**E. Code-semantic refs (KEEP — refers to live code behavior)**
- path:line — quoted hit
- offer: reword to drop "legacy"/"migration" framing? (default no)

Proposed strip = buckets A + B + C. N files touched, M lines edited, K files deleted.
Confirm and I nuke; or say "all of them" / "skip D" / "skip C" / "only A" / etc.
```

Always end with a one-line scope summary and a list of selector phrases the user can reply with. Do not act yet.

### 4. Execute

Once the user confirms, edit files in parallel `Edit` calls. Rules:

- Strip whole lines when the comment is a standalone breadcrumb on its own line. Strip in-line phrases when the breadcrumb is embedded in a still-useful sentence (preserve the rest).
- Delete files only for bucket C, and only with explicit confirmation.
- For bucket D rename: change `Phase N` → `Step N` throughout the file (use `replace_all`) plus update any cross-refs that pointed at `Phase N` by name.
- For bucket E reword: keep the technical meaning. Replace `legacy X` with `X` (when standalone), or `flat X` / `prior schema X` when the comment specifically distinguishes from a newer shape. Replace `Backfill path:` with a literal description of what the branch does.
- Verify with a final `rg` pass and report any residual hits with their bucket. Hits in buckets D + E remaining is expected and correct.

## Pitfalls

- **Don't strip without categorizing.** A pure regex `s/Phase [0-9]//g` will corrupt VFIO-style runbooks where Phase is a step label.
- **Don't delete migration-matrix-style docs silently.** They often hold the only narrative explanation of why the repo is shaped the way it is. Mention what's being deleted and offer to keep it if the user wants the history preserved.
- **Don't blow past `docs/archive/**` or equivalent.** Archives are intentional. Surface the path and ask before touching.
- **Don't claim a comment is bucket-E semantic without reading the surrounding code.** If the "legacy" comment refers to code that no longer exists, it's actually bucket A and the comment is rot — strip it.
- **Live-migration, legacy PCI, schema migration** are real technical terms (Proxmox feature, hardware spec, DB concept). Never strip these by pattern alone; check context first.
- **The user's archive opt-out is sticky for the session.** If they say "skip the archive", remember it; don't re-ask.

## References

- `references/patterns.md` — full ripgrep pattern catalog grouped by bucket
- `references/buckets.md` — categorization decision tree + edge-case examples
- `scripts/scan.sh` — one-shot scanner that emits a categorized hit list

## Output expectations

- Be terse. The user typically invokes this skill because they already know the noise exists and want it gone. Don't restate the problem.
- Use the proposal template verbatim — the bucket headers and selector phrases at the end are how the user replies.
- Code edits should be surgical, not stylistic. Don't reflow paragraphs that happen to contain a Wave-N line; just drop the line.
