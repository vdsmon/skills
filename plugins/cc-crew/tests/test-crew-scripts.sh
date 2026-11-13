#!/bin/bash
# Offline tests for the crew's two small scripts: scope.sh and feedback.sh.
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
key() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"; }

# scope.sh: on adds the one key, other keys stay, off removes it.
repo=$tmp/repo
mkdir -p "$repo/.claude"
printf '{"permissions": {"allow": ["Bash(ls)"]}}\n' > "$repo/.claude/settings.local.json"
bash "$scripts/scope.sh" on "$repo" >/dev/null 2>&1
check "scope on sets the style" test "$(key "$repo/.claude/settings.local.json" outputStyle)" = "cc-crew:chief-engineer"
check "scope on keeps other keys" grep -q 'Bash(ls)' "$repo/.claude/settings.local.json"
bash "$scripts/scope.sh" off "$repo" >/dev/null 2>&1
check "scope off removes the style" test -z "$(key "$repo/.claude/settings.local.json" outputStyle)"
check "scope off keeps other keys" grep -q 'Bash(ls)' "$repo/.claude/settings.local.json"
fresh=$tmp/fresh
mkdir -p "$fresh"
bash "$scripts/scope.sh" on "$fresh" >/dev/null 2>&1
check "scope on creates the file when missing" test "$(key "$fresh/.claude/settings.local.json" outputStyle)" = "cc-crew:chief-engineer"
check "scope refuses a missing folder" bash -c "! bash '$scripts/scope.sh' on '$tmp/nowhere'"

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
