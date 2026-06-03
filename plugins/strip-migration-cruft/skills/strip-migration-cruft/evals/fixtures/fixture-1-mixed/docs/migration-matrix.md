# Migration matrix — repo reorg coupling inventory

Phase 0 gate for Track 2 and Track 3. Each row is a coupling between repo paths and runtime state.

**Status as of 2026-05-10:** Tracks 1 + 2 + T3a + T3b shipped. Every coupling below is closed.

## Couplings — closed state

### S1. systemd `homelab-doctor.service`

| Field | Value |
|---|---|
| File | `infra/vm/systemd/homelab-doctor.service` |
| Phase | T3a |
| Decision | rewritten in lockstep with `git mv scripts/doctor-heal.sh ops/doctor/doctor-heal.sh`. |
| Rollback | `git revert` of the T3a commit. |
| Status | 🟢 |

### S2. systemd `homelab-purge.service`

| Field | Value |
|---|---|
| Phase | T3a |
| Status | 🟢 |

## Phase unlocks — final

| Phase | Status |
|---|---|
| T1 (decoupled polish) | ✅ shipped |
| T2 compose dirs → `stacks/` | ✅ shipped |
| T3a `scripts/`→`ops/` rename | ✅ shipped |
| T3b ansible `roles/timers/` | ✅ shipped |
