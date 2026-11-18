#!/bin/bash
# Stop hook: in a chief engineer's session, records the background tasks and wakeups still out when the turn ends,
# so the status line badge can say what the session waits on (plans.py turn-end). Off with CC_CREW_STATUS=off.
# Fails open toward the badge's own reading: when this writes nothing, the badge finds no record newer than the
# transcript's last entry and says what the transcript alone shows. Prints nothing, since stdout would reach the model.
set -u

[ "${CC_CREW_STATUS:-}" = off ] && exit 0
here=$(cd "$(dirname "$0")" && pwd)
input=$(cat)
transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
bash "$here/../scripts/chief-active.sh" "$transcript" || exit 0
printf '%s' "$input" | python3 "$here/../scripts/plans.py" turn-end >/dev/null 2>&1
exit 0
