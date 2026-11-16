#!/usr/bin/env bash
# Offline checks for page.py on made-up plans: each part appears once under its name; the order
# and the folds follow the phase; the states follow the Progress section; the work's stages follow
# the After fields; a missing piece is a refusal that names it and writes nothing; text from the
# plan reaches the page escaped and whole; a ladder of "None, because" is one line.
set -u
here=$(cd "$(dirname "$0")" && pwd)
page="$here/../skills/plan/scripts/page.py"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/page-test.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
export LC_ALL=C TZ=UTC

# run <plan.md>: sets rc, out, err.
run() { python3 "$page" "$@" > "$tmp/stdout" 2> "$tmp/stderr"; rc=$?; out=$(cat "$tmp/stdout"); err=$(cat "$tmp/stderr"); }
# py <page.html> <python expression over s, the page>: prints the result.
py() { python3 -c "import re,sys; s=open(sys.argv[1]).read(); print($2)" "$1"; }

# kettle <dir> <phase line>: a made-up plan with its page/ pieces, from the plan text on stdin.
pieces() {
  mkdir -p "$1/page"
  printf '@import url("https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap");\n:root { --accent: #c33; }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --accent: #f66; color-scheme: dark; } }\n' > "$1/page/look.css"
  echo '<p>PICTURE-MARK</p>' > "$1/page/picture.html"
  echo '<p>NEW-MARK</p>' > "$1/page/new.html"
}

base="$tmp/kettle"
mkdir -p "$base"
cat > "$base/plan.md" <<'EOF'
# kettle

Phase: awaiting approval. The page is out for a read.
Waiting on: Victor: approval of the page.
Repository: /nowhere

## Principle

The kettle boils water & nothing <else>.

## What this is for

Tea.

## Terms

- **Spout** (from the drawings): where the water leaves; a `<pipe>` & a lid. TERM-MARK
- an odd term line with no bold word ODD-TERM

## Decisions

- **Blue.** The kettle is blue. Why: RECORD-MARK.

| a table | the script cannot turn |
|---|---|
| TABLE-MARK | x |

## The ladder

- Rung 1 The bench test
  - Runs: `make test; fast` on the bench.
  - Mocks or skips: the mains.
  - Cannot tell: the taste.
  - Time and cost: 2 seconds, free.
- Rung 2 One real boil
  - Runs: one litre,
    boiled in the office. WRAP-MARK
  - Mocks or skips: nothing.
  - Cannot tell: a full kettle.
  - Time and cost: not measured yet.
  - Built by: Work item 2.
- The real run, above the ladder: the office's morning tea.

Done means: Rung 2.

## Every brief

Nothing.

## Progress

- Work item 1: done. Handed back NOTE-MARK.
- Work item 2: under way.
- Work item 3: not started.

## Work

Starts on approval. GATE-MARK

### Work item 1 Heater (builder)

- For: the water gets hot, whole sentence one;
  and the second line of For. FOR-MARK
- You own: STEPS-HIDDEN
- Done when: DONE-HIDDEN
- After: nothing.
- Runs with: Work item 2.

### Work item 2 Whistle (builder)

- For: someone hears the boil.
- After: nothing.
- Runs with: Work item 1.

### Work item 3 Assembly (chief engineer)

- For: one kettle.
- After: Work item 1, Work item 2.

## What "approved" starts

Approving covers: APPROVAL-MARK.

## Sign-off

The chief engineer stands behind it. SIGN-MARK

- Signed: the chief engineer, 2026-11-16 01:23.
EOF
pieces "$base"
before=$(cksum < "$base/plan.md")

# -- the first order --------------------------------------------------------------
run "$base/plan.md"
f="$base/page.html"
check "writes the page and prints its path" '[ $rc -eq 0 ] && [ "$out" = "$f" ] && [ -f "$f" ]'
check "the plan file is never written" '[ "$(cksum < "$base/plan.md")" = "$before" ]'
for name in "The whole, in one picture" "New since we talked" "The work" "The ladder" "What your approval starts" "Sign-off" "The words" "The record"; do
  check "part '$name' appears once" '[ "$(grep -c -F "<h2>$name</h2>" "$f")" = 1 ]'
