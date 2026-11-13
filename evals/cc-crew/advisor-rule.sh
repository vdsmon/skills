#!/usr/bin/env bash
# Does the role text keep the chief engineer from calling the advisor?
# Spends tokens: each run is one short Fable session with the advisor on.
#
#   advisor-rule.sh [plugin-dir] [runs]
#
# Prints the advisor calls of each run, and of one control run on a copy of the
# plugin with the rule's line removed. The rule holds when every run prints 0
# and the control does not: a control at 0 means the advisor was not there to
# call, so the runs show nothing (docs/experiments.md #51).
set -u

plugin=${1:-$(cd "$(dirname "$0")/../../plugins/cc-crew" && pwd)}
runs=${2:-5}

# Not under ~/.claude: the harness refuses edits there, and a run that cannot
# edit ends before it would consult anyone.
work=$(mktemp -d "${TMPDIR:-/tmp}/advisor-rule.XXXXXX") || exit 1

role=skills/chief-engineer/SKILL.md
mkdir "$work/control" && cp -R "$plugin" "$work/control/cc-crew" || exit 1
grep -v '`advisor` tool' "$plugin/$role" > "$work/control/cc-crew/$role"
if cmp -s "$plugin/$role" "$work/control/cc-crew/$role"; then
  echo "advisor-rule.sh: no line naming the \`advisor\` tool in $plugin/$role, so there is no rule to measure" >&2
  exit 1
fi

one() { # <name> <plugin-dir>
  local d="$work/$1" passes=no calls
  mkdir -p "$d/repo" && cd "$d/repo" || return
  printf 'def count_words(text):\n    return len(text.split(" "))\n' > count.py
  printf 'from count import count_words\n\nassert count_words("a b") == 2\nassert count_words("a  b") == 2\nassert count_words("") == 0\n' > test_count.py
  # User settings off, so the installed cc-crew does not load beside this one.
  claude -p --model fable --advisor fable --plugin-dir "$2" --setting-sources project,local \
    --permission-mode acceptEdits --allowedTools Bash Read Edit Write Grep Glob \
    --output-format stream-json --verbose \
    "/cc-crew:chief-engineer python3 test_count.py fails in this folder. Fix count.py so it passes, then tell me it is done." \
    > "$d/out.jsonl" 2> "$d/err.txt" < /dev/null
  python3 test_count.py > /dev/null 2>&1 && passes=yes
  calls=$(python3 - "$d/out.jsonl" << 'PY'
import json
import sys

calls = set()
for line in open(sys.argv[1], errors="ignore"):
    try:
        message = json.loads(line).get("message")
    except (ValueError, AttributeError):
        continue
    content = message.get("content") if isinstance(message, dict) else None
    for block in content if isinstance(content, list) else []:
        if isinstance(block, dict) and block.get("type") == "server_tool_use" and block.get("name") == "advisor":
            calls.add(block.get("id"))
print(len(calls))
PY
  )
  echo "$1: advisor calls $calls, test passes $passes" > "$d/line.txt"
}

for n in $(seq 1 "$runs"); do one "run-$n" "$plugin" & done
one rule-removed "$work/control/cc-crew" &
wait
cat "$work"/run-*/line.txt "$work/rule-removed/line.txt"
echo "streams kept in $work"
if ! grep -q 'advisor calls [1-9]' "$work/rule-removed/line.txt"; then
  echo "VOID: the control made no advisor call, so the runs above show nothing" >&2
  exit 1
fi
exit 0
