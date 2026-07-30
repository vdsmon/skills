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
# throttle: the guard tolerates state up to CLAUDE_USAGE_SENSOR_MAX_AGE_MIN (15) minutes
# old, so a 60s floor keeps a wide margin while sparing all but a few tool calls the fetch
POLL_MIN_AGE_SEC="${CLAUDE_USAGE_POLL_INTERVAL_SEC:-60}"
FETCH_TIMEOUT_SEC="${CLAUDE_USAGE_POLL_TIMEOUT_SEC:-3}"
KEYCHAIN_SERVICE="${CLAUDE_USAGE_KEYCHAIN_SERVICE:-Claude Code-credentials}"
USAGE_URL="${CLAUDE_USAGE_ENDPOINT:-https://api.anthropic.com/api/oauth/usage}"

cat >/dev/null 2>&1  # drain the hook payload; nothing in it is needed

fail() { mkdir -p "$STATE_DIR" 2>/dev/null; printf '%s\n' "$1" > "$err_file" 2>/dev/null; exit 0; }

command -v jq >/dev/null 2>&1 || exit 0   # guard's own jq gate reports this one
command -v curl >/dev/null 2>&1 || fail "curl is not on PATH"
mkdir -p "$STATE_DIR" 2>/dev/null

if [ -f "$state" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$state" 2>/dev/null || echo 0) ))
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

http_code=""
resp=$(curl -sS --max-time "$FETCH_TIMEOUT_SEC" -w '\n%{http_code}' "$USAGE_URL" \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "Content-Type: application/json" 2>/dev/null)
token=""
http_code=${resp##*$'\n'}
resp=${resp%$'\n'*}
[ "$http_code" = "200" ] || fail "usage endpoint returned HTTP ${http_code:-none} (401 means the stored token expired - run any Claude Code session to refresh it)"

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
  rm -f "$err_file" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
  fail "could not write $state"
fi
exit 0