done
first="picture new work ladder approval signoff words record"
opened() { py "$1" "\" \".join(re.findall(r\"data-part=\\\"(\\w+)\\\" open\", s))"; }
check "awaiting approval: the first order" '[ "$(py "$f" "\" \".join(re.findall(r\"data-part=\\\"(\\w+)\\\"\", s))")" = "$first" ]'
check "awaiting approval: every part open but the record" '[ "$(opened "$f")" = "picture new work ladder approval signoff words" ]'
check "the top: name, phase, sentence, waiting, principle" 'grep -q "<h1>kettle</h1>" "$f" && grep -q "data-phase=\"awaiting approval\"" "$f" && grep -q "The page is out for a read." "$f" && grep -q "Waiting on <b>Victor</b>" "$f"'
check "the plan's own pieces are in" 'grep -q PICTURE-MARK "$f" && grep -q NEW-MARK "$f" && grep -q -- "--accent: #c33" "$f"'

# -- the work ---------------------------------------------------------------------
check "states follow Progress" 'grep -q "data-item=\"1\" data-state=\"done\"" "$f" && grep -q "data-item=\"2\" data-state=\"under way\"" "$f" && grep -q "data-item=\"3\" data-state=\"not started\"" "$f"'
stage_of() { py "$f" "re.search(r'data-stage=\"(\\d)\"(?:(?!data-stage).)*data-item=\"$1\"', s, re.S).group(1)"; }
check "items waiting on nothing stand first" '[ "$(stage_of 1)" = 0 ] && [ "$(stage_of 2)" = 0 ]'
check "an item stands after what it waits on" '[ "$(stage_of 3)" = 1 ]'
check "items that run together share one group" 'py "$f" "bool(re.search(r\"group together\\\"><div class=\\\"item [^\\\"]*\\\" data-item=\\\"1\\\".*?data-item=\\\"2\\\"\", s))" | grep -qx True'
check "an item shows its whole For field" 'grep -q "whole sentence one; and the second line of For. FOR-MARK" "$f"'
check "an item's steps and Done when stay off the page" '! grep -q -e STEPS-HIDDEN -e DONE-HIDDEN "$f"'
check "the Progress note and the Work intro show" 'grep -q NOTE-MARK "$f" && grep -q GATE-MARK "$f"'

# -- the ladder, sign-off, words, record --------------------------------------------
check "the ladder: lowest rung first in the rails" 'py "$f" "re.findall(r\"data-rung=\\\"(\\d)\\\"\", s)" | grep -qx "\[.1., .2.\]"'
check "the ladder: the rung done means is marked" 'grep -q "class=\"rung done-means\" data-rung=\"2\"" "$f" && [ "$(grep -o "Done means this rung" "$f" | wc -l | tr -d " ")" = 1 ]'
check "the ladder: each fact under its label" 'grep -q "<dt>Runs</dt><dd><code>make test; fast</code> on the bench.</dd>" "$f" && grep -q "<dt>Built by</dt><dd>Work item 2.</dd>" "$f" && grep -q "<dt>Runs</dt><dd>one litre, boiled in the office. WRAP-MARK</dd>" "$f"'
check "the ladder: Built by only where it is written" '[ "$(grep -o "<dt>Built by</dt>" "$f" | wc -l | tr -d " ")" = 1 ]'
check "the ladder: the real run stands above" 'grep -q "class=\"above\">The real run" "$f"'
check "sign-off: the signed line is a signature with its time" 'grep -q "signed 16 Nov 2026, 01:23" "$f"'
check "sign-off: a missing Approved line leaves its place empty" 'grep -q "data-sig=\"approved\"><span class=\"empty\">" "$f"'
check "the words: a term with its source" 'grep -q "<dt>Spout</dt>" "$f" && grep -q "class=\"from\">from the drawings" "$f"'
check "the words: a line it cannot take apart is shown whole" 'grep -q "an odd term line with no bold word ODD-TERM" "$f"'
check "a table the script cannot turn is shown as text" 'grep -q "class=\"raw\">| a table" "$f" && grep -q TABLE-MARK "$f"'
check "< and & from the plan reach the page escaped" 'grep -q "water &amp; nothing &lt;else&gt;" "$f" && grep -q "<code>&lt;pipe&gt;</code> &amp; a lid" "$f" && ! grep -q "<else>" "$f" && ! grep -q "<pipe>" "$f"'
# words_kept <plan.md> <page.html>: every word of the sections the script fills is on the page; prints the ones that are not.
words_kept() { python3 - "$1" "$2" <<'PY'
import html, re, sys
plan, page = open(sys.argv[1]).read(), open(sys.argv[2]).read()
text = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<style>.*?</style>", "", page, flags=re.S)))
keep = {"Principle", "The ladder", "Terms", "Decisions", 'What "approved" starts', "Sign-off"}
missing = []
for sec in re.split(r"^## ", plan, flags=re.M)[1:]:
    title, _, body = sec.partition("\n")
    if title.strip() in keep:
        body = re.sub(r"^(- Signed:|- Approved:|Done means:).*$", "", body, flags=re.M)
        for w in re.sub(r"[`*|()\"]", " ", body).split():
            w = w.strip(".,:;-")
            if w and w not in text:
                missing.append(w)
print(" ".join(missing))
sys.exit(1 if missing else 0)
PY
}
check "every word of the filled sections reaches the page" 'words_kept "$base/plan.md" "$f"'

