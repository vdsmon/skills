#!/bin/bash
# Status line badge: prints "⚓ chief" when /cc-crew:chief-engineer was typed in this session, nothing otherwise,
# followed by the plan the session holds and where it stands (plans.py badge).
# Reads Claude Code's status line JSON on stdin, so it works as a ccstatusline custom-command widget (with preserve colors on)
# or from any statusLine command.
# Prints its own colors: bold bright blue, and a wait on Victor in orange so it stands out from the rest.
# Fails quiet: no input, no transcript or no match all print nothing.
set -u

here=$(cd "$(dirname "$0")" && pwd)
transcript=$(sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if bash "$here/chief-active.sh" "$transcript"; then
  # The transcript file is named by the session's id.
  session=$(basename "$transcript" .jsonl)
  plan=$(python3 "$here/plans.py" badge "$session" "$transcript" 2>/dev/null)
  orange=$'\e[38;5;208m'
  printf '\e[1;94m⚓ chief%s\e[0m' "${plan/ · ✋/ · $orange✋}"
fi
exit 0
