## Summary

This PR introduces hourly grouping to `tally report` — a crucial improvement for on-call workflows.

## Changes

- `src/tally/report.py`: adds the `--by hour` option; the default stays daily.
- `src/tally/csv_out.py`: adds the `hour` column.
- `tests/test_report.py`: covers hourly buckets.
- **Docs:** the README explains the new flag.

## Notes

Tested locally in /Users/someone/work/tally with the full log set.

Generated with [Claude Code](https://claude.com/claude-code)
