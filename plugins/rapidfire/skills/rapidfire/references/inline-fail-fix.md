# Inline FAIL fix (lead applies directly)

Conditions: failure root cause obvious AND fix ≤5 lines AND single file.

1. Apply repair inline via Edit.
2. Inherit metadata from the original failed dispatch BEFORE overwriting status: keep `agent_id`, `dispatched_at`, `total_tokens`, `tool_uses`. Set `finished_at` to repair time. Update `files_touched` and `diff_stat` to reflect the combined original+repair work. Preserve `agent_notes` (often explains the failure).
3. Set `status: reported`, `attempt: 2`, `recovered: inline`.
4. Append `## Lead repair` section with the lead's diff.

Anything bigger → `/rapidfire retry <id>`.