# -- the second order -----------------------------------------------------------------
b="$tmp/building"; mkdir -p "$b"; pieces "$b"
sed -e 's/^Phase: awaiting approval\./Phase: building./' -e '/^Waiting on:/d' "$base/plan.md" > "$b/plan.md"
run "$b/plan.md"
second="work new ladder picture approval signoff words record"
order() { py "$1" "\" \".join(re.findall(r\"data-part=\\\"(\\w+)\\\"\", s))"; }
check "building: the second order" '[ $rc -eq 0 ] && [ "$(order "$b/page.html")" = "$second" ]'
check "building: only the work, what is new and the ladder open" '[ "$(opened "$b/page.html")" = "work new ladder" ]'
cat > "$b/page/own.html" <<'EOF'
<h2>Own one</h2><p>OWN-ONE</p>
<h2>Own two</h2><p>OWN-TWO</p>
EOF
run "$b/plan.md"
check "own parts stand after the ladder, folded, each under its heading" '[ "$(order "$b/page.html")" = "work new ladder own own picture approval signoff words record" ] && [ "$(opened "$b/page.html")" = "work new ladder" ] && grep -q "<summary><h2>Own one</h2></summary>" "$b/page.html"'
cp "$b/page/own.html" "$base/page/own.html"; run "$base/plan.md"
check "own parts in the first order stand after the ladder" '[ "$(order "$f")" = "picture new work ladder own own approval signoff words record" ]'
rm "$base/page/own.html"
echo '<p>no heading</p><h2>The work</h2><p>x</p>' > "$b/page/own.html"
run "$b/plan.md"
check "own.html with text before its first h2 or a taken name is refused" '[ $rc -eq 1 ] && echo "$err" | grep -q "text before its first <h2>" && echo "$err" | grep -q "takes a name the page already has"'
rm "$b/page/own.html"

dr="$tmp/dropped"; mkdir -p "$dr"; pieces "$dr"
sed 's/^Phase: awaiting approval\./Phase: dropped. Abandoned./' "$base/plan.md" > "$dr/plan.md"
run "$dr/plan.md"
check "dropped before approval: the first order" '[ $rc -eq 0 ] && [ "$(order "$dr/page.html")" = "$first" ]'
printf -- '- Approved: Victor, 2026-11-16 01:36. "yes & go"\n' >> "$dr/plan.md"
run "$dr/plan.md"
check "dropped after approval: the second order" '[ "$(order "$dr/page.html")" = "$second" ]'
check "the Approved line is a signature with its words" 'grep -q "approved 16 Nov 2026, 01:36" "$dr/page.html" && grep -q "<q>yes &amp; go</q>" "$dr/page.html"'

# -- no Progress, a ladder of none --------------------------------------------------------
np="$tmp/noprogress"; mkdir -p "$np"; pieces "$np"
python3 - "$base/plan.md" "$np/plan.md" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"## Progress\n.*?(?=## Work)", "", s, flags=re.S)
s = re.sub(r"## The ladder\n.*?(?=## Every brief)", "## The ladder\n\nNone, because the kettle is <tiny> & cheap.\n\n", s, flags=re.S)
open(sys.argv[2], "w").write(s)
PY
run "$np/plan.md"
check "no Progress section: every item not started" '[ $rc -eq 0 ] && [ "$(grep -o "data-state=\"[^\"]*\"" "$np/page.html" | sort -u)" = "data-state=\"not started\"" ]'
check "a ladder of None, because is that one line" '[ "$(py "$np/page.html" "re.search(r\"<h2>The ladder</h2></summary>\\s*<div class=\\\"part-body\\\">(.*?)</div>\\s*</details>\", s, re.S).group(1)")" = "<p class=\"none\">None, because the kettle is &lt;tiny&gt; &amp; cheap.</p>" ]'

