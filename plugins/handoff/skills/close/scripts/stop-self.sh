#!/usr/bin/env bash
# Stops this Claude Code background session once its current turn ends.
# A `claude stop` run inside the turn kills the session before the reply is saved,
# so the close report would be lost (docs/experiments.md #55).
# Fails open toward a running session: if the turn has not ended within the cap, nothing is stopped.
set -u
job="${CLAUDE_JOB_DIR:-}"
if [ -z "$job" ] || [ ! -f "$job/state.json" ] || ! command -v claude >/dev/null 2>&1; then
  echo "not a background session: nothing to stop"
  exit 0
fi
id=$(basename "$job")
nohup bash -c '
  for _ in $(seq 1 "$3"); do
    if ! grep -q "\"state\": *\"working\"" "$1" 2>/dev/null; then
      claude stop "$2"
      exit 0
    fi
    sleep 1
  done
' _ "$job/state.json" "$id" "${CLOSE_STOP_WAIT_SECONDS:-600}" >"$job/close-stop.log" 2>&1 &
echo "stop armed: session $id stops when this turn ends"
exit 0
