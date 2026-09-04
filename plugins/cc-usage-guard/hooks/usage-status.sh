#!/usr/bin/env bash
# usage-status.sh [--clear-markers]: the guard's view of the account, on one screen.
#
# Prints exactly what usage-guard.sh acts on - the state file with its age, the
# window percentages and their resets in local time, the thresholds in effect, the
# poller's last error and backoff, and this profile's session markers - so nobody
# reads the state directory by hand to answer "is the guard right?" or "did it notice
# the plan change?". (It did: a plan change or a window reset shows up on the next
# poll, within a minute; the markers only throttle repeat reminders.)
#
# --clear-markers removes the park and warn markers. That is always safe: the next
# threshold crossing then fires in full again instead of as a throttled repeat.
# Everything else is read-only. macOS/BSD date/stat, like the hooks.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:/bin:/usr/bin:$PATH"

PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.usage-guard"
state="$STATE_DIR/usage.json"
now=$(date +%s)

local_time() { # <epoch> -> "YYYY-MM-DD HH:MM" local, or "-"
  case "${1%%.*}" in ''|*[!0-9]*|0) printf '%s' "-"; return ;; esac
  date -r "${1%%.*}" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@${1%%.*}" '+%Y-%m-%d %H:%M' 2>/dev/null || printf '%s' "-"
}

age_min() { # <path> -> minutes since mtime
  local m
  m=$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo "$now")
  printf '%s' $(( (now - m) / 60 ))
}

echo "cc-usage-guard state dir: $STATE_DIR"

if [ "${1:-}" = "--clear-markers" ]; then
  count=$(find "$STATE_DIR" -maxdepth 1 -type f \
    \( -name 'usage-park-marker*' -o -name 'sensor-warn-marker*' \) 2>/dev/null | wc -l | tr -d ' ')
  find "$STATE_DIR" -maxdepth 1 -type f \
    \( -name 'usage-park-marker*' -o -name 'sensor-warn-marker*' \) -delete 2>/dev/null
  echo "cleared ${count:-0} marker(s); the next crossing fires in full"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is not on PATH: the guard is blind (brew install jq)"
  exit 0
fi

if [ ! -f "$state" ]; then
  echo "usage.json: missing (no source has written yet; the poller writes on the next hook call)"
else
  max_age="${CLAUDE_USAGE_SENSOR_MAX_AGE_MIN:-15}"
  echo "usage.json: written $(age_min "$state") min ago (stale for the guard after ${max_age} min)"
  schema=$(jq -r '.schema // "none"' "$state" 2>/dev/null)
  [ "$schema" = "2" ] || echo "  schema: $schema (the guard expects 2; a mismatch means mixed plugin versions)"
  # one decimal: the endpoint reports floats such as 7.000000000000001
  five=$(jq -r '(.five_hour // "-") | if type == "number" then (. * 10 | round / 10) else . end' "$state" 2>/dev/null)
  weekly=$(jq -r '(.weekly // "-") | if type == "number" then (. * 10 | round / 10) else . end' "$state" 2>/dev/null)
  five_reset=$(jq -r '.five_hour_reset // 0' "$state" 2>/dev/null)
  weekly_reset=$(jq -r '.weekly_reset // 0' "$state" 2>/dev/null)
  five_note=""; weekly_note=""
  [ "${five_reset%%.*}" -gt 0 ] 2>/dev/null && [ "${five_reset%%.*}" -lt "$now" ] && five_note=" (reset is past: the guard ignores this window)"
  [ "${weekly_reset%%.*}" -gt 0 ] 2>/dev/null && [ "${weekly_reset%%.*}" -lt "$now" ] && weekly_note=" (reset is past: the guard ignores this window)"
  echo "  5-hour: ${five}% used, resets $(local_time "$five_reset")${five_note}"
  echo "  weekly: ${weekly}% used, resets $(local_time "$weekly_reset")${weekly_note}"
fi

echo "thresholds: 5-hour warn ${CLAUDE_USAGE_WARN_5H:-90}% / park ${CLAUDE_USAGE_THRESHOLD_5H:-${CLAUDE_USAGE_THRESHOLD:-97}}%, weekly warn ${CLAUDE_USAGE_WARN_WEEKLY:-96}% / park ${CLAUDE_USAGE_THRESHOLD_WEEKLY:-99}%"

if [ -f "$STATE_DIR/poller-last-attempt" ]; then
  echo "poller: last attempt $(age_min "$STATE_DIR/poller-last-attempt") min ago"
else
  echo "poller: never ran in this profile"
fi
if [ -f "$STATE_DIR/poller-last-error" ]; then
  echo "  last error: $(head -c 300 "$STATE_DIR/poller-last-error" 2>/dev/null)"
fi
if [ -f "$STATE_DIR/poller-backoff-until" ]; then
  until=$(head -n1 "$STATE_DIR/poller-backoff-until" 2>/dev/null | tr -d '[:space:]')
  echo "  backoff until: $(local_time "$until")"
fi

markers=$(find "$STATE_DIR" -maxdepth 1 -type f \
  \( -name 'usage-park-marker*' -o -name 'sensor-warn-marker*' \) 2>/dev/null | sort)
if [ -z "$markers" ]; then
  echo "markers: none (no session is parked or warned in this profile)"
else
  echo "markers (window:level:reset, level 2 = parked, 1 = warned; they throttle repeats only):"
  while IFS= read -r marker; do
    [ -n "$marker" ] || continue
    name=${marker##*/}
    echo "  ${name#usage-} = $(head -c 120 "$marker" 2>/dev/null | tr -d '\n') ($(age_min "$marker") min old)"
  done <<< "$markers"
fi
exit 0
