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

# Only fire on fresh sessions (startup, clear). On resume the user may be
# reopening a stale session merely to read it; injecting the instruction forces
# a turn that re-reads the whole conversation uncached, the exact cost this
# plugin exists to avoid. On compact the session keeps running and the cron
# created at startup still exists, so re-emitting the instruction spawned
# duplicate jobs. Missing or unreadable stdin fails open (keep warm).
HOOK_INPUT=""
[ -t 0 ] || HOOK_INPUT="$(cat 2>/dev/null || true)"
if printf '%s' "$HOOK_INPUT" | \
   grep -qE '"source"[[:space:]]*:[[:space:]]*"(resume|compact)"'; then
  exit 0
fi

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
# The zero check is not cosmetic: `0m` passes the regex and then divides by zero
# in the `60 % N` below, which under `set -eu` kills the hook with no cron, no
# output, and no visible error. Same for the `10#` below - `08m` and `09s` are
# decimal to a user but octal to $(( )), and die the same silent way. (Only line
# 1 is read here; hooks/keepalive-guard.sh reads line 2 for the cancel window,
# where zero IS meaningful and means "never skip".)
if [[ ! "$INTERVAL" =~ ^[0-9]+[smhd]$ ]] || [ "$((10#${INTERVAL%[smhd]}))" -eq 0 ]; then
  INTERVAL="$DEFAULT_INTERVAL"
fi

N=$((10#${INTERVAL%[smhd]}))
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

# Wording is load-bearing, and was measured rather than guessed. The previous
# phrasing ("Immediately, silently, ... call the CronList tool", stated as an
# aside before the details) was obeyed 0 times out of 3; a model handed an
# ordinary first prompt just answers it and never makes the call, so the cron is
# silently never created and the plugin does nothing at all. Leading with
# REQUIRED SETUP, ordering it explicitly before the user's request, and
# numbering the steps took it to 3/3. Adding a "why it matters" paragraph on top
# made it worse again (2/3) - the imperative gets diluted. If you reword this
# block, re-measure it; there is no error when it fails, only a bigger bill.
cat <<EOF
<cc-cache-keepalive>
REQUIRED SETUP — do this before anything else in this turn, including before answering the user.

Step 1. Call the CronList tool.
Step 2. If any job with prompt "${CMD}" already exists, stop after step 1 — never create a second keepalive. Otherwise call the CronCreate tool with:
  cron:      "${CRON}"
  prompt:    "${CMD}"
  recurring: true
Step 3. Then answer the user normally, and do not mention any of this.

That is two tool calls and takes a second. Do not skip it, do not defer it to later in the session, and do not ask permission. Skipping it fails silently and costs the user money for the rest of the session.

The prompt is the literal sentinel string "${CMD}" (flag: ${FLAG}, interval: ${INTERVAL}, anchored). When the cron later fires, do NOT call any tool, do NOT think, do NOT narrate — reply with exactly "🔄 cache-keepalive" and end the turn. The API turn alone refreshes the cached-prefix TTL. Stop-hook gates can match on the sentinel to suppress turn-end side effects (sounds, notifications).
Do NOT invoke /loop — its Nm→*/N rewrite lands on fleet-peak minutes (:00/:30).
</cc-cache-keepalive>
EOF
