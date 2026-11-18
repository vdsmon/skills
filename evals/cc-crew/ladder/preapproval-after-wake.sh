#!/usr/bin/env bash
# Does the role's pre-approval outlive a wake by a background task? In the first trial session
# the same command ran, then was refused once a background agent's completion had woken the
# session. (docs/experiments.md #64)
# Spends tokens: one short Haiku session, user settings off.
#
#   preapproval-after-wake.sh <plugin-dir>
set -u
plugin=$(cd "$1" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-wake.XXXXXX") || exit 1
mkdir -p "$work/repo" "$work/plans"
cd "$work/repo" || exit 1
cmd="python3 $plugin/skills/plan/scripts/page.py /nonexistent/plan.md"
CC_CREW_PLANS="$work/plans" claude -p --model haiku --plugin-dir "$plugin" --setting-sources project,local \
  --allowedTools Read "Bash(sleep *)" --output-format stream-json --verbose \
  "/cc-crew:chief-engineer This is a permission test and nothing else. Step 1: call the Bash tool with exactly this command, character for character: $cmd  Step 2: call the Bash tool with the command 'sleep 8' and run_in_background set to true. Step 3: end your turn with the single word waiting. Step 4: when the background task's completion wakes you, call the Bash tool again with exactly the command of step 1, then reply with the single word done." \
  > "$work/out.jsonl" 2> "$work/err.txt" < /dev/null
python3 -I "$here/sequence.py" "$work/out.jsonl" | grep -v thinking_tokens
echo "work folder: $work"