# -- an empty Progress section, and items that run together across stages ---------------------
ep="$tmp/emptyprogress"; mkdir -p "$ep"; pieces "$ep"
python3 - "$base/plan.md" "$ep/plan.md" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"## Progress\n.*?(?=## Work)", "## Progress\n\n<Written by plans.py progress on approval.>\n\n", s, flags=re.S)
s = s.replace("- After: Work item 1, Work item 2.", "- After: Work item 1.\n- Runs with: Work item 2.")
open(sys.argv[2], "w").write(s)
PY
run "$ep/plan.md"
check "a Progress section with no line yet: every item not started" '[ $rc -eq 0 ] && [ "$(grep -o "data-state=\"[^\"]*\"" "$ep/page.html" | sort -u)" = "data-state=\"not started\"" ]'
check "items that run together in different stages each name the other" 'py "$ep/page.html" "bool(re.search(r\"data-item=\\\"3\\\".*?Runs with Work item 2\", s, re.S)) and bool(re.search(r\"data-item=\\\"2\\\".*?Runs with Work item 1, Work item 3\", s, re.S))" | grep -qx True'

# -- refusals ---------------------------------------------------------------------------------
# refused <dir> <what the message names>: exit 1, the name in stderr, page.html unchanged.
refused() {
  local pagefile="$1/page.html" sum=none
  [ -f "$pagefile" ] && sum=$(cksum < "$pagefile")
  run "$1/plan.md"
  local now=none; [ -f "$pagefile" ] && now=$(cksum < "$pagefile")
  [ $rc -eq 1 ] && echo "$err" | grep -q -F -- "$2" && echo "$err" | grep -q "no page written" && [ "$now" = "$sum" ]
}
r="$tmp/refuse"; mkdir -p "$r"; pieces "$r"; cp "$base/plan.md" "$r/plan.md"
python3 "$page" "$r/plan.md" > /dev/null
for piece in look.css picture.html new.html; do
  mv "$r/page/$piece" "$tmp/aside"
  check "a missing page/$piece is refused by name, the page untouched" 'refused "$r" "page/$piece is missing"'
  mv "$tmp/aside" "$r/page/$piece"
done
mv "$r/page/new.html" "$tmp/aside"; mv "$r/page/look.css" "$tmp/aside2"
check "every missing piece is named at once" 'refused "$r" "page/new.html is missing" && echo "$err" | grep -q "page/look.css is missing"'
mv "$tmp/aside" "$r/page/new.html"; mv "$tmp/aside2" "$r/page/look.css"
: > "$r/page/picture.html"
check "an empty piece is refused" 'refused "$r" "page/picture.html is empty"'
echo '<p>PICTURE-MARK</p>' > "$r/page/picture.html"
printf '.page { max-width: 600px; }\n:root { --bg: #fff; margin: 0; }\n' >> "$r/page/look.css"
check "a look that sets layout is refused" 'refused "$r" "the rule '"'"'.page'"'"' styles more than :root" && echo "$err" | grep -q "'"'"'margin'"'"' is not a token"'
pieces "$r"

