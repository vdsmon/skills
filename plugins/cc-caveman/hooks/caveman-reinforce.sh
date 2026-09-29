#!/usr/bin/env bash
# UserPromptSubmit hook: one-line per-turn reminder that caveman is active.
#
# SessionStart injects the full ruleset once, but it drifts out of the model's
# attention as context grows and other plugins inject per-turn instructions.
# This line re-anchors the mode every prompt for ~15 tokens.
#
# No flag file: installing the plugin IS the opt-in. CC_CAVEMAN_OFF env var
# is the escape hatch for a session without the style.
#
# Always exit 0 on every path: a UserPromptSubmit hook exiting non-zero errors
# on every prompt. Fail open = fail silent - a skipped reminder costs at most
# one turn of style drift, a blocked prompt costs the user a real turn.
set -u

[ -n "${CC_CAVEMAN_OFF:-}" ] && exit 0

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"

# Skip unattended turns: cache-keepalive ticks must stay byte-minimal and
# scheduled-task prompts must not be style-hijacked. Loose match is the right
# direction here - a false positive skips one reminder on a real prompt,
# nothing more.
if printf '%s' "$input" | grep -qE 'cc-cache-keepalive|<scheduled-task'; then
  exit 0
fi

echo "CAVEMAN MODE ACTIVE (full) — session ruleset applies."
exit 0
