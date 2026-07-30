#!/usr/bin/env bash
# Test suite for usage-guard.sh + usage-poller.sh + usage-sensor.sh. Plain bash, no framework,
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
POLLER="$HERE/../hooks/usage-poller.sh"

unset CLAUDE_USAGE_THRESHOLD CLAUDE_USAGE_THRESHOLD_5H CLAUDE_USAGE_THRESHOLD_WEEKLY \
  CLAUDE_USAGE_WARN_5H CLAUDE_USAGE_WARN_WEEKLY CLAUDE_USAGE_RESUME_BUFFER_MIN \
  CLAUDE_USAGE_REMIND_PARK_MIN CLAUDE_USAGE_REMIND_WARN_MIN \
  CLAUDE_USAGE_SENSOR_MAX_AGE_MIN CLAUDE_USAGE_RENDER_CMD CLAUDE_CONFIG_DIR \
  CLAUDE_USAGE_POLL_INTERVAL_SEC CLAUDE_USAGE_POLL_TIMEOUT_SEC \
  CLAUDE_USAGE_KEYCHAIN_SERVICE CLAUDE_USAGE_ENDPOINT CLAUDE_USAGE_SENSOR_DEFER_SEC 2>/dev/null

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

# precedence: the sensor's snapshot can be hours old yet still inside its window, so it
# must not overwrite fresher state (the poller's live numbers) - but it must take over
# once that state ages out
reset_state
printf '{"schema":2,"five_hour":11,"weekly":22,"five_hour_reset":%s,"weekly_reset":%s}\n' \
  "$(date -v+2H +%s)" "$(date -v+2d +%s)" > "$STATE"
