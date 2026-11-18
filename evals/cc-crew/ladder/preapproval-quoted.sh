#!/usr/bin/env bash
# Does the role's pre-approval cover the page script when the command is written with its
# path in quotes, as the plan skill writes it, and without? (docs/experiments.md #62)
# Spends tokens: two short Haiku turns. User settings are off, so only the role's own
# allowed-tools can approve the command.
#
#   preapproval-quoted.sh <plugin-dir>
set -u
plugin=$(cd "$1" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-pretest.XXXXXX") || exit 1
mkdir -p "$work/repo" "$work/plans"
cd "$work/repo" || exit 1
page="$plugin/skills/plan/scripts/page.py"

one() { # <name> <command the model must run>
  CC_CREW_PLANS="$work/plans" claude -p --model haiku --plugin-dir "$plugin" --setting-sources project,local \
    --allowedTools Read --output-format stream-json --verbose \
    "/cc-crew:chief-engineer This is a permission test and nothing else. Call the Bash tool once with exactly this command, character for character, and then reply with the single word done: $2" \
    > "$work/$1.jsonl" 2> "$work/$1.err" < /dev/null
  python3 -I - "$work/$1.jsonl" "$1" <<'PY'
import json, sys
ran, denied, cmds = [], [], []
for line in open(sys.argv[1], errors="ignore"):
    try:
        d = json.loads(line)
    except ValueError:
        continue
    msg = d.get("message") if isinstance(d, dict) else None
    content = msg.get("content") if isinstance(msg, dict) else None
    for b in content if isinstance(content, list) else []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "tool_use" and b.get("name") == "Bash":
            cmds.append(b.get("input", {}).get("command", ""))
        if b.get("type") == "tool_result":
            c = b.get("content")
            text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""
            (denied if ("requires approval" in text or "permission" in text.lower()) else ran).append(text[:160].replace("\n", " "))
    if isinstance(d, dict) and d.get("type") == "result":
        for pd in d.get("permission_denials", []) or []:
            denied.append("denied: " + json.dumps(pd)[:160])
print(sys.argv[2], "| commands:", cmds, "| ran:", ran, "| denied:", denied)
PY
}

one quoted "python3 \"$page\" /nonexistent/plan.md"
one unquoted "python3 $page /nonexistent/plan.md"
echo "work folder: $work"
