#!/usr/bin/env bash
# Offline checks for the grilling's record.py: start writes the skeleton under
# $CC_CREW_PLANS (or ~/.claude/plans), holds it for the session, refuses a name that does
# not fit and leaves an existing record untouched; check
# refuses each failure it knows by line, prints its four lines in order, and reads
# nothing outside the Terms, Decisions, Open and Set aside sections.
set -u
here=$(cd "$(dirname "$0")" && pwd)
record="$here/../skills/grilling/scripts/record.py"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/grilling-test.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CC_CREW_PLANS="$tmp/plans" CLAUDE_CODE_SESSION_ID=sess-g LC_ALL=C
mkdir -p "$HOME" "$tmp/work"
cd "$tmp/work" || exit 1
reminder='Before this round goes out, print "New words:" with each term in it that the user has not used or agreed to, or "New words: none". Agreed so far: the words above, and the words of the repo'"'"'s glossary when it has one.'

# run <args...>: sets rc, out (stdout), err (stderr), last (stdout's last line).
run() {
  python3 "$record" "$@" > "$tmp/stdout" 2> "$tmp/stderr"; rc=$?
  out=$(cat "$tmp/stdout"); err=$(cat "$tmp/stderr"); last=$(tail -n 1 "$tmp/stdout")
}
# write <file>: the record from stdin.
write() { cat > "$1"; }

echo "--- start: a fresh record"
run start kettle "Tea for the office, & nothing / else."
file="$tmp/plans/kettle/plan.md"
check "start exits 0" '[ "$rc" -eq 0 ]'
check "last line is the file's path" '[ "$last" = "$file" ] && [ -f "$file" ]'
cat > "$tmp/expected.md" <<EOF
# kettle

Phase: grilling.
Repository: $tmp/work
Held by: sess-g

## Principle

Not proposed yet.

## What this is for

Tea for the office, & nothing / else.

## Example

## What I checked

## Terms

## Decisions

## Open

## Set aside
EOF
check "the skeleton is exact" 'cmp -s "$file" "$tmp/expected.md"'
check "start holds the record: the session carries its name" '[ "$(cat "$HOME/.claude/.cc-autotitle/held/sess-g")" = kettle ]'
check "a fresh record is checked too" 'printf "%s\n" "$out" | head -n 1 | grep -qxF "0 settled · 0 open · 0 waiting · 0 set aside" && printf "%s\n" "$out" | grep -qxF "Next question: Q1"'
run start kettle words passed unquoted
check "the subject may come as several words" '[ "$rc" -eq 0 ] && [ "$last" = "$file" ]'
check "nothing written by a second start" 'cmp -s "$file" "$tmp/expected.md"'

echo "--- start: an existing record is left alone and checked"
write "$file" <<'EOF'
# kettle

Phase: grilling.

## Decisions

- **Q1. Colour.** Blue, by the user. Why: it matches the office.
EOF
cp "$file" "$tmp/before.md"
run start kettle "Another subject"
check "an existing record exits 0" '[ "$rc" -eq 0 ]'
check "an existing record is untouched" 'cmp -s "$file" "$tmp/before.md"'
check "its check runs, then the path" 'printf "%s\n" "$out" | head -n 1 | grep -qxF "1 settled · 0 open · 0 waiting · 0 set aside" && [ "$last" = "$file" ]'
printf '## Decisions\n\n- **Q1. Colour.** Blue.\n' >> "$file"; cp "$file" "$tmp/before.md"
run start kettle "Another subject"
check "an existing refused record exits 1, still ends with the path, untouched" '[ "$rc" -eq 1 ] && [ "$last" = "$file" ] && printf "%s" "$err" | grep -q "line 10: decision has no" && cmp -s "$file" "$tmp/before.md"'

