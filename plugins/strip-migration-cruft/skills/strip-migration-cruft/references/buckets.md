# Categorization decision tree

For every scan hit, walk this tree in order. First match wins.

## 1. Is the hit inside `docs/archive/**` (or equivalent opt-in archive)?

-> Skip. Archives are intentional. Surface the path in the proposal under a separate "skipped (archive)" header so the user knows it was scanned but not touched. Only strip with explicit `--include-archive` opt-in.

## 2. Is the hit a real technical term, not project history?

These look like cruft but are real technical terms. Never strip them by regex alone:

| Term | Why it's not cruft |
|---|---|
| `legacy PCI` | PCI spec name for pre-PCIe slot type |
| `live-migration` / `live migration` | Proxmox/VMware/KVM feature for moving running VMs |
| `schema migration` / `database migration` | DB framework concept (Alembic, Flyway, etc.) |
| `data migration` | Live ETL / backfill code |
| `migration trap` (in init comments) | Real DB init issue when restoring a populated data dir |
| `previously` in commit body referencing the diff being made | Describes the current change, not project history |
| `formerly` inside a deprecation notice in a public API | Tells callers what the old name was, so keep until removed |

-> **Bucket E** (code-semantic, keep). The comment is talking about a feature or spec, not project history.

## 3. Is the file a procedural runbook with sequential `## Phase N` headers?

Test:
- Filename matches `RUNBOOK|PLAYBOOK|GUIDE|HOWTO|TUTORIAL` (case-insensitive)
- File contains 3 or more distinct `## Phase [0-9]` headers
- Each header introduces a sequential procedural step (the body describes commands to run, not history)

-> **Bucket D** (keep, offer rename). Stripping the Phase labels would break the runbook's structure. The default action is keep; if the user wants the word gone for stylistic reasons, offer `Phase N` -> `Step N` rename.

Cross-references to `Phase N` from sibling files (e.g. `vfio.conf` says "captured in Phase 1 of RUNBOOK.md") also get the rename if applied, so keep them in sync.

## 4. Is the file's primary purpose migration tracking?

Test:
- Filename matches `migration-matrix|MIGRATION|PHASES|migration_plan|ROADMAP|WAVE-[0-9]`
- File title (first `#` line) names migration / phase / track / wave
- Body is dominated by a status table with 🟢/🔵 status emojis or "shipped / deferred" rows

-> **Bucket C** (delete file). Propose full-file delete + identify every cross-reference in other files that points at it. Cross-refs get stripped too.

If the file is mixed (some history, some still-useful narrative), offer to either strip the history portions or move them to a comment in a still-relevant file.

## 5. Is the hit a single-line preamble or top-of-file note describing prior infrastructure?

Markers:
- "Old <something> died/replaced"
- "Salvaged from"
- "Authored: Story N, Wave M"
- "Reference: <something> Wave N gotcha"
- "Historical reference only"
- "Read-only legacy"
- "EXECUTED on <date>"

-> **Bucket A** (transitional preamble, strip). Drop the line or in-line phrase.

If the line is mixed (e.g. `Dell OptiPlex ... . Old Lenovo died Apr 2026, replaced 2026-05-06. Salvaged WD 1TB HDD ...`), rewrite to keep the still-true facts and drop the history clause.

## 6. Is the hit a service-doc / compose-file annotation labeling work era?

Markers:
- "(Wave N)"
- "Story N"
- "shipped in Wave N"
- "Wave N punchlist"
- "Wave N sweep"
- "closed roadmap"

-> **Bucket B** (wave/story narrative, strip). The annotation labels when the work was done; the work itself is now load-bearing and lives in the code. The label is purely historical.

## 7. Is the hit a source-code comment about data-shape upgrades / fallbacks?

Markers:
- `# legacy alias`, `# legacy field`, `# legacy attempts`
- `# Backfill path:`
- `# Synthesize attempts from legacy fields`
- `# mirror the legacy /tracks schema`
- `# moved to the VM (see ...)`

Test: does the surrounding code actively handle the thing the comment describes? (Read 5 lines above and below.)

- **If yes**: -> **Bucket E** (keep semantic). The comment is documenting current code behavior. Offer to reword to drop the "legacy"/"migration" framing while preserving the technical meaning:
  - `# legacy alias, used internally below` -> drop the comment (the alias declaration is self-documenting) or rephrase `# alias, used internally below`
  - `# legacy field, kept for back-compat` -> `# kept for back-compat with v1 manifests`
  - `# Backfill path:` -> `# Even if X=True, do Y if not done yet`
  - `# mirror the legacy /tracks schema` -> `# mirror the /tracks schema`
- **If no** (the code it references no longer exists): -> **Bucket A** (rot, strip the comment entirely).

## 8. Edge case: bullet inside a gotchas / index doc

Patterns like `gotchas.md` line `- Postgres dir migration: wipe + chown ...`. The word "migration" here refers to a real init-time pitfall, not project history.

-> **Bucket E** (keep semantic), but offer a rewording that doesn't use the word "migration" (e.g. `Postgres dir init` / `Postgres dir reuse`). Same for `migration trap` headings in per-service `CLAUDE.md` files.

## Borderline reporting

When the tree gives an ambiguous answer (e.g. a `# legacy` comment where it's unclear whether the code still uses it), report it under a separate "**Borderline: ask user**" section in the proposal. Do not silently pick a bucket; the user is faster at judging these than you are.

## Worked examples

### D vs B: `RUNBOOK.md` headers

> `## Phase 1 — Enable IOMMU (low-risk, fully reversible)` followed by `## Phase 2 — Bind iGPU to vfio-pci` and `## Phase 3 — Attach iGPU to VM 100`.

Walk:
1. Not under archive, pass.
2. Not a false-positive term, pass.
3. Match: filename is `RUNBOOK.md`, contains 3 or more sequential `## Phase N` headers, bucket D.

Action: keep. If the user wants the word "Phase" gone for stylistic reasons, offer `Phase N` -> `Step N` rename across the file plus any sibling files that cross-reference these phases by name (e.g. `vfio.conf` says "Step 1 of RUNBOOK.md").

### E vs A: `lib.py` comment

> `# Keys inside `item` mirror the legacy /tracks track schema, plus we ask for album sub-fields ...`

Walk:
1. Not under archive, pass.
2. Not a false-positive term, pass.
3. Not a runbook, pass.
4. Not a migration doc, pass.
5. Not a preamble, pass.
6. Not a service-doc annotation, pass.
7. Match: `# legacy /tracks schema`, read surrounding code. The code currently uses `/items` (a 2026-02 API change); the comment describes how the *new* /items response object compares to the *old* /tracks schema. The code does still handle the shape the comment describes (the keys inside `item` it asks for).

Action: bucket E, keep semantic. Offer reword to drop "legacy": `# Keys inside item mirror the /tracks track schema, plus album sub-fields ...`. The drop of "legacy" loses no technical info because the surrounding context already says "Post-2026-02 /items wraps the track object as `item` (not `track`)".
