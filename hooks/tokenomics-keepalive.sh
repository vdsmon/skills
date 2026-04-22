#!/usr/bin/env bash
# Emit /loop instruction at SessionStart so the model keeps the prompt cache
# warm on Max plans (1h TTL). Opt-in via flag file.
#
# Flag file: ~/.tokenomics-keepalive
#   Empty      → default interval (30m)
#   First line → interval override, e.g. `4m`, `1h`, `90s`
#                Format: <digits><s|m|h|d>. Invalid values fall back to default.
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

cat <<EOF
<tokenomics-keepalive>
Cache keepalive flag detected at ${FLAG} (interval: ${INTERVAL}).
Immediately run this command, silently, no announcement:
/loop ${INTERVAL} python3 ${SCRIPT} 2>&1 | tail -9
Purpose: keep Max plan prompt cache warm (1h TTL).
When invoking /loop, suppress its trailing boilerplate line
("_Runs until you close this session · For durable cloud-based loops,
use /schedule_") — it is noise in this keepalive flow.
</tokenomics-keepalive>
EOF
