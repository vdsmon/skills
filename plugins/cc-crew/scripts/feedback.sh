#!/bin/bash
# Appends one entry to the crew's feedback ledger.
# Usage: feedback.sh <piece> [session-id] < entry-text
set -u

piece=${1:-}
session=${2:-unknown}
if [ -z "$piece" ]; then
  echo "usage: feedback.sh <piece> [session-id] < entry-text" >&2
  exit 2
fi

dir=${CC_CREW_HOME:-$HOME/.claude/.cc-crew}
mkdir -p "$dir"
{
  printf '\n## %s · %s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$piece"
  printf -- '- Session: %s\n' "$session"
  printf -- '- Repository: %s\n\n' "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cat
  printf '\n'
} >> "$dir/feedback.md"

echo "Filed in $dir/feedback.md"
