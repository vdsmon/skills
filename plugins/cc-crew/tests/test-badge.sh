#!/bin/bash
# Offline tests for the crew's status line badge.
set -u
here=$(cd "$(dirname "$0")" && pwd)
badge=$here/../scripts/badge.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0
# The badge reads the plan the session holds: keep it off the machine's real plans.
export HOME=$tmp/home CC_CREW_PLANS=$tmp/plans

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

# The plan the session holds; the session is the transcript's file name.
mkdir -p "$HOME" "$CC_CREW_PLANS/kettle"
printf '%s\n' "$typed" > "$tmp/sess-k.jsonl"
holds() { printf '{"session_id":"x","transcript_path":"%s"}' "$tmp/sess-k.jsonl" | bash "$badge"; }
got=$(holds)
if [ "$got" = "⚓ chief" ]; then echo "ok   a session that holds no plan shows the role alone"; else echo "FAIL no plan: got '$got'"; fails=$((fails + 1)); fi
printf '# kettle\n\nPhase: building.\nWaiting on: Victor: the merge\nHeld by: sess-k\n\n## Progress\n\n- Work item 1: done.\n- Work item 2: under way.\n' > "$CC_CREW_PLANS/kettle/plan.md"
got=$(holds)
want="⚓ chief · kettle · 🔨 1/2 · ⏳ the merge"
if [ "$got" = "$want" ]; then echo "ok   the held plan follows the role"; else echo "FAIL held plan: got '$got'"; fails=$((fails + 1)); fi
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge")
if [ -z "$got" ]; then echo "ok   no plan shown without the role"; else echo "FAIL plan without the role: got '$got'"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
