# Postgres major-version upgrade runbook

**Goal**: upgrade Postgres from 14 to 16 on the analytics DB without data loss.

**Risk tier**: HIGH. The pg_upgrade step is destructive on the in-place data directory.

## Phase 1 — Pre-flight checks

Verify replication lag is zero and no long-running transactions are open.

```bash
psql -c "SELECT * FROM pg_stat_replication;"
psql -c "SELECT pid, query FROM pg_stat_activity WHERE state = 'active' AND xact_start < now() - interval '5 minutes';"
```

## Phase 2 — Take a fresh backup

```bash
pg_dumpall > /backup/analytics-pre-upgrade.sql
```

Verify the dump is at least 90% of last night's size.

## Phase 3 — Stop writers and run pg_upgrade

```bash
systemctl stop pgbouncer
pg_upgrade --old-bindir=/usr/lib/postgresql/14/bin --new-bindir=/usr/lib/postgresql/16/bin
```

## Phase 4 — Bring back online

```bash
systemctl start postgresql@16-main
systemctl start pgbouncer
```

Run `analyze` on all tables before re-enabling traffic.

## Rollback

If `pg_upgrade` fails midway, restore from the dump captured in Phase 2.
