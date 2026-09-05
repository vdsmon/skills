#!/usr/bin/env bash
# handoff.sh <state-dir> [repo-dir]: write <state-dir>/HANDOFF.md, the note the next
# session resumes from, with the git baseline embedded and the sections the skill fills.
#
# The mechanics are deterministic, so they live here and not in the model's memory of
# what a handoff holds: where the file goes, what header it carries, which sections it
# has, and that an earlier handoff is kept as HANDOFF.prev.md instead of being lost.
# Prints the path of the file written. Exit 0 always.
set -u

state_dir="${1:-}"
repo_dir="${2:-.}"
if [ -z "$state_dir" ]; then
  echo "usage: handoff.sh <state-dir> [repo-dir]" >&2
  exit 0
fi
mkdir -p "$state_dir" 2>/dev/null || { echo "handoff: cannot create $state_dir" >&2; exit 0; }
target="$state_dir/HANDOFF.md"
[ -f "$target" ] && cp -f "$target" "$state_dir/HANDOFF.prev.md" 2>/dev/null

here=$(cd "$(dirname "$0")" && pwd)
baseline=$(bash "$here/baseline.sh" "$repo_dir" 2>/dev/null)
stamp=$(date -u '+%Y-%m-%d %H:%MZ')
repo_abs=$(cd "$repo_dir" 2>/dev/null && pwd -P || printf '%s' "$repo_dir")

{
  echo "# Handoff, $stamp"
  echo
  echo "Written by prep-exit before the session ended. The next session starts from this file"
  echo "and from persistent memory; nothing else of that session survives."
  echo
  echo "Repository: \`$repo_abs\`"
  echo
  echo '```text'
  printf '%s\n' "$baseline"
  echo '```'
  echo
  echo "## Where we are"
  echo
  echo "(fill: the task, the branch, the stage; one paragraph)"
  echo
  echo "## Done this session"
  echo
  echo "(fill: milestones, counts, commits)"
  echo
  echo "## Decisions and facts that live only here"
  echo
  echo "(fill: chosen approaches and why, rejected ones and why, preferences stated, debug findings, numbers)"
  echo
  echo "## Pending"
  echo
  echo "(fill: background output captured and what it said; session-only crons and reminders to recreate; chips or spawned tasks still open; messages from other sessions not yet answered)"
  echo
  echo "## Next step"
  echo
  echo "(fill: the first action of the next session, with the file or command to touch first)"
  echo
  echo "## Resume prompt"
  echo
  echo '```text'
  echo "(fill: the first message to paste into the next session; it names this file)"
  echo '```'
} > "$target" 2>/dev/null

printf '%s\n' "$target"
exit 0