fresh_written=$(cat "$STATE")
printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
[ "$fresh_written" = "$(cat "$STATE")" ] && { PASS=$((PASS + 1)); echo "ok: sensor defers to state fresher than the defer window"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: sensor overwrote fresher state"; }
printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_SENSOR_DEFER_SEC=0 CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
[ "$fresh_written" != "$(cat "$STATE")" ] && { PASS=$((PASS + 1)); echo "ok: sensor writes once the state ages past the defer window"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: sensor stayed deferred with defer window 0"; }

# --- poller ------------------------------------------------------------------
# Never touches the real account: the keychain service name is forced to a nonexistent
# one (a real `security` lookup ignores HOME, so this is the only way to isolate it), the
# token comes from a fake per-profile .credentials.json, and the endpoint is a local
# fixture server. NO_TOKEN also proves the poller does not fall back to the login item.
NO_KEYCHAIN="cc-usage-guard-test-no-such-service"
FAKE_CREDS='{"claudeAiOauth":{"accessToken":"test-token-not-real"}}'
POLLER_ERR="$STATE_DIR/poller-last-error"

run_poller() { # <endpoint> [extra env assignments...]
  local ep="$1"; shift
  env HOME="$TESTHOME" CLAUDE_USAGE_KEYCHAIN_SERVICE="$NO_KEYCHAIN" \
    CLAUDE_USAGE_ENDPOINT="$ep" CLAUDE_USAGE_POLL_TIMEOUT_SEC=3 "$@" \
    bash "$POLLER" </dev/null 2>&1
}

reset_state
printf '%s' "$FAKE_CREDS" > "$TESTHOME/.claude/.credentials.json"

# fixture body: fractional seconds + a +00:00 offset, the shape the real endpoint returns
FIXTURE="$TESTHOME/usage-fixture.json"
cat > "$FIXTURE" <<'JSON'
{"five_hour":{"utilization":2.0,"resets_at":"2026-07-30T15:09:59.935998+00:00"},
 "seven_day":{"utilization":97.0,"resets_at":"2026-07-30T20:00:00.936019+00:00"}}
JSON

if command -v python3 >/dev/null 2>&1; then
  PORT_FILE="$TESTHOME/fixture-port"
  SEEN_AUTH="$TESTHOME/fixture-auth"
  python3 - "$FIXTURE" "$PORT_FILE" "$SEEN_AUTH" >/dev/null 2>&1 <<'PY' &
import http.server, socketserver, sys
body = open(sys.argv[1], 'rb').read()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # record the bearer token so a test can prove which credential source was used
        open(sys.argv[3], 'w').write(self.headers.get('Authorization', ''))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
open(sys.argv[2], 'w').write(str(srv.server_address[1]))
srv.serve_forever()
PY
  FIXTURE_SRV=$!
  trap 'kill "$FIXTURE_SRV" 2>/dev/null; rm -rf "$TESTHOME"' EXIT
  waited=0
  while [ ! -s "$PORT_FILE" ] && [ "$waited" -lt 50 ]; do sleep 0.1; waited=$((waited + 1)); done
  PORT=$(cat "$PORT_FILE" 2>/dev/null)
fi

if [ -n "${PORT:-}" ]; then
  EP="http://127.0.0.1:$PORT/api/oauth/usage"
  out=$(run_poller "$EP")
  assert_silent "poller prints nothing (its stdout would land in the model's context)" "$out"
  schema=$(jq -r '.schema' "$STATE" 2>/dev/null)
  [ "$schema" = "2" ] && { PASS=$((PASS + 1)); echo "ok: poller writes schema-2 state"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: poller state schema '$schema' != 2"; }
  got=$(jq -r '[.five_hour,.weekly,.five_hour_reset,.weekly_reset]|@tsv' "$STATE" 2>/dev/null)
  want_5h=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' '2026-07-30T15:09:59' +%s 2>/dev/null)
  want_wk=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' '2026-07-30T20:00:00' +%s 2>/dev/null)
  assert_contains "poller maps utilization + ISO resets to epochs" "$got" \
    "$(printf '2.0\t97.0\t%s\t%s' "$want_5h" "$want_wk")"
  [ ! -f "$POLLER_ERR" ] && { PASS=$((PASS + 1)); echo "ok: successful poll clears the error file"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: poller-last-error left behind after a good poll"; }

  # throttle: a state file younger than the poll interval must not be refetched
  before=$(stat -f %m "$STATE")
  run_poller "$EP" >/dev/null
  [ "$before" = "$(stat -f %m "$STATE")" ] && { PASS=$((PASS + 1)); echo "ok: poller throttles on fresh state"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: poller refetched inside the throttle window"; }
  # ...and refetches once the state ages past it (mtime granularity is one second, so
  # age the file rather than racing two writes inside the same second)
  make_stale
  run_poller "$EP" >/dev/null
  refreshed_age=$(( $(date +%s) - $(stat -f %m "$STATE") ))
  [ "$refreshed_age" -lt 60 ] && { PASS=$((PASS + 1)); echo "ok: poller refetches once state ages past the interval"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: poller left state stale (${refreshed_age}s old) instead of refetching"; }

  # the guard must read poller-written state exactly as it reads the sensor's
  out=$(run_guard "$(stdin_json s-poller-state)")
  assert_contains "guard acts on poller-written state" "$out" "weekly limit"

  # credentials precedence: a per-profile .credentials.json must win over the keychain -
  # that is what lets two profiles poll two different accounts. Point the keychain name at
  # the REAL login item, so only genuine precedence (not a keychain miss) can produce the
  # profile's token; the fixture server records which bearer it received.
  reset_state
  printf '{"claudeAiOauth":{"accessToken":"from-credentials-file"}}' > "$TESTHOME/.claude/.credentials.json"
  env HOME="$TESTHOME" CLAUDE_USAGE_KEYCHAIN_SERVICE="Claude Code-credentials" \
    CLAUDE_USAGE_ENDPOINT="$EP" bash "$POLLER" </dev/null >/dev/null 2>&1
  assert_contains "per-profile .credentials.json is preferred over the keychain" \
    "$(cat "$SEEN_AUTH" 2>/dev/null)" "Bearer from-credentials-file"
  printf '%s' "$FAKE_CREDS" > "$TESTHOME/.claude/.credentials.json"
else
  echo "skip: poller happy-path tests (python3 unavailable for the fixture server)"
fi

# a failed fetch must leave the last good state alone and record why
good=$(cat "$STATE" 2>/dev/null)
out=$(run_poller "http://127.0.0.1:1/api/oauth/usage" CLAUDE_USAGE_POLL_INTERVAL_SEC=0)
assert_silent "poller stays silent on fetch failure" "$out"
[ "$good" = "$(cat "$STATE" 2>/dev/null)" ] && { PASS=$((PASS + 1)); echo "ok: failed poll does not clobber good state"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: failed poll clobbered good state"; }
assert_contains "failed poll records the HTTP cause" "$(cat "$POLLER_ERR" 2>/dev/null)" "usage endpoint returned HTTP"

# no credentials anywhere: must fault to the error file, never write state, and never
# silently read the real login keychain item
reset_state
rm -f "$TESTHOME/.claude/.credentials.json"
out=$(run_poller "http://127.0.0.1:1/api/oauth/usage" CLAUDE_USAGE_POLL_INTERVAL_SEC=0)
assert_silent "poller silent when no token is available" "$out"
[ ! -f "$STATE" ] && { PASS=$((PASS + 1)); echo "ok: no-token poll writes no state"; } \
  || { FAIL=$((FAIL + 1)); echo "FAIL: no-token poll wrote a state file"; }
assert_contains "no-token poll records the cause" "$(cat "$POLLER_ERR" 2>/dev/null)" "no OAuth token found"

# the guard's offline message quotes the poller's reason instead of guessing at wiring
make_stale 2>/dev/null || true
out=$(run_guard "$(stdin_json s-poller-fault)")
assert_contains "guard offline message quotes the poller error" "$out" "Last poller error: no OAuth token found"

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
assert_contains "offline message names the profile state dir" "$out" "$WORKPROF/.usage-guard"

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
      # defer window off, or the sensor would skip every write and the race never happens
      printf '%s' "$sensor_fixture" | HOME="$TESTHOME" CLAUDE_USAGE_SENSOR_DEFER_SEC=0 \
        CLAUDE_USAGE_RENDER_CMD=cat bash "$SENSOR" >/dev/null
      i=$((i + 1))
    done
  ) &
  writer=$!
  offline=0
  j=0
  while [ $j -lt 500 ]; do
    out=$(run_guard "$(stdin_json "soak-$j")")
    case "$out" in *"USAGE SOURCE OFFLINE"*) offline=$((offline + 1));; esac
    j=$((j + 1))
  done
  wait "$writer"
  [ "$offline" = "0" ] && { PASS=$((PASS + 1)); echo "ok: soak - 0 offline faults in 500 reads vs 200 writes"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: soak - $offline offline-fault emissions"; }
fi

# ------------------------------------------------------------------------------

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