strip() { python3 - "$base/plan.md" "$r/plan.md" "$1" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
open(sys.argv[2], "w").write(re.sub(sys.argv[3], "", s, flags=re.S | re.M))
PY
}
strip '^## Terms\n.*?(?=^## )'
check "a missing section is refused by name" 'refused "$r" "no '"'"'## Terms'"'"' section"'
strip '^Done means: Rung 2\.\n'
check "a ladder with rungs and no Done means is refused" 'refused "$r" "no line '"'"'Done means: Rung <n>.'"'"'"'
strip '^- After: Work item 1, Work item 2\.\n'
check "a work item with no After field is refused" 'refused "$r" "Work item 3 has no '"'"'- After:'"'"' field"'
strip '^- Work item 2: under way\.\n'
check "a work item with no Progress line is refused" 'refused "$r" "no line for Work item 2"'
strip '^Phase: .*?\n'
check "a plan with no Phase line is refused" 'refused "$r" "no '"'"'Phase:'"'"' line"'
python3 - "$base/plan.md" "$r/plan.md" <<'PY'
import sys
s = open(sys.argv[1]).read().replace("- After: nothing.\n- Runs with: Work item 1.", "- After: Work item 3.\n- Runs with: Work item 1.")
open(sys.argv[2], "w").write(s)
PY
check "After fields that wait in a circle are refused" 'refused "$r" "wait in a circle"'
# edit <old> <new> [<old> <new> ...]: the base plan with each old text replaced, as the plan under refusal.
edit() { python3 - "$base/plan.md" "$r/plan.md" "$@" <<'PY'
import sys
s, pairs = open(sys.argv[1]).read(), sys.argv[3:]
for old, new in zip(pairs[::2], pairs[1::2]):
    assert old in s, old
    s = s.replace(old, new)
open(sys.argv[2], "w").write(s)
PY
}
edit $'  - Cannot tell: the taste.\n' "" $'  - Mocks or skips: the mains.\n' ""
check "a rung that lacks facts is refused, each named" 'refused "$r" "Rung 1 has no '"'"'Cannot tell:'"'"' sub-item" && echo "$err" | grep -q "Rung 1 has no '"'"'Mocks or skips:'"'"' sub-item"'
edit $'- Rung 1 The bench test\n' $'- Rung 1 The bench test: runs it; mocks nothing\n'
check "a rung in the one-line shape is refused" 'refused "$r" "Rung 1 gives its facts in one line"'
edit $'  - Time and cost: 2 seconds, free.\n' $'  - Taste: sweet.\n'
check "a fact under an unknown label is refused" 'refused "$r" "'"'"'- Taste: sweet.'"'"' is not a sub-item starting Runs" && echo "$err" | grep -q "Rung 1 has no '"'"'Time and cost:'"'"' sub-item"'
python3 - "$base/plan.md" "$r/plan.md" <<'PY'
import sys
s = open(sys.argv[1]).read().replace("2 seconds, free.\n", "2 seconds, free.\nDone means: Rung 1.\n", 1).replace("\nDone means: Rung 2.\n", "\n")
s = s.replace("- Signed: the chief engineer, 2026-11-16 01:23.", "- Signed: the chief engineer, 2026-11-16 01:23.\n- Signed: the chief engineer, 2026-11-16 02:00.")
s = s.replace("- For: one kettle.", "- For:")
open(sys.argv[2], "w").write(s)
PY
check "a second Signed line and an empty For are refused" 'refused "$r" "a second '"'"'- Signed:'"'"' line" && echo "$err" | grep -q "Work item 3: '"'"'- For:'"'"' is empty"'
python3 - "$r/plan.md" <<'PY'
import sys
s = open(sys.argv[1]).read().replace("\n- Signed: the chief engineer, 2026-11-16 02:00.", "").replace("- For:\n", "- For: one kettle.\n")
open(sys.argv[1], "w").write(s)
PY
run "$r/plan.md"
check "a Done means line right under the last rung still marks its rung" '[ $rc -eq 0 ] && grep -q "class=\"rung done-means\" data-rung=\"1\"" "$r/page.html"'

old="$tmp/old"; mkdir -p "$old"; pieces "$old"
sed 's/^Phase: awaiting approval\. .*/Status: the old sentence./' "$base/plan.md" > "$old/plan.md"
run "$old/plan.md"
check "a plan in the older shape is refused in one line" '[ $rc -eq 1 ] && [ "$(echo "$err" | wc -l | tr -d " ")" = 1 ] && echo "$err" | grep -q "older shape" && [ ! -f "$old/page.html" ]'
nf="$tmp/nofolder"; mkdir -p "$nf"; cp "$base/plan.md" "$nf/plan.md"
run "$nf/plan.md"
check "a plan with no page/ folder is refused in one line" '[ $rc -eq 1 ] && [ "$(echo "$err" | wc -l | tr -d " ")" = 1 ] && echo "$err" | grep -q "no page/ folder" && [ ! -f "$nf/page.html" ]'

run
check "no argument is bad usage" '[ $rc -eq 2 ] && echo "$err" | grep -q usage'

exit $fail
