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

# The guard now self-heals by invoking the poller when it finds no usable state. Every
# guard case therefore has to neutralize the poller, or it would fetch with the real login
# keychain against the real account: force a keychain miss and an unreachable endpoint, so
# the poll fails instantly and offline behaviour stays observable. The self-heal path gets
# its own test with a working fixture endpoint.
NO_KEYCHAIN="cc-usage-guard-test-no-such-service"
DEAD_ENDPOINT="http://127.0.0.1:1/api/oauth/usage"

# run_guard <stdin-json> -> stdout
run_guard() {
  printf '%s' "$1" | env HOME="$TESTHOME" CLAUDE_USAGE_KEYCHAIN_SERVICE="$NO_KEYCHAIN" \
    CLAUDE_USAGE_ENDPOINT="$DEAD_ENDPOINT" CLAUDE_USAGE_POLL_TIMEOUT_SEC=1 bash "$GUARD"
}

stdin_json() { # <session_id> [agent_id] [hook_event]
  printf '{"hook_event_name":"%s","session_id":"%s","agent_id":"%s"}' \
    "${3:-PostToolUse}" "$1" "${2:-}"
}

fresh_state() { # <five_hour_pct>
  printf '{"schema":2,"five_hour":%s,"weekly":10,"five_hour_reset":%s,"weekly_reset":%s}\n' \
    "$1" "$(date -v+2H +%s)" "$(date -v+2d +%s)" > "$STATE"
}

# "stale" has to age the attempt stamp too: the poller throttles on when it last *tried*,
# so an old state file with a fresh attempt stamp is deliberately not a refetch trigger
make_stale() { touch -t 202601010000 "$STATE" "$STATE_DIR/poller-last-attempt" 2>/dev/null; }

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
  HITS="$TESTHOME/fixture-hits"
  : > "$HITS"
  python3 - "$FIXTURE" "$PORT_FILE" "$SEEN_AUTH" "$HITS" >/dev/null 2>&1 <<'PY' &
