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

plain() { sed $'s/\x1b\\[[0-9;]*m//g'; }

check() { # name, expected output without its colors, transcript content (or - for none)
  local name=$1 want=$2 content=$3 got
  if [ "$content" = - ]; then
    got=$(printf '{"session_id":"s"}' | bash "$badge" | plain)
  else
    printf '%s\n' "$content" > "$tmp/t.jsonl"
    got=$(printf '{"session_id":"s","transcript_path":"%s","model":{"id":"m"}}' "$tmp/t.jsonl" | bash "$badge" | plain)
  fi
  if [ "$got" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name: got '$got'"; fails=$((fails + 1)); fi
}

typed='{"type":"user","message":{"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>\n<command-name>/cc-crew:chief-engineer</command-name>\n<command-args></command-args>"}}'
compacted='{"type":"system","subtype":"compact_boundary"}'
quoted='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"<command-name>/cc-crew:chief-engineer</command-name>"}]}}'
other='{"type":"user","message":{"role":"user","content":"<command-message>idea:idea</command-message>\n<command-name>/idea:idea</command-name>"}}'

ended='{"type":"assistant","timestamp":"2020-01-01T00:00:00.000Z","message":{"stop_reason":"end_turn"}}'
running() { # tool name, its input as JSON (default none)
  local given='{}'
  [ $# -gt 1 ] && given=$2
  printf '{"type":"assistant","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","name":"%s","input":%s}]}}' "$1" "$given"
}

check "shows after the command, with the turn under way" "⚓ chief · ⚙ thinking" "$typed"
check "stays on after a compaction" "⚓ chief · ⚙ thinking" "$typed
$compacted"
check "ignores a quote of the command" "" "$quoted"
check "ignores other commands" "" "$other"
check "a running tool says what the turn does" "⚓ chief · ⚙ shell" "$typed
$(running Bash)
{\"type\":\"attachment\"}"
check "a running agent says its kind" "⚓ chief · ⚙ builder" "$typed
$(running Agent '{"subagent_type":"cc-crew:builder","description":"anything at all"}')"
check "an MCP tool says its server" "⚓ chief · ⚙ revelo-pipelines" "$typed
$(running mcp__revelo-pipelines__get_run)"
check "an open question is Victor's move" "⚓ chief · ✋ question" "$typed
$(running AskUserQuestion)"
check "a finished turn with nothing out is idle" "⚓ chief · 💤 idle" "$typed
$ended
{\"type\":\"system\",\"subtype\":\"stop_hook_summary\"}"
check "an interrupted turn is idle" "⚓ chief · 💤 idle" "$typed
{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user]\"}]}}"

# What the Stop hook says is still out when the turn ends; the session is "t", the transcript's name.
hook=$here/../hooks/turn-end.sh
stop() { printf '%s\n' "$typed" "$ended" > "$tmp/t.jsonl"; printf '{"session_id":"t","transcript_path":"%s","background_tasks":%s,"session_crons":%s}' "$tmp/t.jsonl" "$1" "${2:-[]}" | bash "$hook"; }
out=$(stop '[{"id":"a1","type":"subagent","agent_type":"cc-crew:builder","description":"a long free text"},{"id":"b1","type":"shell","description":"x"},{"id":"b2","type":"shell"}]'; echo "exit=$?")
if [ "$out" = "exit=0" ]; then echo "ok   the Stop hook prints nothing and exits 0"; else echo "FAIL Stop hook output: $out"; fails=$((fails + 1)); fi
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge" | plain)
if [ "$got" = "⚓ chief · ⏳ builder, 2 shells" ]; then echo "ok   background tasks by kind, never their text"; else echo "FAIL tasks: got '$got'"; fails=$((fails + 1)); fi
stop '[]' '[{"id":"c1","schedule":"5 12 18 11 *","recurring":false,"prompt":"p"}]'
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge" | plain)
if [ "$got" = "⚓ chief · ⏳ wakeup" ]; then echo "ok   a scheduled wakeup"; else echo "FAIL wakeup: got '$got'"; fails=$((fails + 1)); fi
stop '[{"id":"b1","type":"shell"}]'
printf '%s\n' "$typed" "$ended" '{"type":"user","timestamp":"2999-01-01T00:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}' > "$tmp/t.jsonl"
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge" | plain)
if [ "$got" = "⚓ chief · 💤 idle" ]; then echo "ok   a record older than the transcript's last entry is not used"; else echo "FAIL stale record: got '$got'"; fails=$((fails + 1)); fi
printf '%s\n' "$other" > "$tmp/o.jsonl"
printf '{"session_id":"o","transcript_path":"%s","background_tasks":[]}' "$tmp/o.jsonl" | bash "$hook"
if [ ! -e "$HOME/.claude/.cc-crew/turns/o.json" ]; then echo "ok   the Stop hook records only chief sessions"; else echo "FAIL recorded a session outside the role"; fails=$((fails + 1)); fi
rm -rf "$HOME/.claude/.cc-crew"; CC_CREW_STATUS=off stop '[{"id":"b1","type":"shell"}]'
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge" | plain)
if [ "$got" = "⚓ chief · 💤 idle" ]; then echo "ok   CC_CREW_STATUS=off turns the Stop hook off"; else echo "FAIL kill switch: got '$got'"; fails=$((fails + 1)); fi
rm -rf "$HOME/.claude/.cc-crew"

store=$HOME/.claude/plugins/store
mkdir -p "$store"
printf '{"watches:t":[{"name":"pr-121-checks","keep":false},{"name":"slack-thread","keep":true}],"watches:other":[{"name":"elsewhere"}]}' > "$store/cc-quiet-watch_x-1.json"
check "a finished turn with a watch armed waits on the watch" "⚓ chief · ⏳ pr-121-checks" "$typed
$ended"
printf '{"watches:t":[{"name":"batch-720"},{"name":"deploy"}]}' > "$store/cc-quiet-watch_y-2.json"
check "watches from every store count, two named and the rest counted" "⚓ chief · ⏳ pr-121-checks, batch-720 +1" "$typed
$ended"
rm -r "$store"
check "prints nothing without a transcript" "" -
missing=$(printf '{"transcript_path":"%s/none.jsonl"}' "$tmp" | bash "$badge"; echo "exit=$?")
if [ "$missing" = "exit=0" ]; then echo "ok   missing transcript exits 0 quietly"; else echo "FAIL missing transcript: $missing"; fails=$((fails + 1)); fi

# The plan the session holds; the session is the transcript's file name.
mkdir -p "$HOME" "$CC_CREW_PLANS/kettle"
printf '%s\n' "$typed" > "$tmp/sess-k.jsonl"
holds() { printf '{"session_id":"x","transcript_path":"%s"}' "$tmp/sess-k.jsonl" | bash "$badge" | plain; }
got=$(holds)
if [ "$got" = "⚓ chief · ⚙ thinking" ]; then echo "ok   a session that holds no plan shows the role and its status"; else echo "FAIL no plan: got '$got'"; fails=$((fails + 1)); fi
printf '# kettle\n\nPhase: building.\nWaiting on: Victor: the merge\nHeld by: sess-k\n\n## Progress\n\n- Work item 1: done.\n- Work item 2: under way.\n' > "$CC_CREW_PLANS/kettle/plan.md"
got=$(holds)
want="⚓ chief · kettle · 🔨 1/2 · ✋ the merge"
if [ "$got" = "$want" ]; then echo "ok   the held plan follows the role"; else echo "FAIL held plan: got '$got'"; fails=$((fails + 1)); fi
got=$(printf '{"transcript_path":"%s"}' "$tmp/sess-k.jsonl" | bash "$badge")
want=$'\e[1;94m⚓ chief · kettle · 🔨 1/2 · \e[38;5;208m✋ the merge\e[0m'
if [ "$got" = "$want" ]; then echo "ok   bold bright blue, the wait on Victor in orange"; else echo "FAIL colors: got '$got'"; fails=$((fails + 1)); fi
printf "%s\n" "$other" > "$tmp/t.jsonl"
got=$(printf '{"transcript_path":"%s"}' "$tmp/t.jsonl" | bash "$badge")
if [ -z "$got" ]; then echo "ok   no plan shown without the role"; else echo "FAIL plan without the role: got '$got'"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
