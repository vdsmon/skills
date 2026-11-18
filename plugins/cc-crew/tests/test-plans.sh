#!/usr/bin/env bash
# Offline checks for plans.py: the commands that write a plan file's first lines and its
# Progress section, the held-name files they derive, and the report and badge that read
# every plan without ever failing on one.
set -u
here=$(cd "$(dirname "$0")" && pwd)
plans="$here/../scripts/plans.py"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/plans-test.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CC_CREW_PLANS="$tmp/plans" CLAUDE_CODE_SESSION_ID=sess-a LC_ALL=C
unset GIT_DIR GIT_WORK_TREE
mkdir -p "$HOME" "$CC_CREW_PLANS" "$tmp/work"
cd "$tmp/work" || exit 1
held="$HOME/.claude/.cc-autotitle/held"

# run <args...>: sets rc, out (stdout), err (stderr).
run() {
  python3 "$plans" "$@" > "$tmp/stdout" 2> "$tmp/stderr"; rc=$?
  out=$(cat "$tmp/stdout"); err=$(cat "$tmp/stderr")
}
has() { printf '%s\n' "$1" | grep -qxF -- "$2"; }
# plan <name>: a plan written before this script, from stdin.
plan() { mkdir -p "$CC_CREW_PLANS/$1"; cat > "$CC_CREW_PLANS/$1/plan.md"; }
f="$CC_CREW_PLANS/kettle/plan.md"

plan kettle <<'EOF'
# kettle

Status: the old sentence, which nothing reads.

## Principle

The kettle boils water.

```
## Progress
- Work item 9: done.
### Work item 9 Fenced, never counted
Phase: done.
```

## Work

### Work item 1 The body

### Work item 2 The lid
EOF

echo "--- hold"
run hold "$f"
check "hold exits 0" '[ "$rc" -eq 0 ]'
check "Repository and Held by go under the title, before the old Status line" '[ "$(sed -n 2,5p "$f")" = "
Repository: $tmp/work
Held by: sess-a
Status: the old sentence, which nothing reads." ]'
check "the held-name file carries the plan's name" '[ "$(cat "$held/sess-a")" = kettle ]'
run hold "$f"
check "a second hold changes nothing" '[ "$(grep -c "^Held by:" "$f")" -eq 1 ] && [ "$(grep -c "^Repository:" "$f")" -eq 1 ]'
plan Bad_Name <<'EOF'
# Bad_Name

Phase: grilling.
EOF
cp "$CC_CREW_PLANS/Bad_Name/plan.md" "$tmp/before.md"
run hold "$CC_CREW_PLANS/Bad_Name/plan.md"
check "a name that does not fit is refused, naming the rule" '[ "$rc" -eq 1 ] && printf "%s" "$err" | grep -q "kebab-case (lowercase letters, digits and hyphens), at most 40 characters" && cmp -s "$tmp/before.md" "$CC_CREW_PLANS/Bad_Name/plan.md"'
rm -rf "$CC_CREW_PLANS/Bad_Name"
CLAUDE_CODE_SESSION_ID= run hold "$f"
check "hold without a session exits 2" '[ "$rc" -eq 2 ] && printf "%s" "$err" | grep -q "CLAUDE_CODE_SESSION_ID"'

echo "--- phase"
run phase "$f" awaiting approval The page went out.
check "a two-word phase as separate words, with its sentence" '[ "$rc" -eq 0 ] && grep -qxF "Phase: awaiting approval. The page went out." "$f"'
check "Phase goes after the other first lines" '[ "$(sed -n 5p "$f")" = "Phase: awaiting approval. The page went out." ]'
run phase "$f" "building"
check "a quoted phase with no sentence" '[ "$rc" -eq 0 ] && grep -qxF "Phase: building." "$f" && [ "$(grep -c "^Phase:" "$f")" -eq 2 ]'
run phase "$f" done
check "done goes through close" '[ "$rc" -eq 1 ] && printf "%s" "$err" | grep -q "plans.py close"'
run phase "$f" dropped
check "dropped goes through close" '[ "$rc" -eq 1 ]'
run phase "$f" boiling
check "an unknown phase exits 2" '[ "$rc" -eq 2 ]'

