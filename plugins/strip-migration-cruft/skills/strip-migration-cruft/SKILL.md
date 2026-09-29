---
name: strip-migration-cruft
argument-hint: "[path or scope]"
disable-model-invocation: true
description: Finds comments and docs narrating past project history (phase, wave, story, migration, legacy-alias breadcrumbs), sorts safe-to-strip from keep-semantic, and edits after confirmation.
---

# strip-migration-cruft

Repos accrue history breadcrumbs: `# Wave 1 gotcha`, `# Authored: Story 25, Wave 2`, `# moved from X to Y`, `## Phase 1 — Enable IOMMU`, `# Old Lenovo died, replaced 2026-05-06`, dedicated `migration-matrix.md` planning docs, archived roadmap pointers. They were useful while the work was in flight; once the work shipped they become noise, and readers ask "is this still live?" and have to chase context that no longer matters.

This skill finds those breadcrumbs, separates **cruft** (safe to strip) from **semantic** (must keep, refers to live code behavior or active runbook step labels), proposes a precise edit list, and executes after the user confirms.

## Workflow

The skill runs in four phases. Stop after each and report, do not chain.

### 1. Scan

Run `scripts/scan.sh <repo-root>` from this skill's directory. It holds the full pattern catalog and prints `path:line: <matched_text>` rows grouped by bucket, plus a Borderline group of raw hits no bucket claimed.

Default excludes:
- `.git/`
- `node_modules/`, `dist/`, `build/`, `.venv/`, `target/`
- any `archive/` dir, such as `docs/archive/**` (intentional historical archive, never strip without explicit user opt-in; pass `--include-archive` once the user opts in)

If the repo has its own archive directory under another name (e.g. `historical/`, `old/`, `attic/`), ask the user before scanning it.

### 2. Categorize

For every hit, assign one of five buckets. The categorization rules, including the technical terms that only look like cruft, live in `references/buckets.md`. In short:

| Bucket | Default action | Example |
|---|---|---|
| **A. Transitional preamble** | Strip | `# Old Lenovo died, replaced 2026-05-06` |
| **B. Wave / Story / Phase narrative** | Strip | `# Authored: Story 25, Wave 2` |
| **C. Migration / roadmap docs** | Delete file (or strip if mixed) | `docs/migration-matrix.md` |
| **D. Procedural step labels** | KEEP, offer rename | VFIO `RUNBOOK.md`'s `## Phase 1 — Enable IOMMU` |
| **E. Code-semantic refs** | KEEP semantic, offer reword | `# legacy alias, used internally below` |

The critical judgment is **D vs B** and **E vs A/B**:

- A doc that uses `## Phase N — <title>` headers as sequential procedural steps (RUNBOOK / PLAYBOOK / GUIDE / HOWTO) is bucket D. Stripping the labels would break navigability. Default: keep, and offer to rename `Phase` to `Step` if the user wants the word gone.
- A code comment that says `# legacy field` or `# Backfill path:` next to code that actively handles that field/path is bucket E, since the comment describes *current* code behavior, not past history. Default: keep meaning, offer a reword that drops the "legacy"/"migration" framing.

If unsure, classify as borderline and ask the user.

### 3. Propose

Emit a categorized list. Group by bucket so the user can accept/reject per bucket rather than per line. Use this exact shape:

```
**A. Transitional preamble (cruft, strip)**
- path:line: quoted hit

**B. Wave / Story / Phase narrative (cruft, strip)**
- path:line: quoted hit

**C. Migration / roadmap docs (delete file or strip)**
- path: full file delete + N cross-refs to strip

**D. Procedural step labels (KEEP, these are step labels, not migration phases)**
- path:line: quoted hit
- offer: rename Phase to Step? (default no)

**E. Code-semantic refs (KEEP, refers to live code behavior)**
- path:line: quoted hit
- offer: reword to drop "legacy"/"migration" framing? (default no)

Proposed strip = buckets A + B + C. N files touched, M lines edited, K files deleted.
Confirm and I nuke; or say "all of them" / "skip D" / "skip C" / "only A" / etc.
```

Always end with a one-line scope summary and a list of selector phrases the user can reply with. Do not act yet.

### 4. Execute

Once the user confirms, edit files in parallel `Edit` calls. Rules:

- Strip whole lines when the comment is a standalone breadcrumb on its own line. Strip in-line phrases when the breadcrumb is embedded in a still-useful sentence (preserve the rest).
- Delete files only for bucket C, and only with explicit confirmation.
- For bucket D rename: change `Phase N` to `Step N` throughout the file (use `replace_all`) plus update any cross-refs that pointed at `Phase N` by name.
- For bucket E reword: keep the technical meaning. Replace `legacy X` with `X` (when standalone), or `flat X` / `prior schema X` when the comment specifically distinguishes from a newer shape. Replace `Backfill path:` with a literal description of what the branch does.
- Verify with a final `scripts/scan.sh` pass and report any residual hits with their bucket. Hits in buckets D + E remaining is expected and correct.

## Pitfalls

- **Don't strip without categorizing.** A pure regex `s/Phase [0-9]//g` will corrupt VFIO-style runbooks where Phase is a step label.
- **Don't delete migration-matrix-style docs silently.** They often hold the only narrative explanation of why the repo is shaped the way it is. Mention what's being deleted and offer to keep it if the user wants the history preserved.
- **Don't blow past `docs/archive/**` or equivalent.** Archives are intentional. Surface the path and ask before touching.
- **Don't claim a comment is bucket-E semantic without reading the surrounding code.** If the "legacy" comment refers to code that no longer exists, it's actually bucket A and the comment is rot, so strip it.
- **Live-migration, legacy PCI, schema migration** are real technical terms (Proxmox feature, hardware spec, DB concept). Never strip these by pattern alone; check context first.
- **The user's archive opt-out is sticky for the session.** If they say "skip the archive", remember it; don't re-ask.

## Output expectations

- Be terse. The user typically invokes this skill because they already know the noise exists and want it gone. Don't restate the problem.
- Use the proposal template verbatim, since the bucket headers and selector phrases at the end are how the user replies.
- Code edits should be surgical, not stylistic. Don't reflow paragraphs that happen to contain a Wave-N line; just drop the line.
