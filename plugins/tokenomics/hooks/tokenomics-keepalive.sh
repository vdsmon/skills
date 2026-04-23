#!/usr/bin/env bash
# Emit CronCreate instruction at SessionStart so the model keeps the prompt
# cache warm on Max plans (1h TTL). Opt-in via flag file.
#
# Flag file: ~/.tokenomics-keepalive
#   Empty      → default interval (30m), report silent
#   Line 1     → interval override, e.g. `4m`, `1h`, `90s`
#                Format: <digits><s|m|h|d>. Invalid values fall back to default.
#   Line 2+    → `report=on` opts in to printing the token report each fire.
#                Absent/anything else = silent (fires still warm cache).
#
# We compute the cron expression ourselves (anchored to session start minute)
# instead of delegating to /loop, because /loop's `Nm` → `*/N * * * *` rewrite
# lands every user on the :00/:30 fleet peak.
set -eu

FLAG="${HOME}/.tokenomics-keepalive"
[ -f "$FLAG" ] || exit 0

SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/tokenomics/scripts/token-report.py"
[ -f "$SCRIPT" ] || exit 0

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

CMD="python3 ${SCRIPT} --keepalive 2>&1 | tail -9"

cat <<EOF
<tokenomics-keepalive>
Cache keepalive flag detected at ${FLAG} (interval: ${INTERVAL}, anchored).
Immediately, silently, with no announcement, call the CronCreate tool with:
  cron:      "${CRON}"
  prompt:    "${CMD}"
  recurring: true
Do NOT invoke /loop — its Nm→*/N rewrite lands on fleet-peak minutes (:00/:30).
After scheduling, also run the prompt once now via Bash to prime the cache.
Purpose: keep Max plan prompt cache warm (1h TTL).
</tokenomics-keepalive>
EOF
