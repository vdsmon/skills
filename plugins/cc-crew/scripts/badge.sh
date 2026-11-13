#!/bin/bash
# Status line badge: prints "⚓ chief" when /cc-crew:chief-engineer was typed in this session, nothing otherwise.
# Reads Claude Code's status line JSON on stdin, so it works as a ccstatusline custom-command widget or from any statusLine command.
# Fails quiet: no input, no transcript or no match all print nothing.
set -u

here=$(cd "$(dirname "$0")" && pwd)
transcript=$(sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if bash "$here/chief-active.sh" "$transcript"; then
  printf '⚓ chief'
fi
exit 0
