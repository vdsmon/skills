#!/usr/bin/env bash
# UserPromptSubmit hook: cancels a keepalive cron tick that a recent real turn
# already paid for.
#
# The cron fires on a fixed schedule and cannot be rescheduled on activity -
# jobs live in-memory in the CLI process, and next-fire is a pure function of
# the cron expression plus a per-job jitter. So instead of moving the tick, we
# drop it: `decision: block` makes the prompt pipeline return shouldQuery=false,
# so no API request is sent and the tick costs nothing. The notice the user sees
# is a type:"system" record the API-request builder filters out - zero tokens,
# zero context.
#
# NEVER emit {"continue": false} here. That is a different branch: it pushes a
# real user message into the conversation, which then costs context on every
# later request - the opposite of the point.
#
# Fail open on every unknown. A wasted ping costs one cache read; a cache that
# went cold costs a full uncached re-read, roughly ten times more.
#
# Strict by design, unlike hooks/keepalive-sensor.sh: a false positive here
# blocks a real user prompt, so the sentinel match must be exact.
set -u

FLAG="${HOME}/.cc-cache-keepalive"
[ -f "$FLAG" ] || exit 0
[ -n "${CC_KEEPALIVE_OFF:-}" ] && exit 0

# Order matters: the two checks above are one stat(2) for anyone who has not
# opted in. Everything below runs only for a keepalive tick.
input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"

# Whole-prompt sentinel match, safe by construction rather than by heuristic.
# The payload is JSON, so a prompt that merely *mentions* the sentinel arrives
# with its quotes escaped - \"prompt\":\"cc-cache-keepalive\" - which puts a
# backslash where this pattern needs a quote, and cannot match. The trailing
# quote makes it whole-prompt, since a JSON string ends at the first unescaped
# quote. Someone asking a question about this plugin must never be blocked.
printf '%s' "$input" \
  | grep -qE '"prompt"[[:space:]]*:[[:space:]]*"cc-cache-keepalive"' || exit 0

# Both the prompt cache and the stamp are per-session, so the stamp is keyed by
# session. An absent id fails open rather than falling back to a shared file:
# one shared stamp would let a busy session suppress an idle session's ping and
# take that session cold - the exact failure this plugin exists to prevent.
session_id="$(printf '%s' "$input" \
  | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{8,}"' \
  | head -n1 | grep -oE '[0-9a-fA-F-]{8,}' | tail -n1)"
[ -n "$session_id" ] || exit 0

# Interval, same contract as keepalive.sh line 1 of the flag file (that file is
# the source of truth; tests/test-cache-keepalive.sh pins the two parsers to one
# input table). Collapsed to whole minutes, which is what the window math needs.
DEFAULT_INTERVAL="30m"
INTERVAL="$(head -n1 "$FLAG" 2>/dev/null | tr -d '[:space:]')"
if [[ ! "$INTERVAL" =~ ^[0-9]+[smhd]$ ]] || [ "$((10#${INTERVAL%[smhd]}))" -eq 0 ]; then
  INTERVAL="$DEFAULT_INTERVAL"
fi
N=$((10#${INTERVAL%[smhd]}))
case "${INTERVAL: -1}" in
  s) IMIN=$(( (N + 59) / 60 )) ;;
  m) IMIN=$N ;;
  h) IMIN=$((N * 60)) ;;
  d) IMIN=$((N * 1440)) ;;
  *) IMIN=30 ;;
esac
[ "$IMIN" -lt 1 ] && IMIN=1

# TTL measured, not assumed: eight sessions idled for a controlled interval then
# took exactly one turn. Hits up to 57.9 min (cache_read 42585 / create 15),
# total misses from 60.8 min on (cache_read 0). So the cliff is 60 min, and it
# is a cliff, not a slope. Safety is the margin for what the arithmetic cannot
# see - a machine that slept, or a tick queued behind a long turn. It does NOT
# need to cover cron jitter: that is a constant phase offset per job, so it
# shifts every tick equally and never widens the gap between them.
TTL_MIN="${CC_KEEPALIVE_TTL_MIN:-60}"
SAFETY_MIN="${CC_KEEPALIVE_SAFETY_MIN:-10}"
case "$TTL_MIN" in ''|*[!0-9]*) TTL_MIN=60 ;; esac
case "$SAFETY_MIN" in ''|*[!0-9]*) SAFETY_MIN=15 ;; esac

