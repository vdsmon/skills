#!/usr/bin/env bash
# statusLine wrapper: dump rate-limit % + reset to a state file, then render the status line.
# rate_limits is only present in statusLine stdin (Pro/Max), so this is the only place to read it.
# Pairs with usage-guard.sh, which reads the same STATE_DIR. statusLine commands get no
# ${CLAUDE_PLUGIN_ROOT}, so state lives at a fixed $HOME path both halves agree on.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:$PATH"

STATE_DIR="$HOME/.claude/.usage-guard"
RENDER_CMD="${CLAUDE_USAGE_RENDER_CMD:-ccstatusline}"

input=$(cat)
mkdir -p "$STATE_DIR"

# schema stamps the state-file shape; the guard refuses any other value, so a sensor and
# guard from different plugin versions fail loud instead of the guard silently reading
# nulls off renamed keys (the 0.4.0 five/seven -> five_hour/weekly rename did exactly that).
printf '%s' "$input" | jq -c '{
  schema:          2,
  five_hour:       (.rate_limits.five_hour.used_percentage // null),
  weekly:          (.rate_limits.seven_day.used_percentage // null),
  five_hour_reset: (.rate_limits.five_hour.resets_at // null),
  weekly_reset:    (.rate_limits.seven_day.resets_at // null)
}' > "$STATE_DIR/usage.json" 2>/dev/null

# render via the configured status-line tool; if absent, degrade to a minimal built-in
# line from the values we just parsed instead of dumping raw JSON.
if command -v "$RENDER_CMD" >/dev/null 2>&1; then
  printf '%s' "$input" | "$RENDER_CMD"
else
  printf '%s' "$input" | jq -r '
    "5h \((.rate_limits.five_hour.used_percentage // 0) | floor)% | wk \((.rate_limits.seven_day.used_percentage // 0) | floor)%"
  ' 2>/dev/null
fi
