#!/usr/bin/env bash
# Offline checks for cut_briefs.py: a made-up plan with two builder items and one chief
# engineer item cuts into two briefs, each holding its For, the plan's purpose when it has
# one, the principle, its own fields and the shared section in that order; the plan is never
# written; a plan with no builder item writes no brief and says so; a broken plan writes nothing.
set -u
here=$(cd "$(dirname "$0")" && pwd)
cut="$here/../skills/plan/scripts/cut_briefs.py"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
line_of() { grep -n -F -- "$1" "$2" | head -1 | cut -d: -f1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/plan-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
plan="$tmp/plan.md"
cat > "$plan" <<'EOF'
# Plan: a toy kettle

## Principle

The kettle boils water and nothing else. PRINCIPLE-MARK

## What this is for

Tea for the office. PURPOSE-MARK

## Decisions

- The kettle is blue. DECISION-MARK

## Work

### Work 1 Heater (builder)

- For: the water gets hot. FOR-ONE
- You own: `heater/`. OWN-ONE
- Where: the kettle repo. WHERE-ONE
- Work, in order:
  1. Wire the coil. STEP-ONE-A
  2. Add a thermostat. STEP-ONE-B
- Limits: no gas. LIMITS-ONE
- Done when: water reaches 100 C. DONE-ONE
- Runs with: Work 2.

### Work 2 Whistle (builder)

- For: someone hears the water boil. FOR-TWO
- You own: `whistle/`. OWN-TWO
- Where: the kettle repo. WHERE-TWO
- Work, in order:
  1. Shape the spout. STEP-TWO
- Limits: under 90 dB. LIMITS-TWO
- Done when: it whistles at 100 C. DONE-TWO
- Runs with: Work 1.

### Work 3 Assembly (chief engineer)

- For: one kettle. FOR-THREE
- You own: the case. OWN-THREE

## Every brief

Shared words for every builder. SHARED-MARK

- **Commits.** One per item.

  A second paragraph inside the bullet.
- **No push.** Ever.
EOF
before=$(cksum < "$plan")

out="$tmp/briefs"
msg=$(python3 "$cut" "$plan" "$out"); rc=$?
check "exits 0" '[ $rc -eq 0 ]'
check "two briefs, one per builder item" '[ "$(ls "$out" | tr "\n" " ")" = "work-1.md work-2.md " ]'
check "prints the brief paths" '[ "$(echo "$msg" | wc -l | tr -d " ")" = 2 ]'
check "plan unchanged" '[ "$(cksum < "$plan")" = "$before" ]'

shared="$tmp/shared.md"
awk '/^## Every brief$/{on=1} on' "$plan" > "$shared"
for n in 1 2; do
  b="$out/work-$n.md"
  if [ "$n" = 1 ]; then mine=ONE; other=TWO; else mine=TWO; other=ONE; fi
  check "brief $n: starts with its For" 'head -1 "$b" | grep -q "^- For: .*FOR-$mine$"'
  check "brief $n: holds the principle" 'grep -q "PRINCIPLE-MARK" "$b"'
  for f in OWN WHERE LIMITS DONE; do
    check "brief $n: holds its $f field" 'grep -q "$f-$mine" "$b"'
  done
  check "brief $n: keeps the nested work list" 'grep -q "^  1\. .*STEP-$mine" "$b"'
  check "brief $n: holds Runs with" 'grep -q "^- Runs with: Work" "$b"'
  check "brief $n: For only once" '[ "$(grep -c "FOR-$mine" "$b")" = 1 ]'
  check "brief $n: order For < principle < fields < shared" '[ "$(line_of FOR-$mine "$b")" -lt "$(line_of PRINCIPLE-MARK "$b")" ] && [ "$(line_of PRINCIPLE-MARK "$b")" -lt "$(line_of OWN-$mine "$b")" ] && [ "$(line_of DONE-$mine "$b")" -lt "$(line_of SHARED-MARK "$b")" ]'
  check "brief $n: ends with the shared section word for word" 'tail -n "$(wc -l < "$shared")" "$b" | diff -q - "$shared" >/dev/null'
  check "brief $n: nothing from the other items" '! grep -qE "[A-Z]+-$other|THREE" "$b"'
  check "brief $n: purpose section, heading included, right after For" '[ "$(sed -n "3,5p" "$b")" = "$(printf "## What this is for\n\nTea for the office. PURPOSE-MARK")" ] && [ "$(line_of PURPOSE-MARK "$b")" -lt "$(line_of PRINCIPLE-MARK "$b")" ]'
  check "brief $n: nothing from decisions" '! grep -q "DECISION-MARK" "$b"'
done

awk '/^## What this is for$/{skip=1; next} /^## /{skip=0} !skip' "$plan" > "$tmp/nopurpose.md"
python3 "$cut" "$tmp/nopurpose.md" "$tmp/nopurpose" >/dev/null; rc=$?
check "no purpose section: cuts as before, For then principle" '[ $rc -eq 0 ] && [ "$(sed -n 3p "$tmp/nopurpose/work-1.md")" = "## Principle" ] && ! grep -q "What this is for" "$tmp/nopurpose/work-1.md"'

sed 's/(builder)/(chief engineer)/' "$plan" > "$tmp/nobuilder.md"
msg=$(python3 "$cut" "$tmp/nobuilder.md" "$out"); rc=$?
check "no builder: exits 0" '[ $rc -eq 0 ]'
check "no builder: says so" 'echo "$msg" | grep -q "no builder item"'
check "no builder: no brief left in out-dir" '[ -z "$(ls "$out")" ]'

grep -v "FOR-TWO" "$plan" > "$tmp/nofor.md"
err=$(python3 "$cut" "$tmp/nofor.md" "$tmp/broken" 2>&1); rc=$?
check "builder item without For: exits 1" '[ $rc -eq 1 ]'
check "builder item without For: names the item" 'echo "$err" | grep -q "Work 2 Whistle"'
check "builder item without For: writes nothing" '[ ! -e "$tmp/broken" ]'

grep -v "^## Principle" "$plan" > "$tmp/noprinciple.md"
python3 "$cut" "$tmp/noprinciple.md" "$tmp/broken" 2>/dev/null; rc=$?
check "no principle section: exits 1, writes nothing" '[ $rc -eq 1 ] && [ ! -e "$tmp/broken" ]'

check "plan as out-dir file refused" 'cp "$plan" "$tmp/work-1.md"; ! python3 "$cut" "$tmp/work-1.md" "$tmp" 2>/dev/null && grep -q FOR-ONE "$tmp/work-1.md"'
exit $fail