echo "--- progress and item"
run progress "$f"
check "progress exits 0" '[ "$rc" -eq 0 ]'
check "one line per work item heading, none from the fence, before the section that holds them" '[ "$(awk "/^## Progress\$/ { n++ } n == 2" "$f" | sed "/^## Work\$/q")" = "## Progress

- Work item 1: not started.
- Work item 2: not started.

## Work" ]'
run item "$f" 1 under way the body is cast
check "item with a two-word state and a note" '[ "$rc" -eq 0 ] && grep -qxF -- "- Work item 1: under way. the body is cast" "$f"'
printf '\n### Work item 3 The whistle\n' >> "$f"
run progress "$f"
check "progress again adds the new work item and keeps the states" 'grep -qxF -- "- Work item 1: under way. the body is cast" "$f" && grep -qxF -- "- Work item 3: not started." "$f" && [ "$(grep -c "^- Work item [1-3]:" "$f")" -eq 3 ]'
run item "$f" 7 done
check "item for a work item with no line is refused" '[ "$rc" -eq 1 ]'
run item "$f" 2 "not started" "nothing yet."
check "a quoted state" 'grep -qxF -- "- Work item 2: not started. nothing yet." "$f"'
run item "$f" 2 finished
check "an unknown state exits 2" '[ "$rc" -eq 2 ]'

plan cup <<'EOF'
# cup
## Progress

## Work

### Work item 1 Only
EOF
run phase "$CC_CREW_PLANS/cup/plan.md" grilling
run progress "$CC_CREW_PLANS/cup/plan.md"
check "a title with no blank line and an empty Progress section from a template" '[ "$(cat "$CC_CREW_PLANS/cup/plan.md")" = "# cup

Phase: grilling.

## Progress

- Work item 1: not started.

## Work

### Work item 1 Only" ]'
rm -rf "$CC_CREW_PLANS/cup"

echo "--- wait and go"
run wait "$f" "Victor: the merge of #121"
check "wait sets the line" '[ "$rc" -eq 0 ] && grep -qxF "Waiting on: Victor: the merge of #121" "$f"'
run wait "$f" nobody
check "wait without a colon exits 2" '[ "$rc" -eq 2 ]'

echo "--- nothing else in the file changed"
cat > "$tmp/expected.md" <<EOF
# kettle

Repository: $tmp/work
Held by: sess-a
Phase: building.
Waiting on: Victor: the merge of #121
Status: the old sentence, which nothing reads.

## Principle

The kettle boils water.

