#!/bin/bash
# Offline tests for the crew's feedback script. Every ledger lives under a temp folder.
set -u
here=$(cd "$(dirname "$0")" && pwd)
scripts=$here/../scripts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0

check() { # name, condition...
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}
fb() { bash "$scripts/feedback.sh" "$@"; }
home() { export CC_CREW_HOME=$tmp/$1; }
open_ids() { ls "$CC_CREW_HOME/feedback/open" | sed 's/\.md$//'; }
# Every path and every byte under the ledger home, as one checksum.
snapshot() { (cd "$CC_CREW_HOME" && find . | sort && find . -type f | sort | while read -r f; do cat "$f"; done) | cksum; }
line_of() { grep -n -F -- "$1" "$2" | head -n 1 | cut -d: -f1; }

home empty
check "open with nothing open says so and exits 0" bash -c "bash '$scripts/feedback.sh' open | grep -q '^No open entries; 0 closed.$'"

# file and open: "page" is filed a second before "builder", so the oldest-first order
# disagrees with the order of the pieces' names.
home filed
printf 'first entry\n' | fb file "page" "session-1" >/dev/null
sleep 1
printf 'second entry\n' | fb file "builder" "session-2" >/dev/null
open_dir=$CC_CREW_HOME/feedback/open
page_id=$(open_ids | grep -- '-page$')
builder_id=$(open_ids | grep -- '-builder$')
fb open > "$tmp/open-1"
check "file writes two files under open/" test "$(ls "$open_dir" | wc -l | tr -d ' ')" = 2
check "an entry file has its header, piece and session" bash -c "head -n 1 '$open_dir/$page_id.md' | grep -qE '^## [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} · page$' && grep -q '^- Session: session-1$' '$open_dir/$page_id.md' && grep -q '^- Repository: ' '$open_dir/$page_id.md' && grep -q '^first entry$' '$open_dir/$page_id.md'"
check "the other file has its own piece and session" bash -c "grep -q '· builder$' '$open_dir/$builder_id.md' && grep -q 'Session: session-2' '$open_dir/$builder_id.md'"
check "an id is the time and the piece" bash -c "echo '$page_id' | grep -qE '^[0-9]{8}-[0-9]{6}-page$'"
check "open prints each entry under its id" bash -c "grep -qF '$page_id' '$tmp/open-1' && grep -qF '$builder_id' '$tmp/open-1'"
check "open prints the oldest first" test "$(line_of 'first entry' "$tmp/open-1")" -lt "$(line_of 'second entry' "$tmp/open-1")"
check "open ends with the counts" test "$(tail -n 1 "$tmp/open-1")" = "2 open, 0 closed."

# Same piece, same second: two files. Retried until both filings land in one second.
for try in 1 2 3 4 5; do
  home "twins-$try"
  printf 'one\n' | fb file "builder" >/dev/null
  printf 'two\n' | fb file "builder" >/dev/null
  [ "$(open_ids | cut -c1-15 | sort -u | wc -l | tr -d ' ')" = 1 ] && break
done
check "the twins were filed in one second" test "$(open_ids | cut -c1-15 | sort -u | wc -l | tr -d ' ')" = 1
check "same piece in the same second makes two files" test "$(open_ids | wc -l | tr -d ' ')" = 2
check "neither twin overwrote the other" bash -c "cat '$CC_CREW_HOME'/feedback/open/*.md | grep -q '^one$' && cat '$CC_CREW_HOME'/feedback/open/*.md | grep -q '^two$'"

# close: the outcome is added at the end, the file moves, the other entry stays put.
home filed
fb close "$page_id" "Changed the page text in PR 7." >/dev/null
closed_dir=$CC_CREW_HOME/feedback/closed
fb open > "$tmp/open-2"
check "close moves the file to closed/" bash -c "test -f '$closed_dir/$page_id.md' && ! test -e '$open_dir/$page_id.md'"
check "close keeps the entry and adds the outcome after it" bash -c "grep -q '^first entry$' '$closed_dir/$page_id.md' && tail -n 1 '$closed_dir/$page_id.md' | grep -q 'PR 7' && grep -qE '^### Outcome · [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$' '$closed_dir/$page_id.md'"
check "a closed entry no longer shows in open" bash -c "! grep -q 'first entry' '$tmp/open-2'"
check "the other entry shows under the same id" bash -c "grep -qF '$builder_id' '$tmp/open-2' && grep -q 'second entry' '$tmp/open-2'"
check "open counts the closed entry" test "$(tail -n 1 "$tmp/open-2")" = "1 open, 1 closed."

