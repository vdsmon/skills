#!/usr/bin/env bash
# Test suite for usage-guard.sh + usage-sensor.sh. Plain bash, no test framework,
# macOS-only (the scripts themselves use BSD stat/date). Run directly:
#   bash plugins/cc-usage-guard/tests/test-usage-guard.sh [--soak]
# Every case points HOME at a throwaway dir so the real ~/.claude state is never touched.
#
# Not automatable here: the jq-missing branch. Both scripts prepend /opt/homebrew/bin
# to PATH internally, so a test cannot shadow jq away. Verified manually by editing the
# PATH export.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../hooks/usage-guard.sh"
SENSOR="$HERE/../hooks/usage-sensor.sh"

unset CLAUDE_USAGE_THRESHOLD CLAUDE_USAGE_THRESHOLD_5H CLAUDE_USAGE_THRESHOLD_WEEKLY \
  CLAUDE_USAGE_WARN_5H CLAUDE_USAGE_WARN_WEEKLY CLAUDE_USAGE_RESUME_BUFFER_MIN \
  CLAUDE_USAGE_REMIND_PARK_MIN CLAUDE_USAGE_REMIND_WARN_MIN \
  CLAUDE_USAGE_SENSOR_MAX_AGE_MIN CLAUDE_USAGE_RENDER_CMD CLAUDE_CONFIG_DIR 2>/dev/null

TESTHOME=$(mktemp -d "${TMPDIR:-/tmp}/usage-guard-test.XXXXXX")
if [ -z "$TESTHOME" ] || [ ! -d "$TESTHOME" ]; then
  echo "FATAL: could not create test home (mktemp failed)" >&2
  exit 1
fi
trap 'rm -rf "$TESTHOME"' EXIT
STATE_DIR="$TESTHOME/.claude/.usage-guard"
STATE="$STATE_DIR/usage.json"

PASS=0
FAIL=0

reset_state() {
  rm -rf "$STATE_DIR"
  mkdir -p "$STATE_DIR"
}

# run_guard <stdin-json> -> stdout
run_guard() {
  printf '%s' "$1" | HOME="$TESTHOME" bash "$GUARD"
}

stdin_json() { # <session_id> [agent_id] [hook_event]
  printf '{"hook_event_name":"%s","session_id":"%s","agent_id":"%s"}' \
    "${3:-PostToolUse}" "$1" "${2:-}"
}

fresh_state() { # <five_hour_pct>
  printf '{"schema":2,"five_hour":%s,"weekly":10,"five_hour_reset":%s,"weekly_reset":%s}\n' \
    "$1" "$(date -v+2H +%s)" "$(date -v+2d +%s)" > "$STATE"
}

make_stale() { touch -t 202601010000 "$STATE"; }

assert_contains() { # <name> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected output containing '$3', got: ${2:-<empty>}"
  fi
}

assert_silent() { # <name> <output>
  if [ -z "$2" ]; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected no output, got: $2"
  fi
}

assert_lacks() { # <name> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected output WITHOUT '$3', got: $2"
  else
    PASS=$((PASS + 1)); echo "ok: $1"
  fi
}

assert_matches() { # <name> <haystack> <ERE pattern>
  if printf '%s' "$2" | grep -qE "$3"; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected output matching '$3', got: ${2:-<empty>}"
  fi
}

# --- liveness gate -----------------------------------------------------------

reset_state
rm -rf "$STATE_DIR"
out=$(run_guard "$(stdin_json s-missing)")
assert_contains "missing state file emits fault" "$out" "state file missing"
out=$(run_guard "$(stdin_json s-missing)")
assert_silent "fault suppressed on second call same session" "$out"
out=$(run_guard "$(stdin_json s-missing2)")
assert_contains "fault fires again for a new session" "$out" "state file missing"

