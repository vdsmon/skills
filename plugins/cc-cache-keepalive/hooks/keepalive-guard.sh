#!/usr/bin/env bash
# UserPromptSubmit hook: cancels a keepalive cron tick that a recent real turn
# already paid for, or that would land on a cache that is already gone.
#
# Two gates, both reading stamps hooks/keepalive-sensor.sh wrote:
#   cold  - the newest turn of any kind is older than the TTL, so the cached
#           prefix has expired. Firing now would not refresh anything; it would
#           re-read the whole conversation uncached to warm a session nobody is
#           using, and every later tick would keep it warm for no one. This is
#           what happens after the laptop slept or was offline: the in-process
#           cron is dormant, not dead, and fires the moment the machine wakes.
#           Blocked ticks stay blocked until a real turn (which pays that
#           re-read once, on purpose) restarts the chain.
#   warm  - a real turn landed inside the cancel window, so the TTL was just
#           reset and the tick buys nothing.
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

# Keep the reason to one short line. Claude Code prefixes every block with a
# fixed "UserPromptSubmit operation blocked by hook:" and there is no way to
# suppress that (confirmed in the binary - the notice is pushed unconditionally
# - and in the docs; suppressOutput only hides the hook's stdout. Upstream
# feature request: anthropics/claude-code#39499). Since the prefix already costs
# two wrapped lines several times an hour, the part we control stays minimal.
# No additionalContext either - injecting text into the turn defeats the point.
# Reasons are static strings, so no JSON escaping: the plugin stays jq-free.
# The tests assert the block/pass boundaries, not the wording.
block() { # <reason>
  printf '{"decision":"block","reason":"%s","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","suppressOriginalPrompt":true}}\n' "$1"
  exit 0
}

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

PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.cc-cache-keepalive"
STAMP="$STATE_DIR/last-real-turn-$session_id"
STAMP_ANY="$STATE_DIR/last-turn-$session_id"
NOW="$(date +%s)"

# GC inside the sentinel branch only - at most twice an hour per session, and it
# keeps the every-prompt hot path free of find(1). (cc-usage-guard sweeps on
# every UserPromptSubmit; it has no equally cheap branch to hide the sweep in.)
[ -d "$STATE_DIR" ] && find "$STATE_DIR" -maxdepth 1 -type f \
  \( \( -name 'last-real-turn-*' -mtime +7 \) -o \( -name 'last-turn-*' -mtime +7 \) \
     -o \( -name '.tmp.*' -mmin +60 \) \) \
  -delete 2>/dev/null

# read_stamp <path>: epoch from line 1, or nothing when the file is absent,
# unreadable, corrupt, or dated in the future (clock skew, a bad write - a
# future stamp would otherwise gate every tick, silently, until it aged out).
read_stamp() {
  local v
  [ -r "$1" ] || return 0
  v="$(head -n1 "$1" 2>/dev/null | tr -d '[:space:]')"
  case "$v" in ''|*[!0-9]*) return 0 ;; esac
  v=$((10#$v))
  [ "$v" -le "$NOW" ] || return 0
  printf '%s' "$v"
}
REAL_AT="$(read_stamp "$STAMP")"
ANY_AT="$(read_stamp "$STAMP_ANY")"

# --- cold gate --------------------------------------------------------------
# The cache was last touched by the newest turn of any kind - a real one or a
# ping. Older than the TTL and it is gone; the tick can only re-create it. The
# threshold is the TTL itself, not TTL - safety: blocking early would take a
# still-warm cache cold on purpose, the exact loss this plugin exists to prevent,
# while a tick a minute past the cliff costs what the next real turn would have
# paid anyway. Missing or unreadable stamps fall through (fail open); a session
# that predates the second stamp is covered by the first until its next Stop.
COLD_MIN="${CC_KEEPALIVE_COLD_MIN:-$TTL_MIN}"
case "$COLD_MIN" in ''|*[!0-9]*) COLD_MIN=$TTL_MIN ;; esac
COLD_MIN=$((10#$COLD_MIN))
if [ "$COLD_MIN" -gt 0 ]; then
  LATEST="$ANY_AT"
  if [ -n "$REAL_AT" ] && { [ -z "$LATEST" ] || [ "$REAL_AT" -gt "$LATEST" ]; }; then
    LATEST="$REAL_AT"
  fi
  if [ -n "$LATEST" ] && [ $((NOW - LATEST)) -ge $((COLD_MIN * 60)) ]; then
    block "cc-cache-keepalive: cache cold, holding for a real turn"
  fi
fi

# --- warm gate --------------------------------------------------------------
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
# Zero window means never skip a warm tick - the 1.3.0 behaviour. Intervals
# above TTL - safety land here on their own: there is no room left to skip
# safely. The cold gate above still applies: "never cancel" was never meant to
# include re-creating a dead cache.
[ "$WINDOW" -le 0 ] && exit 0

[ -n "$REAL_AT" ] || exit 0
AGE=$((NOW - REAL_AT))
# Strict <, so age == window fires. That is what keeps the worst-case bound
# above true at the boundary.
[ "$AGE" -lt $((WINDOW * 60)) ] || exit 0
block "cc-cache-keepalive: already warm"
