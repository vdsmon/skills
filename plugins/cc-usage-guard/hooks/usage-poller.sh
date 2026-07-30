#!/usr/bin/env bash
# PostToolUse + UserPromptSubmit hook: refresh usage state from the account usage
# endpoint, so the guard has a source that works on every surface.
#
# The statusLine sensor (usage-sensor.sh) can only run where a statusLine renders, and
# the Claude desktop app renders none (session `entrypoint: "claude-desktop"`), so a
# desktop-only machine left the guard permanently blind. This poller reads the same
# numbers the CLI's own /usage view does - GET /api/oauth/usage, authenticated with the
# OAuth token from the login keychain - and hooks fire on every surface, attended or not.
#
# Writes the same schema-2 state file the sensor writes, so usage-guard.sh reads either
# source unchanged. Prints nothing: a UserPromptSubmit hook's stdout is injected into the
# model's context, and this half has nothing to say.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:/bin:/usr/bin:$PATH"

PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.usage-guard"
state="$STATE_DIR/usage.json"
err_file="$STATE_DIR/poller-last-error"
# Throttling is keyed on the last *attempt*, not the last success. Gating on usage.json's
# mtime instead meant a failing fetch never moved the clock, so every following tool call
# refetched - a 429 turned this into a per-tool-call hammer that kept renewing the very
# rate limit it was waiting out. These two files are deliberately unkeyed: unlike the
# per-session sensor markers, an endpoint's rate limit is machine-global, same as usage.json.
attempt_file="$STATE_DIR/poller-last-attempt"
backoff_file="$STATE_DIR/poller-backoff-until"
# 60s floor: one poll per minute, well inside the guard's 15-minute staleness tolerance
# (CLAUDE_USAGE_SENSOR_MAX_AGE_MIN). The endpoint's own quota is undocumented and its 429
# carries no ratelimit headers, so the backoff below - not this floor - is what keeps a
# throttled endpoint from being hammered. Raise via CLAUDE_USAGE_POLL_INTERVAL_SEC if the
# backoff starts tripping often.
POLL_MIN_AGE_SEC="${CLAUDE_USAGE_POLL_INTERVAL_SEC:-60}"
BACKOFF_FAIL_SEC="${CLAUDE_USAGE_BACKOFF_FAIL_SEC:-60}"      # generic fetch failure
BACKOFF_429_SEC="${CLAUDE_USAGE_BACKOFF_429_SEC:-300}"       # 429 with no usable retry-after
BACKOFF_MAX_SEC="${CLAUDE_USAGE_BACKOFF_MAX_SEC:-3600}"      # cap: never blind the guard for longer
FETCH_TIMEOUT_SEC="${CLAUDE_USAGE_POLL_TIMEOUT_SEC:-3}"
KEYCHAIN_SERVICE="${CLAUDE_USAGE_KEYCHAIN_SERVICE:-Claude Code-credentials}"
USAGE_URL="${CLAUDE_USAGE_ENDPOINT:-https://api.anthropic.com/api/oauth/usage}"

cat >/dev/null 2>&1  # drain the hook payload; nothing in it is needed

fail() { mkdir -p "$STATE_DIR" 2>/dev/null; printf '%s\n' "$1" > "$err_file" 2>/dev/null; exit 0; }

# every state write goes tmp-then-rename: this hook runs on PostToolUse *and*
# UserPromptSubmit, and the guard invokes it too, so concurrent writers are the norm here
write_atomic() { # <path> <contents>; empty contents just stamps mtime
  _t="$1.tmp.$$"
  if [ -n "$2" ]; then printf '%s\n' "$2" > "$_t" 2>/dev/null; else : > "$_t" 2>/dev/null; fi
  mv -f "$_t" "$1" 2>/dev/null || rm -f "$_t" 2>/dev/null
}

command -v jq >/dev/null 2>&1 || exit 0   # guard's own jq gate reports this one
command -v curl >/dev/null 2>&1 || fail "curl is not on PATH"
mkdir -p "$STATE_DIR" 2>/dev/null

now=$(date +%s)

# Backoff gate, deliberately ahead of the interval gate and never reading POLL_MIN_AGE_SEC:
# usage-guard.sh self-heals by calling this script with CLAUDE_USAGE_POLL_INTERVAL_SEC=0,
# and that bypass must not be able to override a limit the server itself asked us to respect.
if [ -f "$backoff_file" ]; then
  until_ts=$(head -c 32 "$backoff_file" 2>/dev/null | tr -dc '0-9')
  [ -n "$until_ts" ] && [ "$now" -lt "$until_ts" ] && exit 0
fi

if [ -f "$attempt_file" ]; then
  age=$(( now - $(stat -f %m "$attempt_file" 2>/dev/null || echo 0) ))
  [ "$age" -lt "$POLL_MIN_AGE_SEC" ] && exit 0
fi

