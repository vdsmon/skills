#!/bin/bash
# Offline tests for the hook that keeps the chief engineer's role through a compaction.
set -u
here=$(cd "$(dirname "$0")" && pwd)
hook=$here/../hooks/keep-chief.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0

typed='{"type":"user","message":{"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>\n<command-name>/cc-crew:chief-engineer</command-name>"}}'
printf '%s\n' "$typed" > "$tmp/chief.jsonl"
printf '{"type":"user","message":{"role":"user","content":"hi"}}\n' > "$tmp/plain.jsonl"

run() { # source, transcript
  printf '{"session_id":"s","transcript_path":"%s","hook_event_name":"SessionStart","source":"%s"}' "$2" "$1" | bash "$hook"
}
check() { # name, condition...
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}

out=$(run compact "$tmp/chief.jsonl")
check "re-states the role after a compaction" bash -c "grep -q '^<cc-crew-chief>' <<<\"\$1\" && grep -q '^</cc-crew-chief>' <<<\"\$1\"" _ "$out"
check "carries the skill body" grep -q '## After a compaction' <<<"$out"
check "leaves out the frontmatter" bash -c "! grep -q 'disable-model-invocation' <<<\"\$1\"" _ "$out"
check "silent in a session without the role" test -z "$(run compact "$tmp/plain.jsonl")"
check "silent on a start that is not a compaction" test -z "$(run startup "$tmp/chief.jsonl")"
check "silent with the off switch" test -z "$(CC_CREW_KEEP_CHIEF=0 run compact "$tmp/chief.jsonl")"
check "exits 0 without input" bash -c "bash '$hook' </dev/null"

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