# the incident regression: empty-but-fresh state (torn read) must be silent
reset_state
: > "$STATE"
out=$(run_guard "$(stdin_json s-torn)")
assert_silent "empty fresh state is a transient skip" "$out"

reset_state
: > "$STATE"
make_stale
out=$(run_guard "$(stdin_json s-deadwrite)")
assert_contains "empty stale state emits unreadable fault" "$out" "state file unreadable"

reset_state
printf 'not json at all' > "$STATE"
out=$(run_guard "$(stdin_json s-garbage)")
assert_silent "garbage fresh state is a transient skip" "$out"

reset_state
printf 'not json at all' > "$STATE"
make_stale
out=$(run_guard "$(stdin_json s-garbage-stale)")
assert_contains "garbage stale state emits unreadable fault" "$out" "state file unreadable"

reset_state
printf '{"schema":1,"five":50}\n' > "$STATE"
out=$(run_guard "$(stdin_json s-skew)")
assert_contains "wrong schema emits version-skew fault" "$out" "state schema is '1'"

reset_state
fresh_state 50
make_stale
out=$(run_guard "$(stdin_json s-stale)")
assert_contains "stale schema-2 state emits staleness fault" "$out" "min old, max"

reset_state
: > "$STATE"
out=$(run_guard "$(stdin_json s-agent-fault a1)")
assert_silent "spawned agents never get sensor warnings" "$out"
rm -rf "$STATE_DIR"
out=$(run_guard "$(stdin_json s-agent-fault2 a1)")
assert_silent "spawned agents silent even on missing state" "$out"

# --- thresholds --------------------------------------------------------------

reset_state
fresh_state 50
out=$(run_guard "$(stdin_json s-under)")
assert_silent "under thresholds is silent" "$out"

reset_state
fresh_state 92
out=$(run_guard "$(stdin_json s-warn)")
assert_contains "warn threshold emits HEADS UP" "$out" "HEADS UP"
out=$(run_guard "$(stdin_json s-warn)")
assert_silent "warn throttled within interval same session" "$out"
out=$(run_guard "$(stdin_json s-warn-other)")
assert_contains "warn fires independently for another session" "$out" "HEADS UP"

reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-park)")
assert_contains "park threshold emits STOP" "$out" "STOP - usage at"

reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-park-agent a1)")
assert_contains "spawned agent at park gets WIND DOWN" "$out" "WIND DOWN"
reset_state
fresh_state 92
out=$(run_guard "$(stdin_json s-warn-agent a1)")
assert_silent "spawned agent at warn stays silent" "$out"

# --- cc-cache-keepalive chain --------------------------------------------------

KEEPALIVE_FLAG="$TESTHOME/.cc-cache-keepalive"

reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-park-noflag)")
assert_lacks "park without keepalive flag has no keepalive step" "$out" "cc-cache-keepalive"

touch "$KEEPALIVE_FLAG"
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-park-flag)")
assert_contains "park with keepalive flag adds the keepalive step" "$out" 'prompt: \"cc-cache-keepalive\"'
assert_contains "keepalive step embeds the sentinel reply contract" "$out" "cache-keepalive\\\" - no tool calls"
assert_contains "keepalive park renumbers the final step" "$out" "5. Then stop."

# reset closer than the ~50 min TTL margin: cache survives the park, no step needed
reset_state
printf '{"schema":2,"five_hour":98,"weekly":10,"five_hour_reset":%s,"weekly_reset":%s}\n' \
  "$(date -v+10M +%s)" "$(date -v+2d +%s)" > "$STATE"
out=$(run_guard "$(stdin_json s-park-short)")
assert_lacks "short park (reset < TTL margin) skips the keepalive step" "$out" "cc-cache-keepalive"
assert_contains "short park still numbers the final step 4" "$out" "4. Then stop."

reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-park-flag-agent a1)")
assert_lacks "spawned agent wind-down never schedules keepalive" "$out" "cc-cache-keepalive"

