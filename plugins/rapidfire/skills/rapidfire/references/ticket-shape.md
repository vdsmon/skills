# Ticket shape

Frontmatter is the source of truth. `scripts/status.py` walks ticket files; nothing else maintains state.

Look at `.rapidfire/T*.md` to find the next ID. Slug = first 3-5 words of the title, kebab-case.

Write `.rapidfire/T<NN>-<slug>.md`:

```yaml
---
id: T<NN>
title: <one-line>
status: dispatched         # "queued" for /rapidfire queue
agent_type: caveman:cavecrew-builder | general-purpose
agent_name: rf-T<NN>-<slug>
model: haiku | sonnet | opus
bucket: trivial | moderate | complex | ambiguous
origin: user               # auto-set to supersede/retry/dep-cascade by automation
created_at: <ISO-8601 UTC>
depends_on: []             # list of T<NN> IDs that must be reported before this ticket dispatches
---

## Goal
<1-2 sentences>

## Files
- <path>

## Edits
<optional structured edits — lint-spec.py reads this section>

## Acceptance
- `<shell command>` exits 0 / prints `<expected>`

## Notes
<gotchas, anti-goals>
```

Fields the dispatcher writes after Step 6 (do not pre-populate): `agent_id`, `dispatched_at`. Fields the dispatcher writes after Step 0 notification: `status` (→ `reported`/`failed`), `finished_at`, `duration_ms`, `total_tokens`, `tool_uses`, `diff_stat`, `acceptance`, `agent_notes`, `files_touched`. Field the dispatcher writes after `/rapidfire commit`: `committed_at`.
