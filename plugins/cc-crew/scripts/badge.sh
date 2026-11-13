#!/bin/bash
# Status line badge: prints "⚓ chief" when /cc-crew:chief-engineer was typed in this session, nothing otherwise.
# Reads Claude Code's status line JSON on stdin, so it works as a ccstatusline custom-command widget or from any statusLine command.
# The role lasts for the whole session, compactions included, so any one call in the transcript is enough.
# Fails quiet: no input, no transcript or no match all print nothing.
set -u

input=$(cat)
transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
# Match only the user's typed command, not a quote of it in a tool result or a reply.
if [ -n "$transcript" ] && [ -r "$transcript" ] &&
  grep -q -m 1 -F '"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>' "$transcript"; then
  printf '⚓ chief'
fi
exit 0
