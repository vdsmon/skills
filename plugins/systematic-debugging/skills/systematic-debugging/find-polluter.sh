#!/usr/bin/env bash
# Bisection script to find which test creates unwanted files/state.
# Runs each matching test file alone and stops at the first one that creates the path.
# Usage: find-polluter.sh <path_to_check> <test_pattern> [test_command]
#   test_pattern  find-style path pattern relative to the current dir, e.g. 'src/**/*.test.ts'
#   test_command  runs one test file, passed as its last argument (default: npm test)
# Exit: 0 no polluter, 1 polluter found, 2 nothing was tested (bad usage, no matching files,
# or the path already exists).
set -u

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "Usage: $0 <path_to_check> <test_pattern> [test_command]" >&2
  echo "Example: $0 '.git' 'src/**/*.test.ts' 'npx vitest run'" >&2
  exit 2
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="${2#./}"
TEST_CMD="${3:-npm test}"

# If the path is already there, every test would look clean.
if [ -e "$POLLUTION_CHECK" ]; then
  echo "'$POLLUTION_CHECK' already exists. Remove it, then run again." >&2
  exit 2
fi

# find prints ./-prefixed paths, and -path cannot match '**/' against zero
# directories, so also try the pattern with '**/' removed (src/top.test.ts).
TEST_FILES=$(find . -type f \( -path "./$TEST_PATTERN" -o -path "./${TEST_PATTERN//\*\*\//}" \) | sort -u)
if [ -z "$TEST_FILES" ]; then
  echo "No files under $(pwd) match '$TEST_PATTERN'. Nothing was tested." >&2
  exit 2
fi
TOTAL=$(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ')

echo "Searching for the test that creates: $POLLUTION_CHECK"
echo "Found $TOTAL test files, running each with: $TEST_CMD <file>"
echo ""

COUNT=0
while IFS= read -r TEST_FILE; do
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"

  # stdin from /dev/null so the test command cannot eat the file list
  $TEST_CMD "$TEST_FILE" > /dev/null 2>&1 < /dev/null || true

  if [ -e "$POLLUTION_CHECK" ]; then
    echo ""
    echo "FOUND POLLUTER: $TEST_FILE"
    echo "Created: $POLLUTION_CHECK"
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate: $TEST_CMD $TEST_FILE"
    exit 1
  fi
done <<< "$TEST_FILES"

echo ""
echo "No polluter found: no single test file created '$POLLUTION_CHECK' when run alone."
echo "If it still appears in a full run, the pollution depends on test order or on tests running together."
exit 0
