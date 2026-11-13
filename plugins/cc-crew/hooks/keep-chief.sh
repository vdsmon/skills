#!/bin/bash
# SessionStart hook for compactions: puts the chief engineer's role back in force when the session had it.
# Claude Code re-attaches invoked skills after a compaction, but only as context "where still relevant", and newest first
# within a 25k-token budget, so the role typed at the start of a long session is the first one dropped.
# Off switch: CC_CREW_KEEP_CHIEF=0.
# Fails open toward silence: any missing input prints nothing, because a wrong role is worse than a missing one.
set -u

[ "${CC_CREW_KEEP_CHIEF:-1}" = 0 ] && exit 0
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
input=$(cat)
field() { printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }

[ "$(field source)" = compact ] || exit 0
bash "$root/scripts/chief-active.sh" "$(field transcript_path)" || exit 0
skill=$root/skills/chief-engineer/SKILL.md
[ -r "$skill" ] || exit 0

printf '<cc-crew-chief>\nThe conversation was just compacted. Victor typed /cc-crew:chief-engineer in this session, so you are still the chief engineer on his crew. The role below is in force for the rest of this session, not background context. Follow its "After a compaction" section now.\n\n'
awk 'f >= 2 { print } /^---$/ { f++ }' "$skill"
printf '</cc-crew-chief>\n'
exit 0
