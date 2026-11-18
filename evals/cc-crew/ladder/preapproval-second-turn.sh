#!/usr/bin/env bash
# Does the role's pre-approval outlive the turn in which the role command was typed?
# (docs/experiments.md #63) Spends tokens: one short Haiku session of two turns, user settings off.
#
#   preapproval-second-turn.sh <plugin-dir>
set -u
plugin=$(cd "$1" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-turns.XXXXXX") || exit 1
mkdir -p "$work/repo" "$work/plans"
cd "$work/repo" || exit 1
cmd="python3 $plugin/skills/plan/scripts/page.py /nonexistent/plan.md"
python3 -I - "$cmd" > "$work/in.jsonl" <<'PY'
import json, sys
cmd = sys.argv[1]
first = "/cc-crew:chief-engineer This is a permission test and nothing else. Call the Bash tool once with exactly this command, character for character, and then reply with the single word done: " + cmd
second = "Second turn of the same test. Call the Bash tool once more with exactly this command, character for character, and then reply with the single word done: " + cmd
for text in (first, second):
    print(json.dumps({"type": "user", "message": {"role": "user", "content": text}}))
PY
CC_CREW_PLANS="$work/plans" claude -p --model haiku --plugin-dir "$plugin" --setting-sources project,local \
  --allowedTools Read --input-format stream-json --output-format stream-json --verbose \
  < "$work/in.jsonl" > "$work/out.jsonl" 2> "$work/err.txt"
python3 -I "$here/sequence.py" "$work/out.jsonl" | grep -v thinking_tokens
echo "work folder: $work"
