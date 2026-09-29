#!/usr/bin/env bash
# Run every offline test suite: plugins/*/tests/test-*.sh. Suites named live-*.sh spend
# tokens and never run here. Runs all suites even when one fails, then exits 1 if any did.
#
# Usage: scripts/test-offline.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

failed=""
ran=0
for suite in plugins/*/tests/test-*.sh; do
  [ -f "$suite" ] || continue
  ran=$((ran + 1))
  echo "=== $suite"
  bash "$suite" || failed="$failed $suite"
  echo
done

if [ "$ran" -eq 0 ]; then
  echo "no offline suites found" >&2
  exit 1
fi
if [ -n "$failed" ]; then
  echo "FAILED:$failed" >&2
  exit 1
fi
echo "All $ran offline suites passed."