echo "--- start: the name rule, and no session"
run start Big_Kettle "Tea."
check "a name that does not fit is refused before anything is created" '[ "$rc" -eq 1 ] && printf "%s" "$err" | grep -q "kebab-case" && [ ! -e "$tmp/plans/Big_Kettle" ]'
run start "$(printf 'k%.0s' $(seq 41))" "Tea."
check "a name over 40 characters is refused" '[ "$rc" -eq 1 ]'
CLAUDE_CODE_SESSION_ID= run start mug "Coffee."
check "with no session the record is written, named for its repository and held by no session" '[ "$rc" -eq 0 ] && grep -qxF "Repository: $tmp/work" "$last" && ! grep -q "^Held by:" "$last" && printf "%s" "$err" | grep -q "held by no session"'

echo "--- start: ~/.claude/plans without CC_CREW_PLANS"
CC_CREW_PLANS= run start teapot "Pour."
check "default plans folder is ~/.claude/plans" '[ "$rc" -eq 0 ] && [ "$last" = "$HOME/.claude/plans/teapot/plan.md" ] && [ -f "$last" ]'

echo "--- check: a sound record, every printed line"
rec="$tmp/record.md"
write "$rec" <<'EOF'
# kettle

Phase: grilling.

## Principle

The kettle boils water and nothing else.

## Terms

