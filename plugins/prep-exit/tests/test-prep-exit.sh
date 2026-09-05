#!/usr/bin/env bash
# Offline checks for the prep-exit scripts: handoff.sh writes the note with the baseline
# embedded and every section header, keeps the previous note, and never fails the caller.
set -u
here=$(cd "$(dirname "$0")" && pwd)
scripts="$here/../skills/prep-exit/scripts"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/prep-exit-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"; mkdir -p "$repo"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid HOME="$tmp"
git -C "$repo" init -q && echo a > "$repo/a.txt" && git -C "$repo" add . && git -C "$repo" commit -q -m one
echo b > "$repo/b.txt"

out=$(bash "$scripts/handoff.sh" "$repo/.state" "$repo")
check "prints the path" '[ "$out" = "$repo/.state/HANDOFF.md" ]'
check "file exists" '[ -f "$repo/.state/HANDOFF.md" ]'
check "baseline embedded (untracked file counted)" 'grep -q "status: 0 changed, 1 untracked" "$repo/.state/HANDOFF.md"'
for h in "Where we are" "Done this session" "Decisions and facts that live only here" "Pending" "Next step" "Resume prompt"; do
  check "section: $h" 'grep -q "^## $h" "$repo/.state/HANDOFF.md"'
done
check "repository path named" 'grep -q "Repository:" "$repo/.state/HANDOFF.md"'

echo "filled" >> "$repo/.state/HANDOFF.md"
bash "$scripts/handoff.sh" "$repo/.state" "$repo" >/dev/null
check "previous note kept" 'grep -q "^filled" "$repo/.state/HANDOFF.prev.md"'
check "new note is fresh" '! grep -q "^filled" "$repo/.state/HANDOFF.md"'

check "no state dir argument: usage, exit 0" 'bash "$scripts/handoff.sh" 2>/dev/null; [ $? -eq 0 ]'
check "baseline.sh runs outside a repo" 'bash "$scripts/baseline.sh" "$tmp" | grep -q "not a git repository"'
exit $fail