\`\`\`
## Progress
- Work item 9: done.
### Work item 9 Fenced, never counted
Phase: done.
\`\`\`

## Progress

- Work item 1: under way. the body is cast
- Work item 2: not started. nothing yet.
- Work item 3: not started.

## Work

### Work item 1 The body

### Work item 2 The lid

### Work item 3 The whistle
EOF
check "the whole file is as expected" 'cmp -s "$f" "$tmp/expected.md" || diff "$tmp/expected.md" "$f"'

echo "--- report and badge"
run report
check "report: this repository's plan, its work items, its wait and its holder" '[ "$out" = "<cc-crew-plans>
Plans under way in $tmp/work:
- kettle · building · 0 of 3 done · waiting on Victor: the merge of #121 · held by this session
</cc-crew-plans>" ]'
run badge sess-a
check "badge: name, phase, counts, and what waits on Victor" '[ "$out" = " · kettle · 🔨 0/3 · ✋ the merge of #121" ] && [ "$rc" -eq 0 ]'
run wait "$f" "Victor: his word on the spout, the lid and the handle"
check "a long what-for is refused, so the status line shows it whole" '[ "$rc" -eq 2 ] && grep -qxF "Waiting on: Victor: the merge of #121" "$f"'
answered() { # kind of entry, its time
  if [ "$1" = typed ]; then printf '{"type":"user","origin":{"kind":"human"},"timestamp":"%s","message":{"role":"user","content":"yes"}}\n' "$2"
  else printf '{"type":"user","timestamp":"%s","message":{"role":"user","content":[{"type":"tool_result"}]},"toolUseResult":{"answers":{"q":"a"}}}\n' "$2"; fi
}
{ answered typed 2020-01-01T00:00:00.000Z; printf '{"type":"user","origin":{"kind":"task-notification"},"timestamp":"2999-01-01T00:00:00.000Z"}\n'; } > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "a wait set after Victor last spoke shows, whatever else came later" 'printf "%s" "$out" | grep -q "✋"'
answered typed 2999-01-01T00:00:00.000Z > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "a typed prompt after the wait hides it, and the turn is under way" '[ "$out" = " · kettle · 🔨 0/3 · ⚙ thinking" ]'
answered asked 2999-01-01T00:00:00.000Z > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "an answered question after the wait hides it" '[ "$out" = " · kettle · 🔨 0/3 · ⚙ thinking" ]'
{ answered typed 2999-01-01T00:00:00.000Z; printf '{"type":"system","subtype":"turn_duration"}\n'; } > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "an answered wait and a finished turn with nothing out: idle" '[ "$out" = " · kettle · 🔨 0/3 · 💤 idle" ]'
{ printf '{"type":"custom-title","customTitle":"kettle","sessionId":"sess-a"}\n'; answered typed 2020-01-01T00:00:00.000Z; } > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "a session named after the plan leaves the name out" '[ "$out" = " · 🔨 0/3 · ✋ the merge of #121" ]'
printf '{"type":"custom-title","customTitle":"kettle"}\n{"type":"custom-title","customTitle":"teapot"}\n' > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "the session's latest name counts" 'printf "%s" "$out" | grep -q "^ · kettle · "'
run wait "$f" teapot: its merge first
printf '{"type":"assistant","message":{"stop_reason":"end_turn"}}\n' > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "a finished turn shows a wait on someone else" '[ "$out" = " · kettle · 🔨 0/3 · ⏳ teapot: its merge first" ]'
printf '{"type":"assistant","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","name":"Bash"}]}}\n' > "$tmp/t.jsonl"
run badge sess-a "$tmp/t.jsonl"
check "a turn under way shows what it runs over a wait on someone else" '[ "$out" = " · kettle · 🔨 0/3 · ⚙ shell" ]'
run badge sess-a
check "a wait on someone else is not on the badge" '[ "$out" = " · kettle · 🔨 0/3" ]'
run go "$f"
check "go removes the line" '[ "$rc" -eq 0 ] && ! grep -q "^Waiting on:" "$f"'
run go "$f"
check "go with nothing to remove exits 0" '[ "$rc" -eq 0 ]'
run badge nobody
check "badge for a session that holds nothing prints nothing" '[ -z "$out" ] && [ "$rc" -eq 0 ]'

# Plans of other sessions and repositories, and files that are not readable.
plan teapot <<EOF
# teapot

Phase: grilling. Round two.
Repository: $tmp/work
Held by: sess-b
Page: https://claude.ai/artifact/teapot
EOF
plan mug <<EOF
# mug

Phase: building.
Repository: $tmp/work
Held by: 0123456789abcdef
EOF
plan saucer <<EOF
# saucer

Phase: awaiting approval.
Repository: $tmp/work
EOF
plan spoon <<'EOF'
# spoon

Phase: building.
Repository: /somewhere/else
Held by: sess-c
EOF
plan fork <<'EOF'
# fork

Phase: grilling.
Repository: /another/place
EOF
plan tray <<EOF
# tray

Phase: done. Merged.
Repository: $tmp/work
EOF
plan oldone <<'EOF'
# oldone

Status: approved by Victor.
EOF
plan oddone <<EOF
# oddone

Phase: simmering.
Repository: $tmp/work
EOF
mkdir -p "$CC_CREW_PLANS/broken" && printf '# broken\n\nPhase: \xff\xfe.\n' > "$CC_CREW_PLANS/broken/plan.md"
mkdir -p "$HOME/.claude/projects/-x"
printf '{"type":"custom-title","customTitle":"old-name","sessionId":"sess-b"}\n{"type":"user"}\n{"type":"custom-title","customTitle":"teapot","sessionId":"sess-b"}\n{"type":"assistant"}\n' > "$HOME/.claude/projects/-x/sess-b.jsonl"
touch -t "$(date -v-3H -v-5M +%Y%m%d%H%M.%S)" "$HOME/.claude/projects/-x/sess-b.jsonl"
cp -R "$CC_CREW_PLANS" "$tmp/plans-before"
run report
check "report: every case in one" '[ "$out" = "<cc-crew-plans>
Plans under way in $tmp/work:
- kettle · building · 0 of 3 done · held by this session
- mug · building · held by another session (01234567)
- saucer · awaiting approval · held by no session
- teapot · grilling · held by another session (\"teapot\", last wrote 3 h ago) · https://claude.ai/artifact/teapot
2 plans under way in other repositories.
Not readable (Phase line not one of the five): oddone.
Not readable (cannot be read): broken.
Not readable (no Phase line): oldone.
</cc-crew-plans>" ] && [ "$rc" -eq 0 ]'
check "report and badge never write a plan file" 'python3 "$plans" badge sess-a >/dev/null && diff -r "$tmp/plans-before" "$CC_CREW_PLANS" >/dev/null'
mkdir -p "$tmp/elsewhere"
out=$(cd "$tmp/elsewhere" && python3 "$plans" report --session sess-a)
check "another repository: nothing under way here, the others counted, the unreadable listed" '[ "$(printf "%s\n" "$out" | sed -n 2,3p)" = "No plan under way in $tmp/elsewhere.
6 plans under way in other repositories." ] && printf "%s\n" "$out" | grep -qxF "Not readable (no Phase line): oldone."'
out=$(cd "$tmp/elsewhere" && python3 "$plans" report --session sess-a | sed -n 2p; cd "$tmp/work" && CLAUDE_CODE_SESSION_ID= python3 "$plans" report --session sess-b | grep teapot)
check "--session names the session" 'printf "%s\n" "$out" | grep -q "teapot · grilling · held by this session"'

echo "--- repository is git's main folder, from any worktree"
if command -v git >/dev/null; then
  git init -q "$tmp/repo" && git -C "$tmp/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  git -C "$tmp/repo" worktree add -q "$tmp/repo-wt" -b side 2>/dev/null
  plan pot <<'EOF'
# pot

Phase: grilling.
EOF
  (cd "$tmp/repo-wt/" && python3 "$plans" hold "$CC_CREW_PLANS/pot/plan.md" >/dev/null)
  check "hold from a worktree names the main checkout" 'grep -qxF "Repository: $tmp/repo" "$CC_CREW_PLANS/pot/plan.md"'
  out=$(cd "$tmp/repo" && python3 "$plans" report)
  check "report in the main checkout lists it" 'printf "%s\n" "$out" | grep -qxF -- "- pot · grilling · held by this session"'
  (cd "$tmp/work" && python3 "$plans" hold "$CC_CREW_PLANS/pot/plan.md" --session sess-taker >/dev/null)
  check "taking a plan over from another folder keeps its repository" 'grep -qxF "Repository: $tmp/repo" "$CC_CREW_PLANS/pot/plan.md" && grep -qxF "Held by: sess-taker" "$CC_CREW_PLANS/pot/plan.md"'
  (cd "$tmp/work" && python3 "$plans" hold "$CC_CREW_PLANS/pot/plan.md" >/dev/null)  # back to the session the next checks use
  # Two submodules of one repository share the folder above their git data; each is its own repository.
  git init -q "$tmp/sup" && git -C "$tmp/sup" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  for sub in api web; do
    git -C "$tmp/sup" -c protocol.file.allow=always submodule add -q "$tmp/repo" "$sub" 2>/dev/null
    plan "pan-$sub" <<'EOF'
# pan

Phase: grilling.
EOF
    (cd "$tmp/sup/$sub" && python3 "$plans" hold "$CC_CREW_PLANS/pan-$sub/plan.md" --session sess-sub >/dev/null)
  done
  out=$(cd "$tmp/sup/api" && python3 "$plans" report --session sess-sub)
  check "two submodules of one repository are two repositories" 'printf "%s\n" "$out" | grep -qxF -- "- pan-api · grilling · held by this session" && ! printf "%s\n" "$out" | grep -q "pan-web" && printf "%s\n" "$out" | grep -q "in another repository\|in other repositories"'
fi

echo "--- held names: the plan written to last, takeovers"
touch -t 202601010000 "$CC_CREW_PLANS/pot/plan.md" 2>/dev/null
run item "$f" 1 under way
check "after a write the session carries the plan it wrote to last" '[ "$(cat "$held/sess-a")" = kettle ]'
run badge sess-a
check "the badge shows the same plan" '[ "$out" = " · kettle · 🔨 0/3" ]'
[ -f "$CC_CREW_PLANS/pot/plan.md" ] && {
  run phase "$CC_CREW_PLANS/pot/plan.md" building
  check "writing another held plan moves the name to it" '[ "$(cat "$held/sess-a")" = pot ] && [ "$(python3 "$plans" badge sess-a)" = " · pot · 🔨" ]'
  CLAUDE_CODE_SESSION_ID=sess-z run hold "$CC_CREW_PLANS/pot/plan.md"
  check "a takeover: the new holder carries the name, the old holder goes back to its other plan" '[ "$rc" -eq 0 ] && [ "$(cat "$held/sess-z")" = pot ] && [ "$(cat "$held/sess-a")" = kettle ] && printf "%s" "$out" | grep -q "taken over from sess-a"'
}
printf 'teapot\n' > "$held/sess-b"
CLAUDE_CODE_SESSION_ID=sess-z run hold "$CC_CREW_PLANS/teapot/plan.md"
check "sess-b holds nothing after its plan is taken over: no held-name file" '[ ! -e "$held/sess-b" ]'

echo "--- close"
run wait "$f" Victor: the merge
run close "$f" done Merged.
check "close refuses, naming each reason" '[ "$rc" -eq 1 ] && printf "%s" "$err" | grep -q "waits on Victor: the merge" && printf "%s" "$err" | grep -q "work item 1 is under way" && printf "%s" "$err" | grep -q "work item 2 is not started" && printf "%s" "$err" | grep -q "work item 3 is not started"'
check "a refused close leaves the plan held" 'grep -q "^Held by: sess-a" "$f"'
run go "$f"; run item "$f" 1 done; run item "$f" 2 done
printf '\n### Work item 4 The cord\n' >> "$f"
run item "$f" 3 done
run close "$f" done Merged.
check "a work item with no Progress line keeps the plan from done" '[ "$rc" -eq 1 ] && printf "%s" "$err" | grep -q "work item 4 has no Progress line"'
run progress "$f"; run item "$f" 4 done
mkdir -p "$CC_CREW_PLANS/kettle/reviews/plan-1.a" "$CC_CREW_PLANS/kettle/reviews/plan-2.b" "$CC_CREW_PLANS/kettle/reviews/diff-1.c" "$CC_CREW_PLANS/kettle/reviews/diff-2.d" "$CC_CREW_PLANS/kettle/reviews/grilling-1.e"
touch "$CC_CREW_PLANS/kettle/reviews/plan-1.a/answer.md" "$CC_CREW_PLANS/kettle/reviews/plan-2.b/answer.md" "$CC_CREW_PLANS/kettle/reviews/diff-1.c/answer.md" "$CC_CREW_PLANS/kettle/reviews/grilling-1.e/answer.md"
CLAUDE_CODE_SESSION_ID=sess-a run phase "$CC_CREW_PLANS/mug/plan.md" building
sed -i '' 's/^Held by: 0123456789abcdef$/Held by: sess-a/' "$CC_CREW_PLANS/mug/plan.md"
touch -t 202601010000 "$CC_CREW_PLANS/mug/plan.md"
run close "$f" done Merged as pull request 9.
check "close exits 0" '[ "$rc" -eq 0 ]'
check "the phase and its sentence are set, Held by is gone" 'grep -qxF "Phase: done. Merged as pull request 9." "$f" && ! grep -q "^Held by:" "$f"'
check "the stamp counts work items and reviewer reads with an answer" 'has "$out" "Stamp: 4 work items; 3 reviewer reads (2 of the plan, 1 of the diff)."'
check "the reminder asks for a visible line each" 'for w in "- Decisions:" "- The builders'"'"' suggestions:" "- Worktrees and branches:" "- The page:" "- Left for Victor:"; do printf "%s\n" "$out" | grep -qF -- "$w" || exit 1; done'
check "done says nothing about unmerged branches" '! printf "%s" "$out" | grep -q "Unmerged"'
check "the session now carries the other plan it holds" '[ "$(cat "$held/sess-a")" = mug ]'
run report
check "a done plan leaves the report" '! printf "%s" "$out" | grep -q "kettle"'
run close "$CC_CREW_PLANS/mug/plan.md" dropped Victor chose another design.
check "dropped needs no work item done and keeps unmerged work" '[ "$rc" -eq 0 ] && grep -qxF "Phase: dropped. Victor chose another design." "$CC_CREW_PLANS/mug/plan.md" && printf "%s" "$out" | grep -q "Unmerged branches and worktrees stay until Victor says to delete them."'
check "a session that holds nothing loses its held-name file" '[ ! -e "$held/sess-a" ] && [ -z "$(python3 "$plans" badge sess-a)" ]'
run close "$f" done
check "close without a sentence exits 2" '[ "$rc" -eq 2 ]'

echo "--- a work item taken out of the plan"
plan cup <<'EOF'
# cup

Phase: building.

## Work

### Work item 1 Handle (builder)

### Work item 2 Saucer (builder)
EOF
c="$CC_CREW_PLANS/cup/plan.md"
run progress "$c"
run item "$c" 1 done
grep -v '^### Work item 2' "$c" > "$tmp/cup.md" && cp "$tmp/cup.md" "$c"
cp "$c" "$tmp/cup-stale.md"
run progress "$c"
check "progress run again drops the line of a work item taken out, and says so" '[ "$rc" -eq 0 ] && ! grep -q "^- Work item 2:" "$c" && printf "%s" "$out" | grep -q "removed: 2"'
cp "$tmp/cup-stale.md" "$c"
run close "$c" done "Shipped."
check "a line left from a work item taken out does not hold the close" '[ "$rc" -eq 0 ] && grep -qxF "Phase: done. Shipped." "$c" && printf "%s" "$out" | grep -q "^Stamp: 1 work items"'

echo "--- usage"
run
check "no command exits 2" '[ "$rc" -eq 2 ]'
run phase "$tmp/missing.md" building
check "a missing file exits 2" '[ "$rc" -eq 2 ] && printf "%s" "$err" | grep -q "cannot read"'
CC_CREW_PLANS="$tmp/none" run report
check "report with no plans folder" '[ "$rc" -eq 0 ] && has "$out" "No plan under way in $tmp/work."'

if [ "$fail" -ne 0 ]; then echo "test-plans: FAILED"; exit 1; fi
echo "test-plans: all passed"
exit 0
