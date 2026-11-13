#!/bin/bash
# Offline tests for the crew's status line badge.
set -u
here=$(cd "$(dirname "$0")" && pwd)
badge=$here/../scripts/badge.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name, expected output, transcript content (or - for none)
  local name=$1 want=$2 content=$3 got
  if [ "$content" = - ]; then
    got=$(printf '{"session_id":"s"}' | bash "$badge")
  else
    printf '%s\n' "$content" > "$tmp/t.jsonl"
    got=$(printf '{"session_id":"s","transcript_path":"%s","model":{"id":"m"}}' "$tmp/t.jsonl" | bash "$badge")
  fi
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: got '$got'"; fails=$((fails + 1)); fi
}

typed='{"type":"user","message":{"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>\n<command-name>/cc-crew:chief-engineer</command-name>\n<command-args></command-args>"}}'
compacted='{"type":"system","subtype":"compact_boundary"}'
quoted='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"<command-name>/cc-crew:chief-engineer</command-name>"}]}}'
other='{"type":"user","message":{"role":"user","content":"<command-message>idea:idea</command-message>\n<command-name>/idea:idea</command-name>"}}'

check "shows after the command" "⚓ chief" "$typed"
check "stays on after a compaction" "⚓ chief" "$typed
$compacted"
check "ignores a quote of the command" "" "$quoted"
check "ignores other commands" "" "$other"
check "prints nothing without a transcript" "" -
missing=$(printf '{"transcript_path":"%s/none.jsonl"}' "$tmp" | bash "$badge"; echo "exit=$?")
if [ "$missing" = "exit=0" ]; then echo "ok   missing transcript exits 0 quietly"; else echo "FAIL missing transcript: $missing"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