import http.server, socketserver, sys
body = open(sys.argv[1], 'rb').read()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # every request is counted, so a throttle test can assert "did not reach the
        # endpoint" directly instead of inferring it from an unchanged mtime
        with open(sys.argv[4], 'a') as f:
            f.write(self.path + '\n')
        # record the bearer token so a test can prove which credential source was used
        open(sys.argv[3], 'w').write(self.headers.get('Authorization', ''))
        # /429 and /429-bare stand in for a rate-limited endpoint, with and without the
        # Retry-After header the real one sends
        if self.path.startswith('/429'):
            self.send_response(429)
            if self.path == '/429':
                self.send_header('Retry-After', '3379')
            elif self.path == '/429-date':
                # the HTTP-date form RFC 9110 also allows, 120s out
                import email.utils, time
                self.send_header('Retry-After',
                                 email.utils.formatdate(time.time() + 120, usegmt=True))
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
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

  # --- rate-limit backoff -------------------------------------------------------
  # Regression: the throttle used to key on usage.json's mtime, which a failed fetch never
  # moves. One 429 therefore made every following tool call refetch, endlessly renewing the
  # limit it was waiting out. These cases pin both halves of the fix.
  BACKOFF="$STATE_DIR/poller-backoff-until"
  EP429="http://127.0.0.1:$PORT/429"

  reset_state
  run_poller "$EP429" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 >/dev/null
  assert_contains "a 429 is reported as a backoff, not a bare HTTP error" \
    "$(cat "$POLLER_ERR" 2>/dev/null)" "rate-limited"
  slack=$(( $(cat "$BACKOFF" 2>/dev/null || echo 0) - $(date +%s) ))
  [ "$slack" -gt 3300 ] && [ "$slack" -le 3379 ] \
    && { PASS=$((PASS + 1)); echo "ok: backoff deadline honours the Retry-After header"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: backoff deadline is ${slack}s out, expected ~3379"; }

  # the guard self-heals with CLAUDE_USAGE_POLL_INTERVAL_SEC=0, so the interval bypass must
  # NOT reach past a limit the server itself set - this is the case that made it a hammer
  hits_before=$(wc -l < "$HITS")
  run_poller "$EP429" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 >/dev/null
  [ "$hits_before" = "$(wc -l < "$HITS")" ] \
    && { PASS=$((PASS + 1)); echo "ok: backoff cannot be bypassed by INTERVAL=0"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: INTERVAL=0 re-hit a rate-limited endpoint"; }

  # Retry-After's other legal shape: an HTTP-date, which must become a delta not a fallback
  reset_state
  run_poller "http://127.0.0.1:$PORT/429-date" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 >/dev/null
  slack=$(( $(cat "$BACKOFF" 2>/dev/null || echo 0) - $(date +%s) ))
  [ "$slack" -gt 60 ] && [ "$slack" -le 120 ] \
    && { PASS=$((PASS + 1)); echo "ok: Retry-After as an HTTP-date is honoured too"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: HTTP-date Retry-After gave ${slack}s, expected ~120"; }

  # a 429 that carries no Retry-After must still park polling, or the loop comes back
  reset_state
  run_poller "http://127.0.0.1:$PORT/429-bare" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 >/dev/null
  [ -s "$BACKOFF" ] && { PASS=$((PASS + 1)); echo "ok: 429 without Retry-After still backs off"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: 429 without Retry-After left no backoff"; }

  # every failed fetch moves the attempt clock - not just the ones that back off
  reset_state
  run_poller "$DEAD_ENDPOINT" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 CLAUDE_USAGE_POLL_TIMEOUT_SEC=1 >/dev/null
  rm -f "$BACKOFF"   # isolate the attempt gate from the backoff gate
  hits_before=$(wc -l < "$HITS")
  run_poller "$EP" >/dev/null
  [ "$hits_before" = "$(wc -l < "$HITS")" ] \
    && { PASS=$((PASS + 1)); echo "ok: a failed fetch still moves the throttle clock"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: failed fetch left the clock unmoved - refetched immediately"; }

  # an elapsed deadline must not block, and a good poll must clear it
  reset_state
  printf '1\n' > "$BACKOFF"
  run_poller "$EP" CLAUDE_USAGE_POLL_INTERVAL_SEC=0 >/dev/null
  [ ! -f "$BACKOFF" ] && { PASS=$((PASS + 1)); echo "ok: expired backoff clears on the next good poll"; } \
    || { FAIL=$((FAIL + 1)); echo "FAIL: backoff survived a successful poll"; }

  # the guard must read poller-written state exactly as it reads the sensor's
  out=$(run_guard "$(stdin_json s-poller-state)")
  assert_contains "guard acts on poller-written state" "$out" "weekly limit"

  # self-heal: hooks on one event are unordered, so on a session's first turn the guard can
  # read state the poller is about to replace. It must fetch once itself before declaring
  # the source offline - otherwise that race emits a one-time-per-session false alarm.
  reset_state
  fresh_state 50
  make_stale
  out=$(printf '%s' "$(stdin_json s-selfheal)" | env HOME="$TESTHOME" \
    CLAUDE_USAGE_KEYCHAIN_SERVICE="$NO_KEYCHAIN" CLAUDE_USAGE_ENDPOINT="$EP" bash "$GUARD")
  case "$out" in
    *"USAGE SOURCE OFFLINE"*) FAIL=$((FAIL + 1)); echo "FAIL: guard cried offline instead of polling for itself";;
    *) PASS=$((PASS + 1)); echo "ok: guard self-heals stale state by polling before faulting";;
  esac
  assert_contains "self-healed guard acts on the freshly polled numbers" "$out" "weekly limit"

  # ...and still faults when the poll itself cannot produce state
  reset_state
  fresh_state 50
  make_stale
  out=$(run_guard "$(stdin_json s-selfheal-dead)")
  assert_contains "guard still faults when the self-heal poll fails" "$out" "USAGE SOURCE OFFLINE"

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
# credentials are the one fault the README cannot fix, so that case gets its own remedy.
# Assert on the *action*, not the explanation: the remedy is worthless to a user who never
# learns which command to run, and a reworded cause must not be able to drop it silently.
assert_contains "no-credentials fault gets its own remedy, not 'see the README'" "$out" \
  "ONE COMMAND THE USER RUNS THEMSELVES"
assert_contains "no-credentials remedy names the command to run" "$out" '`claude /login`'
assert_contains "no-credentials remedy forbids running it from a tool call" "$out" \
  "must not run it from a tool call"
assert_contains "no-credentials remedy tells the model to surface the command" "$out" \
  "shell code block"
case "$out" in
  *"Fix per the plugin README"*) FAIL=$((FAIL + 1)); echo "FAIL: no-credentials fault still points at the README";;
  *) PASS=$((PASS + 1)); echo "ok: no-credentials fault drops the generic README pointer";;
esac

# every other fault keeps the generic remedy - the branch above must not swallow them.
# Credentials have to be back in place or the guard's self-heal poll fails on the token
# first and overwrites the fault under test with the credentials one.
reset_state
printf '%s' "$FAKE_CREDS" > "$TESTHOME/.claude/.credentials.json"
fresh_state 50
make_stale
out=$(run_guard "$(stdin_json s-other-fault)")
assert_contains "other faults still point at the README" "$out" "Fix per the plugin README"
assert_contains "other faults quote the endpoint cause" "$out" "usage endpoint returned HTTP"

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
