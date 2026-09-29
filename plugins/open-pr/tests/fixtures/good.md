`tally report` now groups log lines by hour as well as by day, because the on-call team asked for hourly counts during incidents. The daily report is unchanged. Hourly buckets use UTC, and local time zones are not supported yet.

If you script against the CSV output, the new `hour` column comes second.

## What changes

- `tally report --by hour` prints one row per hour. `--by day` stays the default.
- The CSV output gains an `hour` column, empty for daily reports.
- Buckets with no lines are skipped, as the daily report already does.

## Tested

`make check` passes. I also ran the hourly report on a week of real logs and compared three hours by hand with `grep -c`.

<details>
<summary>Hourly counts for one sample day</summary>

| hour | lines |
|---|---|
| 00 | 1204 |
| 01 | 998 |

```text
$ tally report --by hour logs/2026-01-05.log
00  1204
01   998
```

</details>

<!-- REVIEW_BOT_SUMMARY -->
---
> **Low risk** — adds a grouping option; the default path is untouched; covered by tests.
<!-- /REVIEW_BOT_SUMMARY -->
