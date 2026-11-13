#!/usr/bin/env bash
# Offline checks for close's stop-self.sh: no-op outside a background session, and in one,
# `claude stop <id>` runs only after the turn leaves the working state.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../skills/close/scripts/stop-self.sh"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
wait_for() { for _ in $(seq 1 50); do [ -s "$1" ] && return 0; perl -e 'select(undef,undef,undef,0.1)'; done; return 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/close-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
printf '#!/usr/bin/env bash\necho "$@" >> "%s/calls"\n' "$tmp" > "$tmp/bin/claude"
chmod +x "$tmp/bin/claude"
export PATH="$tmp/bin:$PATH"

out=$(env -u CLAUDE_JOB_DIR bash "$script"); rc=$?
check "no job dir: exit 0" '[ $rc -eq 0 ]'
check "no job dir: says nothing to stop" '[[ "$out" == *"nothing to stop"* ]]'

job="$tmp/jobs/ab12cd34"; mkdir -p "$job"
echo '{ "state": "working" }' > "$job/state.json"
out=$(CLAUDE_JOB_DIR="$job" bash "$script"); rc=$?
check "job dir: exit 0" '[ $rc -eq 0 ]'
check "job dir: says armed" '[[ "$out" == *"stop armed"* ]]'
sleep 2
check "no stop while the turn is working" '[ ! -e "$tmp/calls" ]'
echo '{ "state": "done" }' > "$job/state.json"
wait_for "$tmp/calls"
check "stops its own id once the turn ends" '[ "$(cat "$tmp/calls" 2>/dev/null)" = "stop ab12cd34" ]'

rm -f "$tmp/calls"; echo '{ "state": "working" }' > "$job/state.json"
CLAUDE_JOB_DIR="$job" CLOSE_STOP_WAIT_SECONDS=1 bash "$script" >/dev/null
sleep 3
check "turn never ends: nothing stopped" '[ ! -e "$tmp/calls" ]'
exit $fail
