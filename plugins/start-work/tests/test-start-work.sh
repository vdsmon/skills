#!/usr/bin/env bash
# Offline sandbox checks for start_work.sh. Builds a throwaway origin, a main
# checkout that is one commit behind it, and a second clone that pushes a branch,
# then checks where each worktree lands and what it is based on.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../skills/start-work/scripts/start_work.sh"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/start-work-test.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export HOME="$tmp" GIT_CONFIG_NOSYSTEM=1

origin="$tmp/origin.git"
main="$tmp/main"
git init -q --bare -b main "$origin"
git clone -q "$origin" "$main" 2>/dev/null
cd "$main" || exit 1
commit() { echo "$2" >> "$1"; git add "$1"; git commit -q -m "$1: $2"; }
printf '.env\ncache.db\n' > .gitignore
printf '.env\n' > .worktreeinclude
commit a.txt one
git add .gitignore .worktreeinclude && git commit -q -m "ignore rules"
git push -q -u origin main
git remote set-head origin main
echo "SECRET=1" > .env
echo "big" > cache.db
mkdir -p sub

# A teammate pushes one more commit to main and a branch of their own.
git clone -q "$origin" "$tmp/other" 2>/dev/null
(cd "$tmp/other" && commit b.txt two && git push -q origin main && git switch -q -c feat/theirs && commit t.txt t && git push -q origin feat/theirs)
fresh=$(git -C "$origin" rev-parse main)
stale=$(git rev-parse HEAD)

out=$(bash "$script" "$main/sub" feat/hourly 2>&1); rc=$?
wt="$main/.claude/worktrees/feat-hourly"
check "new branch: exit 0 and prints the path" '[ $rc -eq 0 ] && grep -q "^worktree: $wt$" <<< "$out"'
check "new branch: based on origin, not the stale local main" '[ "$(git -C "$wt" rev-parse HEAD)" = "$fresh" ] && [ "$fresh" != "$stale" ]'
check "new branch: no upstream until the first push" '! git -C "$wt" rev-parse --abbrev-ref "feat/hourly@{upstream}" >/dev/null 2>&1'
check "main checkout: still on main, at its old commit" '[ "$(git branch --show-current)" = "main" ] && [ "$(git rev-parse HEAD)" = "$stale" ]'
check "main checkout: clean, the worktree folder is ignored" '[ -z "$(git status --porcelain)" ]'
check ".worktreeinclude: ignored .env copied, unlisted cache.db not" '[ -f "$wt/.env" ] && [ ! -e "$wt/cache.db" ]'

out=$(bash "$script" "$wt" fix/typo 2>&1); rc=$?
check "from inside a worktree: lands next to the others" '[ $rc -eq 0 ] && [ -d "$main/.claude/worktrees/fix-typo" ]'
check "exclude line written once" '[ "$(grep -c "^.claude/worktrees/$" .git/info/exclude)" = "1" ]'

out=$(bash "$script" "$main" feat/theirs 2>&1); rc=$?
check "remote-only branch: tracked" '[ $rc -eq 0 ] && [ "$(git -C "$main/.claude/worktrees/feat-theirs" rev-parse --abbrev-ref "@{upstream}")" = "origin/feat/theirs" ]'

git branch mine "$stale"
out=$(bash "$script" "$main" mine 2>&1); rc=$?
check "existing local branch: reused as is" '[ $rc -eq 0 ] && [ "$(git -C "$main/.claude/worktrees/mine" rev-parse HEAD)" = "$stale" ]'

out=$(bash "$script" "$main" --detach "$stale" exp-old 2>&1); rc=$?
check "detached: at the given commit, no branch" '[ $rc -eq 0 ] && [ "$(git -C "$main/.claude/worktrees/exp-old" rev-parse HEAD)" = "$stale" ] && [ -z "$(git -C "$main/.claude/worktrees/exp-old" branch --show-current)" ]'

out=$(bash "$script" "$main" feat/hourly 2>&1); rc=$?
check "existing path: refused, nothing changed" '[ $rc -ne 0 ] && grep -q "already exists" <<< "$out"'

out=$(bash "$script" "$tmp" feat/x 2>&1); rc=$?
check "not a repository: clear error" '[ $rc -ne 0 ] && grep -q "not inside a git repository" <<< "$out"'

git remote set-url origin "$tmp/missing.git"
out=$(bash "$script" "$main" feat/offline 2>&1); rc=$?
check "unreachable origin: warns and uses cached refs" '[ $rc -eq 0 ] && grep -q "WARN: fetch" <<< "$out" && [ "$(git -C "$main/.claude/worktrees/feat-offline" rev-parse HEAD)" = "$fresh" ]'

exit $fail
