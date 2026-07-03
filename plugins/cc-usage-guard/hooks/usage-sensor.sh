#!/usr/bin/env bash
# statusLine wrapper: dump rate-limit % + reset to a state file, then render the status line.
# rate_limits is only present in statusLine stdin (Pro/Max), so this is the only place to read it.
# Pairs with usage-guard.sh, which reads the same STATE_DIR. statusLine commands get no
# ${CLAUDE_PLUGIN_ROOT}, so both halves derive the path from the profile dir
# (CLAUDE_CONFIG_DIR, inherited from the CLI process); multi-account machines get one
# state dir per profile instead of clobbering a shared one.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:$PATH"

STATE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.usage-guard"
RENDER_CMD="${CLAUDE_USAGE_RENDER_CMD:-ccstatusline}"

input=$(cat)
mkdir -p "$STATE_DIR"

# schema stamps the state-file shape; the guard refuses any other value, so a sensor and
# guard from different plugin versions fail loud instead of the guard silently reading
# nulls off renamed keys (the 0.4.0 five/seven -> five_hour/weekly rename did exactly that).
#
# atomic state write: capture jq output first (empty when jq is missing or fails - keep
# the last good state instead of truncating it), then write a same-dir tmp and rename(2)
# into place so a guard read can never observe a partial or empty file. a plain
# `jq > usage.json` truncates at process start and fills at exit, and the guard fires on
# every PostToolUse in every session, so torn reads were a matter of when, not if. $$
# keeps concurrent attended sessions' tmps distinct; last writer wins, which is correct
# (every sensor reports the same account-level data).
usage=$(printf '%s' "$input" | jq -c '{
  schema:          2,
  five_hour:       (.rate_limits.five_hour.used_percentage // null),
  weekly:          (.rate_limits.seven_day.used_percentage // null),
  five_hour_reset: (.rate_limits.five_hour.resets_at // null),
  weekly_reset:    (.rate_limits.seven_day.resets_at // null)
}' 2>/dev/null)
if [ -n "$usage" ]; then
  tmp="$STATE_DIR/usage.json.tmp.$$"
  { printf '%s\n' "$usage" > "$tmp" && mv -f "$tmp" "$STATE_DIR/usage.json"; } 2>/dev/null \
    || rm -f "$tmp" 2>/dev/null
fi

# render via the configured status-line tool; if absent, degrade to a minimal built-in
# line from the values we just parsed instead of dumping raw JSON. the final printf only
# fires when jq is missing too - surface that on the status line instead of going blank.
if command -v "$RENDER_CMD" >/dev/null 2>&1; then
  printf '%s' "$input" | "$RENDER_CMD"
else
  printf '%s' "$input" | jq -r '
    "5h \((.rate_limits.five_hour.used_percentage // 0) | floor)% | wk \((.rate_limits.seven_day.used_percentage // 0) | floor)%"
  ' 2>/dev/null || printf 'cc-usage-guard: jq not on PATH - usage sensor blind'
fi