# interval override: empty flag = 30m (two anchored minutes), valid sub-hour values
# are honored, h/d or invalid fall back to 30m
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-ka-default)")
assert_matches "empty flag uses a 30m two-minute anchored cron" "$out" 'cron \`[0-9]+,[0-9]+ \* \* \* \*\`'

printf '1m\n' > "$KEEPALIVE_FLAG"
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-ka-1m)")
assert_contains "1m override becomes an every-minute cron" "$out" "cron \`* * * * *\`"

printf '10m\n' > "$KEEPALIVE_FLAG"
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-ka-10m)")
assert_matches "10m override builds a six-minute anchored list" "$out" 'cron \`[0-9]+(,[0-9]+){5} \* \* \* \*\`'

printf '2h\n' > "$KEEPALIVE_FLAG"
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-ka-2h)")
assert_matches "interval >= TTL falls back to 30m" "$out" 'cron \`[0-9]+,[0-9]+ \* \* \* \*\`'

printf 'banana\n' > "$KEEPALIVE_FLAG"
reset_state
fresh_state 98
out=$(run_guard "$(stdin_json s-ka-junk)")
assert_matches "invalid override falls back to 30m" "$out" 'cron \`[0-9]+,[0-9]+ \* \* \* \*\`'

rm -f "$KEEPALIVE_FLAG"

# --- stale snapshots (window reset already past) -------------------------------

reset_state
printf '{"schema":2,"five_hour":110,"weekly":10,"five_hour_reset":%s,"weekly_reset":%s}\n' \
  "$(date -v-1H +%s)" "$(date -v+2d +%s)" > "$STATE"
out=$(run_guard "$(stdin_json s-past-reset)")
assert_silent "over-threshold pct with past reset is ignored" "$out"

reset_state
printf '{"schema":2,"five_hour":110,"weekly":97,"five_hour_reset":%s,"weekly_reset":%s}\n' \
  "$(date -v-1H +%s)" "$(date -v+2d +%s)" > "$STATE"
out=$(run_guard "$(stdin_json s-past-reset-weekly)")
assert_contains "past-reset 5h window dropped, live weekly still fires" "$out" "weekly limit"

# --- sensor ------------------------------------------------------------------

