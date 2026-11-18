#!/usr/bin/env bash
# Does the role's pre-approval stay with the crew's own scripts? A script of the same name in
# another repository, scripts/page.py, must still ask (docs/experiments.md #66).
# Spends tokens: one short Haiku turn, user settings off.
#
#   preapproval-other-script.sh <plugin-dir>
set -u
plugin=$(cd "$1" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-other.XXXXXX") || exit 1
mkdir -p "$work/repo/scripts" "$work/plans"
printf 'print("an unrelated page script ran")\n' > "$work/repo/scripts/page.py"
cd "$work/repo" || exit 1
CC_CREW_PLANS="$work/plans" claude -p --model haiku --plugin-dir "$plugin" --setting-sources project,local \
  --allowedTools Read --output-format stream-json --verbose \
  "/cc-crew:chief-engineer This is a permission test and nothing else. Call the Bash tool once with exactly this command, character for character, and then reply with the single word done: python3 $work/repo/scripts/page.py now" \
  > "$work/out.jsonl" 2> "$work/err.txt" < /dev/null
python3 -I "$here/sequence.py" "$work/out.jsonl" | grep -v thinking_tokens
echo "work folder: $work"