# Cancel window, in precedence order: env, then flag-file line 2, then derived.
# The flag file matters because a cron waking a stopped session spawns a fresh
# process that never saw your shell exports.
WINDOW=""
case "${CC_KEEPALIVE_WINDOW_MIN:-}" in
  ''|*[!0-9]*) : ;;
  *) WINDOW=$((10#${CC_KEEPALIVE_WINDOW_MIN})) ;;
esac
if [ -z "$WINDOW" ]; then
  LINE2="$(sed -n 2p "$FLAG" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$LINE2" =~ ^[0-9]+[smhd]$ ]]; then
    W=$((10#${LINE2%[smhd]}))
    case "${LINE2: -1}" in
      s) WINDOW=$(( (W + 59) / 60 )) ;;
      m) WINDOW=$W ;;
      h) WINDOW=$((W * 60)) ;;
      d) WINDOW=$((W * 1440)) ;;
    esac
  elif [[ "$LINE2" =~ ^[0-9]+$ ]]; then
    WINDOW=$((10#$LINE2))
  fi
fi
if [ -z "$WINDOW" ]; then
  # window = min(interval, TTL - interval - safety). The min is what bounds the
  # worst case: a real turn landing just after a tick is invisible to that tick,
  # so the cache can go untouched for window + interval. Substituting the min,
  # that is exactly TTL - safety for every interval (50m at the defaults,
  # against a measured 60m cliff).
  WINDOW=$((TTL_MIN - IMIN - SAFETY_MIN))
  [ "$WINDOW" -gt "$IMIN" ] && WINDOW=$IMIN
  [ "$WINDOW" -lt 0 ] && WINDOW=0
fi
# Zero window means never skip - the 1.3.0 behaviour. Intervals above
# TTL - safety land here on their own: there is no room left to skip safely.
[ "$WINDOW" -le 0 ] && exit 0

PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.cc-cache-keepalive"
STAMP="$STATE_DIR/last-real-turn-$session_id"

# GC inside the sentinel branch only - at most twice an hour per session, and it
# keeps the every-prompt hot path free of find(1). (cc-usage-guard sweeps on
# every UserPromptSubmit; it has no equally cheap branch to hide the sweep in.)
[ -d "$STATE_DIR" ] && find "$STATE_DIR" -maxdepth 1 -type f \
  \( \( -name 'last-real-turn-*' -mtime +7 \) -o \( -name '.tmp.*' -mmin +60 \) \) \
  -delete 2>/dev/null

[ -r "$STAMP" ] || exit 0
STAMPED="$(head -n1 "$STAMP" 2>/dev/null | tr -d '[:space:]')"
case "$STAMPED" in ''|*[!0-9]*) exit 0 ;; esac
AGE=$(( $(date +%s) - 10#$STAMPED ))
# A stamp in the future (clock skew, a bad write) would otherwise block every
# tick forever, silently, until the file aged out.
[ "$AGE" -lt 0 ] && exit 0
# Strict <, so age == window fires. That is what keeps the worst-case bound
# above true at the boundary.
[ "$AGE" -lt $((WINDOW * 60)) ] || exit 0

# Keep the reason to one short line. Claude Code prefixes every block with a
# fixed "UserPromptSubmit operation blocked by hook:" and there is no way to
# suppress that (confirmed in the binary - the notice is pushed unconditionally
# - and in the docs; suppressOutput only hides the hook's stdout. Upstream
# feature request: anthropics/claude-code#39499). Since the prefix already costs
# two wrapped lines several times an hour, the part we control stays minimal.
# No additionalContext either - injecting text into the turn defeats the point.
# Static string, so no interpolation and no JSON escaping: the plugin stays
# jq-free. The window is deliberately NOT quoted here; the tests assert the
# block/pass boundary itself, which pins the arithmetic without coupling to
# wording.
printf '{"decision":"block","reason":"cc-cache-keepalive: already warm","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","suppressOriginalPrompt":true}}\n'
exit 0
