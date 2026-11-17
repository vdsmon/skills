#!/usr/bin/env bash
# Does the role still load, with its opening report, under the pre-approval the frontmatter
# gives? The role's text runs the plans script before the first reply; without a rule that
# covers that command the role does not load at all (docs/experiments.md #58, #66).
# Spends tokens: one short Haiku turn, user settings off.
#
#   preapproval-role-loads.sh <plugin-dir>
set -u
plugin=$(cd "$1" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-role.XXXXXX") || exit 1
mkdir -p "$work/repo" "$work/plans"
cd "$work/repo" || exit 1
CC_CREW_PLANS="$work/plans" claude -p --model haiku --plugin-dir "$plugin" --setting-sources project,local \
  --allowedTools Read --output-format text \
  "/cc-crew:chief-engineer Reply with the opening report exactly as you were given it, and nothing else." \
  > "$work/out.txt" 2> "$work/err.txt" < /dev/null
if grep -q -i -e "requires approval" -e "permission check failed" "$work/out.txt" "$work/err.txt"; then
  echo "role did NOT load: the plans script's command was not pre-approved"
elif grep -q -e "cc-crew-plans" -e "No plan under way" "$work/out.txt"; then
  echo "role loaded, with its opening report"
else
  echo "unclear: read $work/out.txt"
fi
head -c 400 "$work/out.txt"; echo
echo "work folder: $work"
