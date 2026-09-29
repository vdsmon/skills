#!/usr/bin/env bash
# Stop hook: records when the last turn ended, so hooks/keepalive-guard.sh can
# tell "you were working two minutes ago" from "you have been away an hour"
# from "the machine slept and the cache is already gone".
#
# Two stamps per session, same format (epoch on line 1, uuid on line 2):
#   last-real-turn-<id>  written after a REAL turn only. The guard cancels a
#                        tick this stamp says is redundant.
#   last-turn-<id>       written after ANY turn the API answered, pings
#                        included. The guard cancels a tick this stamp says
#                        would hit a dead cache - the newest of the two is when
#                        the cached prefix was last touched.
#
# Only Stop is wired, never SubagentStop. Those are separate events and Stop
# carries no agent_id, so declaring Stop alone gives main-agent-only stamping
# for free - which is what we want, because a subagent's or teammate's turn does
# not refresh the main session's cached prefix, and stamping on one would
# suppress a ping the main session actually needs.
#
# Writes nothing to stdout, ever: a Stop hook that exits non-zero or emits a
# block decision stops the session from stopping. Hence `set -u` and not
# `set -eu`, and an explicit exit 0 on every path.
set -u

FLAG="${HOME}/.cc-cache-keepalive"
[ -f "$FLAG" ] || exit 0
[ -n "${CC_KEEPALIVE_OFF:-}" ] && exit 0

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"

# Same keying and same fail-open rule as the guard: no id, no stamp, never a
# shared file.
session_id="$(printf '%s' "$input" \
  | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{8,}"' \
  | head -n1 | grep -oE '[0-9a-fA-F-]{8,}' | tail -n1)"
[ -n "$session_id" ] || exit 0

# The payload hands us the transcript path; don't re-derive it.
TRANSCRIPT="$(printf '%s' "$input" \
  | grep -oE '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n1 | sed 's/^[^:]*:[[:space:]]*"//; s/"$//')"
[ -n "$TRANSCRIPT" ] && [ -r "$TRANSCRIPT" ] || exit 0

# Last real user line. tail first because this runs at the end of every turn and
# transcripts reach tens of MB; the largest gap between consecutive non-tool-
# result user lines measured in a real 8,499-line session was 259, so 800 is
# ample. Full-file fallback keeps it correct on pathological transcripts.
# grep '"type":"user"' also excludes the queue-operation records that carry the
# same sentinel in their content.
LAST="$(tail -n 800 "$TRANSCRIPT" 2>/dev/null \
  | grep '"type":"user"' | grep -v 'toolUseResult' | tail -n 1)"
[ -n "$LAST" ] || LAST="$(grep '"type":"user"' "$TRANSCRIPT" 2>/dev/null \
  | grep -v 'toolUseResult' | tail -n 1)"
[ -n "$LAST" ] || exit 0

# A turn only touched the cache if the API answered it. Offline, rate-limited,
# or logged-out turns end in a synthetic assistant record ("API Error: Unable to
# connect to API (ENOTFOUND)", "You've hit your session limit", ...) that never
# left the machine; stamping one would call a dead cache warm, and the tick that
# trusts it later pays a full uncached re-read. So a positive error signal on
# the record that ended this turn means no stamp of either kind. A transcript
# with no assistant record at all is left alone (Stop always follows one).
LAST_ASSIST="$(tail -n 800 "$TRANSCRIPT" 2>/dev/null \
  | grep '"type":"assistant"' | tail -n 1)"
if printf '%s' "$LAST_ASSIST" | grep -qE \
   '"isApiErrorMessage"[[:space:]]*:[[:space:]]*true|"model"[[:space:]]*:[[:space:]]*"<synthetic>"'; then
  exit 0
fi

# Note the fail direction is inverted versus stop-sound.sh, which falls through
# to acting when it cannot read the transcript. Here, if we cannot tell whether
# the turn was a ping, we must NOT stamp it as real: stamping on unknown risks
# a cold cache, not stamping costs one ping.

UUID="$(printf '%s' "$LAST" \
  | grep -oE '"uuid"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{8,}"' \
  | head -n1 | grep -oE '[0-9a-fA-F-]{8,}' | tail -n1)"

PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.cc-cache-keepalive"
NOW="$(date +%s)"

# write_stamp <path>: atomic write of "epoch\nuuid". Line 2 holds the uuid of the
# user line we stamped for. Re-stamping the same prompt would slide the gate
# forward every turn without a new prompt ever arriving - the one path that
# could hold a session's cache open until it went cold. Costs three lines,
# removes the class.
write_stamp() {
  if [ -n "$UUID" ] && [ "$UUID" = "$(sed -n 2p "$1" 2>/dev/null)" ]; then
    return 0
  fi
  local tmp="$STATE_DIR/.tmp.$$"
  if printf '%s\n%s\n' "$NOW" "$UUID" > "$tmp" 2>/dev/null; then
    mv -f "$tmp" "$1" 2>/dev/null || rm -f "$tmp" 2>/dev/null
  else
    rm -f "$tmp" 2>/dev/null
  fi
}

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
write_stamp "$STATE_DIR/last-turn-$session_id"

# Loose match on purpose - the mirror image of the guard's strict one. The
# asymmetry follows from fail-open: a guard false positive blocks a real user
# prompt (unacceptable), while a sensor false positive just means the next tick
# fires unnecessarily (one wasted ping). Loose also covers pre-1.3.0 crons,
# whose prompt was "[Silent cc-cache-keepalive - ...]".
# Deliberately NOT the full marker list from ~/.claude/hooks/stop-sound.sh: an
# autonomous-loop wakeup IS a real API turn and should stamp.
printf '%s' "$LAST" | grep -q 'cc-cache-keepalive' && exit 0

write_stamp "$STATE_DIR/last-real-turn-$session_id"
exit 0