reset_state
rm -rf "$STATE_DIR"
sensor_fixture='{"rate_limits":{"five_hour":{"used_percentage":42.5,"resets_at":1900000000},"seven_day":{"used_percentage":13.7,"resets_at":1900050000}}}'
printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
schema=$(jq -r '.schema' "$STATE" 2>/dev/null)
[ "$schema" = "2" ] && { PASS=$((PASS + 1)); echo "ok: sensor writes schema-2 state"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: sensor state schema '$schema' != 2"; }
leftovers=$(find "$STATE_DIR" -name 'usage.json.tmp.*' | wc -l | tr -d ' ')
[ "$leftovers" = "0" ] && { PASS=$((PASS + 1)); echo "ok: sensor leaves no tmp files"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: $leftovers tmp files left behind"; }

before=$(cat "$STATE")
printf 'total garbage' | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null 2>&1
after=$(cat "$STATE")
[ "$before" = "$after" ] && { PASS=$((PASS + 1)); echo "ok: garbage stdin does not clobber good state"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: good state clobbered by failed sensor run"; }

# stale snapshot: an idle session re-reports its frozen rate_limits; a past 5h reset
# must not be written at all, let alone clobber fresh state from a live session
stale_fixture='{"rate_limits":{"five_hour":{"used_percentage":110,"resets_at":1600000000},"seven_day":{"used_percentage":2,"resets_at":1900050000}}}'
before=$(cat "$STATE")
printf '%s' "$stale_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
after=$(cat "$STATE")
[ "$before" = "$after" ] && { PASS=$((PASS + 1)); echo "ok: stale snapshot does not clobber fresh state"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: stale snapshot clobbered fresh state"; }

rm -rf "$STATE_DIR"
printf '%s' "$stale_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
[ ! -f "$STATE" ] && { PASS=$((PASS + 1)); echo "ok: sensor refuses to write a stale snapshot"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: stale snapshot written to state"; }

# --- multi-profile (CLAUDE_CONFIG_DIR) ----------------------------------------

WORKPROF="$TESTHOME/profile-work"
reset_state
printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_CONFIG_DIR="$WORKPROF" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
prof_ok=1
[ -f "$WORKPROF/.usage-guard/usage.json" ] || prof_ok=0
[ -f "$STATE" ] && prof_ok=0
[ "$prof_ok" = "1" ] && { PASS=$((PASS + 1)); echo "ok: sensor writes to the CLAUDE_CONFIG_DIR profile, not the default"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: profile-scoped sensor write landed in the wrong dir"; }

printf '{"schema":2,"five_hour":98,"weekly":10,"five_hour_reset":%s,"weekly_reset":%s}\n' \
  "$(date -v+2H +%s)" "$(date -v+2d +%s)" > "$WORKPROF/.usage-guard/usage.json"
out=$(printf '%s' "$(stdin_json s-prof)" | HOME="$TESTHOME" CLAUDE_CONFIG_DIR="$WORKPROF" bash "$GUARD")
assert_contains "guard reads state from the CLAUDE_CONFIG_DIR profile" "$out" "STOP - usage at"
out=$(run_guard "$(stdin_json s-prof-default)")
assert_contains "default profile is independent (missing state faults)" "$out" "state file missing"

rm -rf "$WORKPROF"
out=$(printf '%s' "$(stdin_json s-prof-missing)" | HOME="$TESTHOME" CLAUDE_CONFIG_DIR="$WORKPROF" bash "$GUARD")
assert_contains "offline fix hint names the profile settings.json" "$out" "$WORKPROF/settings.json"

# --- marker GC ---------------------------------------------------------------

reset_state
fresh_state 50
touch "$STATE_DIR/usage-park-marker-old" "$STATE_DIR/sensor-warn-marker-old" "$STATE_DIR/usage.json.tmp.999"
touch -t 202601010000 "$STATE_DIR/usage-park-marker-old" "$STATE_DIR/sensor-warn-marker-old" "$STATE_DIR/usage.json.tmp.999"
touch "$STATE_DIR/usage-park-marker-current"
run_guard "$(stdin_json s-gc '' UserPromptSubmit)" >/dev/null
gc_ok=1
[ -f "$STATE_DIR/usage-park-marker-old" ] && gc_ok=0
[ -f "$STATE_DIR/sensor-warn-marker-old" ] && gc_ok=0
[ -f "$STATE_DIR/usage.json.tmp.999" ] && gc_ok=0
[ -f "$STATE_DIR/usage-park-marker-current" ] || gc_ok=0
[ "$gc_ok" = "1" ] && { PASS=$((PASS + 1)); echo "ok: GC removes old markers/tmps, keeps fresh ones"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: GC swept wrong files"; }

# --- soak (opt-in): concurrent atomic sensor writes vs guard reads -----------

if [ "${1:-}" = "--soak" ]; then
  reset_state
  fresh_state 50
  (
    i=0
    while [ $i -lt 200 ]; do
      printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
      i=$((i + 1))
    done
  ) &
  writer=$!
  offline=0
  j=0
  while [ $j -lt 500 ]; do
    out=$(run_guard "$(stdin_json "soak-$j")")
    case "$out" in *"SENSOR OFFLINE"*) offline=$((offline + 1));; esac
    j=$((j + 1))
  done
  wait "$writer"
  [ "$offline" = "0" ] && { PASS=$((PASS + 1)); echo "ok: soak - 0 SENSOR OFFLINE in 500 reads vs 200 writes"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: soak - $offline SENSOR OFFLINE emissions"; }
fi

# ------------------------------------------------------------------------------

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