- **boil** (the user's own word): water at 100 C. Agreed by the user on 2026-11-15.
- **whistle** (from the old kettle (the red one)): the sound at the boil. Agreed by the user on 2026-11-15. For the glossary.
- **spout** (proposed in round 2): where water leaves.

## Decisions

- **Q1. Colour.** Blue, by the user. Why: it matches the office.
- **Q2. Power.** 2 kW, by the chief engineer.
  Why: the office circuit takes no more.
- **Handle.** Wood, by the user. Why: it stays cool.

## Open

- **Q3. Lid.** Hinged or loose.
- **Q4. Light.** On while it heats. Waits on Q3.
- **Q5. Timer.** A delay. Waits on Q3, Q4.

## Set aside

- A gas model, maybe one day after Q9.

## Work

- **Q1. Duplicate in a section check never reads.** No reason here.
- **Q99. A term-like line** with no shape at all.

## Every brief

- **word** with no source.
EOF
cp "$rec" "$tmp/before.md"
run check "$rec"
check "a sound record exits 0" '[ "$rc" -eq 0 ] && [ -z "$err" ]'
check "exactly four lines" '[ "$(printf "%s\n" "$out" | wc -l | tr -d " ")" -eq 4 ]'
check "line 1: the count, waiting apart from open" '[ "$(printf "%s\n" "$out" | sed -n 1p)" = "3 settled · 1 open · 2 waiting · 1 set aside" ]'
check "line 2: next question after every Q<n> the four sections name, none from other sections" '[ "$(printf "%s\n" "$out" | sed -n 2p)" = "Next question: Q10" ]'
check "line 3: only words agreed by the user, in order" '[ "$(printf "%s\n" "$out" | sed -n 3p)" = "Agreed words: boil, whistle" ]'
check "line 4: the reminder, word for word" '[ "$(printf "%s\n" "$out" | sed -n 4p)" = "$reminder" ]'
check "check never writes the record" 'cmp -s "$rec" "$tmp/before.md"'

echo "--- check: no agreed word yet"
printf '# x\n\nPhase: grilling.\n\n## Open\n\n- **Q2. Lid.** Hinged.\n' > "$rec"
run check "$rec"
check "Agreed words: none yet" '[ "$rc" -eq 0 ] && printf "%s\n" "$out" | grep -qxF "Agreed words: none yet" && printf "%s\n" "$out" | grep -qxF "Next question: Q3"'

echo "--- check: each refusal, named by line"
write "$rec" <<'EOF'
# x

Phase: grilling.

## Terms

- **boil**: water at 100 C. Agreed by the user on 2026-11-15.
- **steam** (): vapour. Agreed by the user on 2026-11-15.
- **lid** (round 1): Agreed by the user on 2026-11-15.
- **base** (round 1): the plate.

## Decisions

- **Q1. Colour.** Blue, by the user.
- **Q2. Power.** 2 kW. Why:
- **Q3. Size.** One litre. Why: .

## Open

- **Q2. Power again.** Asked twice.
EOF
run check "$rec"
check "a refused record exits 1 and prints no summary" '[ "$rc" -eq 1 ] && [ -z "$out" ]'
check "term with no source" 'printf "%s" "$err" | grep -q "line 7: term has no (<where it comes from>)"'
check "term with an empty source" 'printf "%s" "$err" | grep -q "line 8: term has no (<where it comes from>)"'
check "term with no meaning" 'printf "%s" "$err" | grep -q "line 9: term has no meaning"'
check "a sound term is not refused" '! printf "%s" "$err" | grep -q "line 10:"'
check "decision with no Why" 'printf "%s" "$err" | grep -q "line 14: decision has no \"Why:\""'
check "decision with nothing after Why" 'printf "%s" "$err" | grep -q "line 15: decision has nothing after \"Why:\"" && printf "%s" "$err" | grep -q "line 16: decision has nothing after \"Why:\""'
check "a question number used twice names both lines" 'printf "%s" "$err" | grep -q "line 15: Q2 appears more than once (lines 15, 20)" && printf "%s" "$err" | grep -q "line 20: Q2 appears more than once"'
check "a question that waits on a word counts as waiting" 'printf "## Open\n\n- **Q1. A.** x. Waits on the word \"keep rule\".\n- **Q2. B.** y.\n" > "$tmp/ww.md" && python3 "$record" check "$tmp/ww.md" 2>/dev/null | head -n 1 | grep -qxF "0 settled · 1 open · 1 waiting · 0 set aside"'
check "Waits on Q<n> is not a second use" 'printf "## Open\n\n- **Q1. A.** x.\n- **Q2. B.** y. Waits on Q1.\n" > "$tmp/w.md" && python3 "$record" check "$tmp/w.md" >/dev/null 2>&1'

echo "--- check: fences and later sections are never read"
write "$rec" <<'EOF'
# x

Phase: grilling.

## Decisions

- **Q1. Colour.** Blue. Why: it matches.

```
- **Q1. Fenced.** No reason.
## Open
- **Q1. Fenced open.** Twice.
```

## Every brief

- **Q1. Again.** No reason.

## Work

- **term** no source.
EOF
run check "$rec"
check "fenced items and other sections pass" '[ "$rc" -eq 0 ] && printf "%s\n" "$out" | head -n 1 | grep -qxF "1 settled · 0 open · 0 waiting · 0 set aside" && printf "%s\n" "$out" | grep -qxF "Next question: Q2"'

echo "--- usage"
run check "$tmp/missing.md"
check "an unreadable file exits 2" '[ "$rc" -eq 2 ]'
echo "--- check: the session's name follows the record it edited by hand"
held="$HOME/.claude/.cc-autotitle/held/sess-g"
run start mug-first "The first of two records one session holds."
run start mug-second "The second, started later."
check "the name is the record started last" '[ "$(cat "$held")" = mug-second ]'
# A hand edit, as a grilling round makes it; a later timestamp stands in for the wait between rounds.
printf '\n- A point set aside.\n' >> "$tmp/plans/mug-first/plan.md"
touch -t 203001010000 "$tmp/plans/mug-first/plan.md"
run check "$tmp/plans/mug-first/plan.md"
check "after check, the name is the record edited by hand" '[ "$rc" -eq 0 ] && [ "$(cat "$held")" = mug-first ]'

run start onlyname
check "start without a subject exits 2" '[ "$rc" -eq 2 ] && printf "%s" "$err" | grep -q "^usage:"'
run
check "no command exits 2" '[ "$rc" -eq 2 ]'

if [ "$fail" -ne 0 ]; then echo "test-grilling: FAILED"; exit 1; fi
echo "test-grilling: all passed"
exit 0
