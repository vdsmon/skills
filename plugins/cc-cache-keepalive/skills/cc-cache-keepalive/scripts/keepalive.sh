#!/usr/bin/env bash
# Print the CronCreate instruction that keeps the prompt cache warm on Max plans
# (1h TTL). The /cc-cache-keepalive skill runs this on demand, so only sessions
# the user chose get a keepalive.
#
# Flag file: ~/.cc-cache-keepalive (the guard and sensor hooks need it too)
#   Empty      → default interval (30m)
#   Line 1     → interval override, e.g. `4m`, `1h`, `90s`
#                Format: <digits><s|m|h|d>. Invalid values fall back to default.
#
# We compute the cron expression ourselves (anchored to the current minute)
# instead of delegating to /loop, because /loop's `Nm` → `*/N * * * *` rewrite
# lands every user on the :00/:30 fleet peak.
#
# The cron prompt is the sentinel "cc-cache-keepalive". The model replies
# with "🔄 cache-keepalive" — no tool call, no thinking. That bare API turn
# refreshes the cached-prefix TTL, which is the only thing we need.
set -u

FLAG="${HOME}/.cc-cache-keepalive"
# Without the flag the guard and sensor hooks are off, so nothing would cancel a
# tick into a cold cache after the machine slept. Refuse rather than arm blind.
if [ ! -f "$FLAG" ]; then
  echo "cc-cache-keepalive: not armed. Run \`touch ~/.cc-cache-keepalive\` first, so the guard can cancel pointless ticks."
  exit 0
fi

DEFAULT_INTERVAL="30m"
INTERVAL="$(head -n1 "$FLAG" 2>/dev/null | tr -d '[:space:]')"
# The zero check is not cosmetic: `0m` passes the regex and then divides by zero
# in the `60 % N` below, and bash aborts a script on an arithmetic error even
# without `set -e`: no cron, no output, no visible error. Same for the `10#`
# below - `08m` and `09s` are decimal to a user but octal to $(( )), and die the
# same silent way. (Only line 1 is read here; hooks/keepalive-guard.sh reads
# line 2 for the cancel window, where zero IS meaningful and means "never skip".)
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

cat <<EOF
<cc-cache-keepalive>
Step 1. Call the CronList tool.
Step 2. If any job with prompt "${CMD}" already exists, stop: never create a second keepalive. Otherwise call the CronCreate tool with:
  cron:      "${CRON}"
  prompt:    "${CMD}"
  recurring: true
Step 3. Tell the user in one line that the keepalive is on (or was already on), with the cron expression.

The prompt is the literal sentinel string "${CMD}". When the cron later fires, do NOT call any tool, do NOT think, do NOT narrate — reply with exactly "🔄 cache-keepalive" and end the turn. The API turn alone refreshes the cached-prefix TTL.
Do NOT invoke /loop — its Nm→*/N rewrite lands on fleet-peak minutes (:00/:30).
</cc-cache-keepalive>
EOF