# close refuses, and each refusal leaves every file as it was.
refuses() { # args for close...
  local before; before=$(snapshot)
  ! fb close "$@" 2>/dev/null && [ "$(snapshot)" = "$before" ]
}
check "close refuses an id never filed" refuses "20200101-000000-nothing" "done"
check "close refuses an id already closed" refuses "$page_id" "again"
check "close refuses an id with a slash" refuses "../open/$builder_id" "done"
check "close refuses an empty outcome" refuses "$builder_id" ""
check "close refuses a blank outcome" refuses "$builder_id" "  "
check "close refuses a missing outcome" refuses "$builder_id"

# An entry quoting the ledger's own shapes is still one open entry.
home quoting
printf 'He said:\n\n## 2026-01-01 00:00 · fake\n\n### Outcome · 2026-01-01 00:00\n\nclosed\n' | fb file "other" >/dev/null
check "a quoting entry is one open entry and closes nothing" bash -c "test \"\$(bash '$scripts/feedback.sh' open | tail -n 1)\" = '1 open, 0 closed.' && test -z \"\$(ls '$CC_CREW_HOME/feedback/closed')\""

# Adopting the old ledger: moved whole first, then cut into one file per entry.
home adopt
old=$tmp/old-ledger.md
printf '\n## 2026-11-10 09:00 · builder\n\n- Session: s-a\n- Repository: /r\n\nold one\n\n## 2026-11-11 10:30 · role text\n\n- Session: s-b\n- Repository: /r\n\nold two\n' > "$old"
mkdir -p "$CC_CREW_HOME" && cp "$old" "$CC_CREW_HOME/feedback.md"
fb open > "$tmp/open-3"
open_dir=$CC_CREW_HOME/feedback/open
check "adopting makes two open entries" test "$(open_ids | tr '\n' ' ')" = "20261110-090000-builder 20261111-103000-role-text "
check "an adopted file holds the old lines" bash -c "printf '## 2026-11-10 09:00 · builder\n\n- Session: s-a\n- Repository: /r\n\nold one\n\n' | cmp -s - '$open_dir/20261110-090000-builder.md' && sed -n '9,\$p' '$old' | cmp -s - '$open_dir/20261111-103000-role-text.md'"
check "the old ledger sits whole under adopted/" bash -c "cmp -s '$old' \"\$(ls '$CC_CREW_HOME'/feedback/adopted/*/feedback.md)\" && ! test -e '$CC_CREW_HOME/feedback.md'"
check "open says how many it adopted" grep -q 'Adopted 2 entries' "$tmp/open-3"
check "adopted entries print oldest first" test "$(line_of 'old one' "$tmp/open-3")" -lt "$(line_of 'old two' "$tmp/open-3")"
fb open > "$tmp/open-4"
check "a second open adopts nothing more" bash -c "! grep -q Adopted '$tmp/open-4' && test \"\$(tail -n 1 '$tmp/open-4')\" = '2 open, 0 closed.'"

# Text before the first header is an entry of its own; an interrupted cut is finished.
home preamble
mkdir -p "$CC_CREW_HOME" && printf '## 2026 notes\nstray note\n\n## 2026-11-10 09:00 · builder\n\nold one\n' > "$CC_CREW_HOME/feedback.md"
fb open >/dev/null
check "text before the first header becomes an entry" bash -c "test \"\$(ls '$CC_CREW_HOME/feedback/open' | wc -l | tr -d ' ')\" = 2 && grep -rq '^stray note$' '$CC_CREW_HOME/feedback/open'"
check "that entry's id is one close accepts" bash -c "id=\$(ls '$CC_CREW_HOME/feedback/open' | grep untitled | sed 's/\.md\$//') && bash '$scripts/feedback.sh' close \"\$id\" 'read it'"

# A piece with odd characters still gives an id close accepts.
home oddpiece
printf 'x\n' | fb file "$(printf 'role\ntext / é')" >/dev/null
check "an odd piece gives a plain id" bash -c "ls '$CC_CREW_HOME/feedback/open' | grep -qE '^[0-9]{8}-[0-9]{6}-role-text\.md$'"
home interrupted
mkdir -p "$CC_CREW_HOME/feedback/adopted/feedback-20261112-000000-abc" && cp "$old" "$CC_CREW_HOME/feedback/adopted/feedback-20261112-000000-abc/feedback.md"
check "open finishes a cut cut short" bash -c "bash '$scripts/feedback.sh' open | grep -q 'Adopted 2 entries' && test \"\$(ls '$CC_CREW_HOME/feedback/open' | wc -l | tr -d ' ')\" = 2"

# The old call form is refused and writes nothing.
home oldform
printf 'old style\n' | fb "builder" "session-1" >/dev/null 2>&1
check "the old call form exits 2" test $? = 2
check "the old call form writes nothing" test ! -e "$CC_CREW_HOME"
check "file needs a piece" bash -c "! bash '$scripts/feedback.sh' file </dev/null"

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
