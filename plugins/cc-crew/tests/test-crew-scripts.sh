#!/bin/bash
# Offline tests for the crew's feedback script.
set -u
here=$(cd "$(dirname "$0")" && pwd)
scripts=$here/../scripts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name, condition...
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}

# feedback.sh: two entries, appended in order, each with its header.
export CC_CREW_HOME=$tmp/ledger
printf 'first entry\n' | bash "$scripts/feedback.sh" "builder" "session-1" >/dev/null
printf 'second entry\n' | bash "$scripts/feedback.sh" "page" "session-2" >/dev/null
ledger=$CC_CREW_HOME/feedback.md
check "feedback writes two headers" test "$(grep -c '^## ' "$ledger")" = 2
check "feedback keeps the order" test "$(grep -n 'first entry' "$ledger" | cut -d: -f1)" -lt "$(grep -n 'second entry' "$ledger" | cut -d: -f1)"
check "feedback records the piece and the session" bash -c "grep -q '· page' '$ledger' && grep -q 'Session: session-2' '$ledger'"
check "feedback needs a piece" bash -c "! bash '$scripts/feedback.sh' </dev/null"

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
