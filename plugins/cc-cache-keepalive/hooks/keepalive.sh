#!/usr/bin/env bash
# Emit CronCreate instruction at SessionStart so the model keeps the prompt
# cache warm on Max plans (1h TTL). Opt-in via flag file.
#
# Flag file: ~/.cc-cache-keepalive
#   Empty      → default interval (30m)
#   Line 1     → interval override, e.g. `4m`, `1h`, `90s`
#                Format: <digits><s|m|h|d>. Invalid values fall back to default.
#
# We compute the cron expression ourselves (anchored to session start minute)
# instead of delegating to /loop, because /loop's `Nm` → `*/N * * * *` rewrite
# lands every user on the :00/:30 fleet peak.
#
# The cron prompt is the sentinel "cc-cache-keepalive". The model replies
# with "🔄 cache-keepalive" — no tool call, no thinking. That bare API turn
# refreshes the cached-prefix TTL, which is the only thing we need.
set -eu

FLAG="${HOME}/.cc-cache-keepalive"
[ -f "$FLAG" ] || exit 0

# Per-invocation kill switch. The --auto intent gate below only matches sessions
# launched as their own bg job; a child spawned with an inherited CLAUDE_JOB_DIR
# (e.g. an orchestrator nudging a stalled run via `claude -p --resume`) reads the
# parent's intent and slips through. Exporting CC_KEEPALIVE_OFF=1 suppresses the
# keepalive for exactly that invocation, nothing else.
[ -n "${CC_KEEPALIVE_OFF:-}" ] && exit 0

# Skip transient `/flow <key> --auto` background runs. They finish their pipeline
# and go idle, but the keepalive cron is a session-scoped recurring task that fires
# forever — so it pins the session at state=working and the daemon never drops it,
# leaving a zombie in the agents panel (a whole drain's worth piled up before this
# gate). An attended session has an empty intent and is unaffected; only a self-
# completing --auto run is gated. (state.json carries the launch intent; absent /
# unreadable → not gated, fail toward keeping the cache warm.)
if [ -n "${CLAUDE_JOB_DIR:-}" ] && \
   grep -qE '"intent"[[:space:]]*:[[:space:]]*"/flow[^"]*--auto"' \
     "${CLAUDE_JOB_DIR}/state.json" 2>/dev/null; then
  exit 0
fi

DEFAULT_INTERVAL="30m"
INTERVAL="$(head -n1 "$FLAG" 2>/dev/null | tr -d '[:space:]')"
if [[ ! "$INTERVAL" =~ ^[0-9]+[smhd]$ ]]; then
  INTERVAL="$DEFAULT_INTERVAL"
fi

N="${INTERVAL%[smhd]}"
UNIT="${INTERVAL: -1}"
NOW_MIN=$((10#$(date +%M)))
NOW_HOUR=$((10#$(date +%H)))

# Collapse seconds to minutes (cron min granularity = 1m).
if [ "$UNIT" = "s" ]; then
  N=$(( (N + 59) / 60 ))
  [ "$N" -lt 1 ] && N=1
  UNIT="m"
fi
# Collapse minutes ≥60 divisible by 60 to hours.
if [ "$UNIT" = "m" ] && [ "$N" -ge 60 ] && [ $((N % 60)) -eq 0 ]; then
  N=$((N / 60))
  UNIT="h"
fi

build_list() {
  # build_list <start> <step> <max> → "a,b,c" anchored at start, step by step, all < max
  local start=$1 step=$2 max=$3 cur list
  cur=$((start % step))
  list="$cur"
  while [ $((cur + step)) -lt "$max" ]; do
    cur=$((cur + step))
    list="$list,$cur"
  done
  echo "$list"
}

case "$UNIT" in
  m)
    if [ "$N" -eq 1 ]; then
      CRON="* * * * *"
    elif [ $((60 % N)) -eq 0 ]; then
      MINS="$(build_list "$NOW_MIN" "$N" 60)"
      CRON="${MINS} * * * *"
    else
      CRON="*/${N} * * * *"
    fi
    ;;
  h)
    if [ "$N" -eq 1 ]; then
      CRON="${NOW_MIN} * * * *"
    elif [ "$N" -le 23 ] && [ $((24 % N)) -eq 0 ]; then
      HOURS="$(build_list "$NOW_HOUR" "$N" 24)"
      CRON="${NOW_MIN} ${HOURS} * * *"
    else
      CRON="${NOW_MIN} */${N} * * *"
    fi
    ;;
  d)
    CRON="${NOW_MIN} ${NOW_HOUR} */${N} * *"
    ;;
esac

CMD="cc-cache-keepalive"

cat <<EOF
<cc-cache-keepalive>
Cache keepalive flag detected at ${FLAG} (interval: ${INTERVAL}, anchored).
Immediately, silently, with no announcement, call the CronCreate tool with:
  cron:      "${CRON}"
  prompt:    "${CMD}"
  recurring: true
The prompt is the literal sentinel string "cc-cache-keepalive". Do NOT call any tool, do NOT think, do NOT narrate. When the cron fires, reply with exactly "🔄 cache-keepalive" and end the turn. The API turn alone refreshes the cached-prefix TTL — no tool call required. Stop-hook gates can match on the sentinel to suppress turn-end side effects (sounds, notifications).
Do NOT invoke /loop — its Nm→*/N rewrite lands on fleet-peak minutes (:00/:30).
Purpose: keep Max plan prompt cache warm (1h TTL).
</cc-cache-keepalive>
EOF