# credentials: a per-profile .credentials.json wins when present (multi-profile installs
# and Linux keep the token there), otherwise the login keychain item. The token is read
# into a variable, sent only to the usage endpoint, and never written to disk or stdout.
creds=""
[ -f "$PROFILE_DIR/.credentials.json" ] && creds=$(cat "$PROFILE_DIR/.credentials.json" 2>/dev/null)
[ -n "$creds" ] || creds=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)
token=$(printf '%s' "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
creds=""
[ -n "$token" ] || fail "no OAuth token found (keychain item '$KEYCHAIN_SERVICE' and $PROFILE_DIR/.credentials.json both unusable) - subscription login required, API-key sessions have no plan limits to read"

# back off on EVERY failed fetch, not just 429: a timeout or a 5xx left unthrottled would
# be hammered by the guard's INTERVAL=0 self-heal exactly like the 429 was
set_backoff() { # <seconds>
  _s=$1
  [ "$_s" -gt "$BACKOFF_MAX_SEC" ] 2>/dev/null && _s=$BACKOFF_MAX_SEC
  write_atomic "$backoff_file" "$(( now + _s ))"
}

# stamp the attempt BEFORE the fetch - a failure that never reaches the success path must
# still move the throttle clock forward
write_atomic "$attempt_file" ""

http_code=""
hdr_file="$STATE_DIR/poller-headers.tmp.$$"
resp=$(curl -sS --max-time "$FETCH_TIMEOUT_SEC" -w '\n%{http_code}' -D "$hdr_file" "$USAGE_URL" \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "Content-Type: application/json" 2>/dev/null)
token=""
http_code=${resp##*$'\n'}
resp=${resp%$'\n'*}
# last match wins: through a proxy the CONNECT response prepends its own header block
retry_raw=$(awk 'tolower($1) == "retry-after:" { $1 = ""; v = $0 } END { print v }' "$hdr_file" 2>/dev/null | tr -d '\r' | tr -s ' ' | sed 's/^ //;s/ $//')
rm -f "$hdr_file" 2>/dev/null

# Retry-After is delta-seconds or an HTTP-date (RFC 9110). The live endpoint sends the
# former, but a header we were handed is better than a guess, so parse both shapes.
retry_seconds() { # <raw value> -> seconds on stdout, empty when unusable
  case "$1" in
    '') return ;;
    *[!0-9]*) ;;
    *) printf '%s' "$1"; return ;;
  esac
  # TZ=UTC is load-bearing: BSD date -j -f reads the timestamp as LOCAL time whatever the
  # format string says, so without it the deadline lands one UTC offset away
  _at=$(TZ=UTC date -j -f '%a, %d %b %Y %H:%M:%S GMT' "$1" +%s 2>/dev/null) ||
    _at=$(date -d "$1" +%s 2>/dev/null) || return
  _d=$(( _at - now ))
  [ "$_d" -gt 0 ] && printf '%s' "$_d"
}
retry_after=$(retry_seconds "$retry_raw")

if [ "$http_code" != "200" ]; then
  if [ "$http_code" = "429" ]; then
    # honour retry-after when it is a plain delta-seconds; the HTTP-date form and a missing
    # header both fall back, because a 429 that sets no backoff resurrects the hammer loop
    wait_sec=${retry_after:-$BACKOFF_429_SEC}
    set_backoff "$wait_sec"
    resume=$(date -r "$(( now + wait_sec ))" +%H:%M 2>/dev/null)
    fail "usage endpoint rate-limited (HTTP 429) - polling is paused until ~${resume:-later} local, as the endpoint asked. Nothing to fix; the guard is blind until then."
  fi
  set_backoff "$BACKOFF_FAIL_SEC"
  fail "usage endpoint returned HTTP ${http_code:-none} (401 means the stored token expired - run any Claude Code session to refresh it)"
fi

# same shape the sensor writes (schema 2), so the guard reads either source unchanged:
# utilization percentages plus epoch resets. resets_at arrives as ISO with fractional
# seconds and a +00:00 offset, which fromdateiso8601 rejects - take the first 19 chars
# and stamp Z, and only when the string really is UTC.
usage=$(printf '%s' "$resp" | jq -c '
  def epoch: if type != "string" then null
             elif test("(\\+00:00|Z)$") then (.[0:19] + "Z" | fromdateiso8601)
             else null end;
  {
    schema:          2,
    five_hour:       (.five_hour.utilization // null),
    weekly:          (.seven_day.utilization // null),
    five_hour_reset: (.five_hour.resets_at | epoch),
    weekly_reset:    (.seven_day.resets_at | epoch)
  } | select((.five_hour != null) or (.weekly != null))' 2>/dev/null)
[ -n "$usage" ] || fail "usage endpoint response had no five_hour/seven_day utilization"

# atomic, non-clobbering write (same discipline as the sensor): a torn read must be
# impossible, and a failed write must leave the last good state alone so the guard's
# staleness gate faults loud instead of reading nulls. $$ keeps concurrent hooks distinct.
tmp="$STATE_DIR/usage.json.tmp.$$"
if { printf '%s\n' "$usage" > "$tmp" && mv -f "$tmp" "$state"; } 2>/dev/null; then
  rm -f "$err_file" "$backoff_file" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
  fail "could not write $state"
fi
exit 0
