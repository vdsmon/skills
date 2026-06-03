# Pattern catalog

The full ripgrep pattern set, grouped by bucket. Use these when running `scripts/scan.sh` or invoking `rg` directly.

## Master regex (case-insensitive)

```
(phase [0-9]|wave[ -][0-9]|story [0-9]+|track [0-9]|migration matrix|migration-matrix|migration history|migration plan|roadmap|punchlist|rollout|cutover|backfill|formerly|previously|legacy|deprecated|transitioned from|moved (from|to) |replaced (on |20[0-9]{2}|with )|old (server|box|host|lenovo|dell|build)|now (lives on|runs on|owned by)|EXECUTED on [0-9]|authored (as part of |: story|: wave)|shipped in (wave|phase|track)|closed roadmap|archive (dir|directory|pointer))
```

## Per-bucket pattern hints

### Bucket A — Transitional preamble

Single-line or short-paragraph preambles in `CLAUDE.md`, `README.md`, top-of-file headers, or compose comments:

```
old (server|box|host|lenovo|dell|imac)
replaced (on |20[0-9]{2}-)
salvaged from
died (apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar) 20
read-only legacy
historical reference only
```

### Bucket B — Wave / Story / Phase narrative

`(Wave N)` / `Story N` / `Track N` annotations on commits, file headers, runbook intros, gotcha bullets:

```
\(wave [0-9]\)
\(story [0-9]+\)
\(track [0-9]\)
authored: story [0-9]+, wave [0-9]
shipped in (wave|phase|track) [0-9]
wave [0-9] gotcha
wave [0-9] punchlist
wave [0-9] sweep
closed roadmap
```

### Bucket C — Migration / roadmap docs

Files whose entire purpose is migration tracking:

```
docs/migration-matrix.md
docs/migration_plan.md
MIGRATION.md
PHASES.md
WAVE-[0-9]*.md
ROADMAP.md  (if status is "closed" / "shipped")
docs/archive/  (only with explicit opt-in)
```

Signal phrases inside such docs:

```
phase 0 gate
status as of 20[0-9]{2}
🟢|🔵.*shipped
```

### Bucket D — Procedural step labels (KEEP)

Doc patterns where Phase N is a step label, not migration history. Heuristic: the file is named `RUNBOOK.md` / `PLAYBOOK.md` / `GUIDE.md` / `HOWTO.md` AND contains ≥3 sequential `## Phase N — <title>` headers.

```
^## Phase [0-9] — .+
^### [0-9]\.[0-9] — .+ (sub-steps under a Phase header)
```

Treat as bucket D. Strip would corrupt navigability. Offer rename `Phase` → `Step` instead.

### Bucket E — Code-semantic refs (KEEP)

Inside source files where the comment refers to current code behavior:

```
# legacy (alias|field|attempts|schema|tracks)
# Backfill path:
# Synthesize.*from legacy fields
# (mirror|matches) the legacy .*schema
schema migration   (database concept, not project history)
live-migration     (Proxmox/VMware feature name)
legacy PCI         (PCI spec term)
```

Default: keep the comment, optionally reword to drop the "legacy" / "migration" framing while preserving the technical meaning.

## False-positive guards

These look like cruft but are real technical terms. Never strip by regex alone:

| Term | Why it's not cruft |
|---|---|
| `legacy PCI` | PCI spec name for pre-PCIe slot type |
| `live-migration` / `live migration` | Proxmox/VMware/KVM feature for moving running VMs |
| `schema migration` / `database migration` | DB framework concept (Alembic, Flyway, etc.) |
| `data migration` | Live ETL / backfill code |
| `migration trap` (in init comments) | Real DB init issue when restoring a populated data dir |
| `previously` in commit body referencing the diff being made | Describes the current change, not project history |
| `formerly` inside a deprecation notice in a public API | Tells callers what the old name was — keep until removed |

If a hit matches one of these, classify as bucket E and keep by default.
