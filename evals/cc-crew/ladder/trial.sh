#!/usr/bin/env bash
# Does the plan skill lead a chief engineer that never heard of the ladder or the skeleton
# from a settled design to a plan file with its ladder and a page made by the script?
# (docs/experiments.md #65) Spends tokens: one Fable session; the first took 32 minutes.
# The reviewer is a stand-in that finds no blocker, nothing is published, and no builder
# starts. User settings are off, so the installed cc-crew does not load beside this one.
# The two scripts are allowed here outright: a wake by a background task drops the role's
# own pre-approval (#64), which the preapproval scripts measure by themselves.
#
# Each run writes into a folder of its own under <result-dir>, so a failed run never replaces
# a good one, and the script exits with the session's own code.
#
#   trial.sh <plugin-dir> <result-dir>
set -u
plugin=$(cd "$1" && pwd)
# Absolute before the script changes folder, or the copies at the end land in the scratch repository.
mkdir -p "$2" && result=$(cd "$2" && pwd)/run-$(date +%Y%m%d-%H%M%S) && mkdir "$result" || exit 1
# Not under ~/.claude: the harness refuses edits there.
work=$(mktemp -d "${TMPDIR:-/tmp}/ladder-trial.XXXXXX") || exit 1
mkdir -p "$work/repo/scripts" "$work/plans" "$work/bin"

cat > "$work/repo/scripts/backup.sh" <<'EOF'
#!/usr/bin/env bash
# Writes one archive per night to the bucket, named by date.
set -eu
day=$(date +%F)
pg_dump "$DATABASE_URL" | gzip > "/tmp/db-$day.sql.gz"
aws s3 cp "/tmp/db-$day.sql.gz" "s3://acme-backups/db/db-$day.sql.gz"
EOF

# The stand-in reviewer: every read comes back with no blocker, so no Codex usage is spent.
# It says nothing about being a stand-in in its answer: in the first trial it did, and the
# session rightly distrusted it and ran the fallback reviewer three times.
cat > "$work/bin/codex" <<'EOF'
#!/usr/bin/env bash
out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
cat > /dev/null
echo "OpenAI Codex (stand-in)"
[ -n "$out" ] && printf 'No blockers found.\n' > "$out"
exit 0
EOF
chmod +x "$work/bin/codex"

read -r -d '' prompt <<'EOF'
/cc-crew:chief-engineer A design is settled and needs its plan. This is a trial in a scratch folder, so three limits hold: nothing can be published from here, so stop once the page script has written the page file and tell me what you would publish and what my approval would start; start no builder; and do not ask me anything, I am not here to answer. The reviewer in this folder is a stand-in that finds no blocker: take its answer as the review. Use the plan skill and follow it to that point, the review included.

The design, settled with me in a small grilling today (I said yes to each point). Plan name: nightly-backup-prune.

Principle, approved: "The tool deletes an archive only when the keep rule does not keep it and the bucket was listed in full."

What it is for: scripts/backup.sh writes one dated archive per night to s3://acme-backups/db/. There are 412 of them, the oldest 14 months old. A small tool will delete the old ones every night with nobody watching.

Term I agreed to: "keep rule" (coined in the grilling): which archives stay, namely the last 30 daily ones and the first of each month before that.

Decisions, each mine on your recommendation:
1. It touches only the dated archives under db/. Why: backup.sh writes nothing else there, and three hand-made files sit in the bucket's root.
2. A delete can be undone for 30 days through the bucket's versioning, so the tool adds no trash folder. Why: versioning is already on.
3. No step waits for a person. Why: nobody is watching at night.
4. An archive's age is the date in its name, not its upload time. Why: an upload time changes whenever a file is copied.
5. The nightly job runs in the CI scheduler we already use. Why: its logs are easy to find.
6. Dry run is the default at a terminal, and the scheduled job passes --apply. Why: a plain command typed by hand must never delete.
7. The keep rule's two numbers live in a settings file. Why: the auditors may ask for more than one archive a month.
8. A listing that fails or comes back partial deletes nothing. Why: the rule would otherwise see fewer archives than exist and delete the newest it does see.
9. A run that deletes more than 100 archives posts one line to Slack. Why: the first run deletes 369, and a later large delete would mean something is wrong.
EOF

cd "$work/repo" || exit 1
git init -q . && git add -A && git -c user.name=trial -c user.email=trial@example.invalid commit -q -m "backup script" || true
start=$(date +%s)
PATH="$work/bin:$PATH" CC_CREW_PLANS="$work/plans" claude -p --model fable --plugin-dir "$plugin" \
  --setting-sources project,local --permission-mode acceptEdits --add-dir "$work/plans" \
  --allowedTools Read Edit Write Grep Glob Skill \
    "Bash(mkdir *)" "Bash(ls *)" "Bash(date *)" "Bash(cat *)" "Bash(cp *)" "Bash(echo *)" "Bash(wc *)" "Bash(head *)" \
    "Bash(python3 *plans.py *)" "Bash(python3 \"*plans.py\" *)" "Bash(python3 *page.py *)" "Bash(python3 \"*page.py\" *)" \
    "Bash(*review.sh *)" "Bash(\"*review.sh\" *)" "Bash(python3 *cut_briefs.py *)" "Bash(python3 \"*cut_briefs.py\" *)" \
  --output-format stream-json --verbose "$prompt" > "$work/out.jsonl" 2> "$work/err.txt" < /dev/null
rc=$?
secs=$(( $(date +%s) - start ))

cp "$work/out.jsonl" "$work/err.txt" "$result/" || exit 1
cp -R "$work/plans" "$result/plans" || exit 1
python3 -I - "$work/out.jsonl" > "$result/summary.txt" <<'PY'
import json, sys
tools, denials, final, cost, turns = {}, [], "", None, None
for line in open(sys.argv[1], errors="ignore"):
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if not isinstance(d, dict):
        continue
    msg = d.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    for b in content if isinstance(content, list) else []:
        if isinstance(b, dict) and b.get("type") == "tool_use":
            name = b.get("name")
            tools[name] = tools.get(name, 0) + 1
            if name == "Bash":
                print("BASH:", b.get("input", {}).get("command", "")[:230].replace("\n", " "))
            if name == "Skill":
                print("SKILL:", b.get("input", {}).get("skill"))
    if d.get("type") == "result":
        final = d.get("result") or ""
        cost, turns = d.get("total_cost_usd"), d.get("num_turns")
        denials = d.get("permission_denials") or []
print("TOOLS:", tools)
print("TURNS:", turns, "COST_USD_EQUIVALENT:", cost)
for pd in denials:
    print("DENIED:", json.dumps(pd)[:260])
print("FINAL REPLY:\n" + final)
PY
{
  echo "exit code: $rc; seconds: $secs; work folder: $work"
  echo "files under plans/:"; (cd "$result/plans" && find . -type f | sort)
} >> "$result/summary.txt"
echo "trial finished: exit $rc, $secs seconds; see $result/summary.txt"
exit "$rc"
