#!/bin/bash
# Exits 0 when the session's transcript shows /cc-crew:chief-engineer typed by the user, 1 otherwise.
# The role lasts for the whole session, compactions included, so one call anywhere in the transcript is enough.
# Usage: chief-active.sh <transcript.jsonl>
set -u

transcript=${1:-}
# Match only the user's typed command, not a quote of it in a tool result or a reply.
[ -n "$transcript" ] && [ -r "$transcript" ] &&
  grep -q -m 1 -F '"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>' "$transcript"
