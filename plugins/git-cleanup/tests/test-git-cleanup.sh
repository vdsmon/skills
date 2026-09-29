#!/usr/bin/env bash
# Offline sandbox checks for git_cleanup.sh. Builds a throwaway origin and a main
# checkout with linked worktrees inside it, fakes gh, runs the script from a linked
# worktree, and checks what survives. The main checkout sits on a merged, clean
# branch: the layout that once made the script rm -rf the main checkout.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../skills/git-cleanup/scripts/git_cleanup.sh"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

if ((BASH_VERSINFO[0] < 4)); then
  echo "skip: run this suite with bash 4+ (the script under test needs it)"
  exit 0
fi

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/git-cleanup-test.XXXXXX")" && pwd -P)
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export HOME="$tmp" GIT_CONFIG_NOSYSTEM=1

# "github" in the origin path switches on the squash-aware gh path.
origin="$tmp/github.com/origin.git"
main="$tmp/main"
git init -q --bare -b main "$origin"
git init -q -b main "$main"
cd "$main" || exit 1
commit() { echo "$2" >> "$1"; git add "$1"; git commit -q -m "$1: $2"; }
printf '.wt/\nstore/\n' >> .git/info/exclude

commit a.txt one
git remote add origin "$origin"

# Plain merges: feat/x is left checked out in the main checkout.
git switch -q -c feat/x; commit x.txt x; git switch -q main; git merge -q --ff-only feat/x
for b in done locked dirty; do git branch "feat/$b"; done
pre_squash=$(git rev-parse HEAD)

# feat/sq: squash-merged, local tip equals the PR head.
git switch -q -c feat/sq; commit sq.txt one; sq_tip=$(git rev-parse HEAD)
git switch -q main; git merge -q --squash feat/sq >/dev/null 2>&1; git commit -q -m "squash sq (#11)"; sq_merge=$(git rev-parse HEAD)

# feat/rewritten: two local commits; the PR branch was rewritten before merge, so
# its head differs, but the squash carries the same net change.
git switch -q -c feat/rewritten "$pre_squash"; commit r.txt one; commit r.txt two
git switch -q main; git merge -q --squash feat/rewritten >/dev/null 2>&1; git commit -q -m "squash rewritten (#12)"; rw_merge=$(git rev-parse HEAD)

# feat/extra: PR merged, then one more local commit the PR never had.
git switch -q -c feat/extra "$pre_squash"; commit e.txt one
git switch -q main; git merge -q --squash feat/extra >/dev/null 2>&1; git commit -q -m "squash extra (#13)"; ex_merge=$(git rev-parse HEAD)
git switch -q feat/extra; commit e.txt after-merge

git switch -q main
git push -q origin main
git switch -q feat/x

git worktree add -q -b other .wt/other main && (cd .wt/other && commit o.txt unmerged)
git worktree add -q .wt/done feat/done
mkdir -p .wt/done/store/ro && echo blob > .wt/done/store/ro/blob && chmod a-w .wt/done/store/ro
git worktree add -q .wt/locked feat/locked && git worktree lock .wt/locked
git worktree add -q .wt/dirty feat/dirty && echo wip > .wt/dirty/wip.txt

mkdir -p "$tmp/bin"
printf '#!/bin/sh\ncat "%s"\n' "$tmp/prs.tsv" > "$tmp/bin/gh" && chmod +x "$tmp/bin/gh"
printf '%s\t%s\t%s\t%s\n' \
  feat/sq "$sq_tip" 11 "$sq_merge" \
  feat/rewritten 1111111111111111111111111111111111111111 12 "$rw_merge" \
  feat/extra 2222222222222222222222222222222222222222 13 "$ex_merge" > "$tmp/prs.tsv"
export PATH="$tmp/bin:$PATH"

run() { (cd "$main/.wt/other" && "$BASH" "$script" "$@"); }

run --dry-run > "$tmp/dry.out" 2> "$tmp/dry.err"
plan=$(sed -n '/^REMOVE/,/^$/p' "$tmp/dry.out")
check "dry run: main checkout's branch not in REMOVE" '! grep -q "feat/x" <<< "$plan"'
check "dry run: main checkout's branch in SKIP (main worktree)" 'grep -A1 "^SKIP (checked out in main worktree)" "$tmp/dry.out" | grep -q "feat/x"'
check "dry run: tip-equal squash in REMOVE" 'grep -q "feat/sq  (squash-merged: PR #11)" <<< "$plan"'
check "dry run: rewritten branch matched by patch-id" 'grep -q "feat/rewritten  (squash-merged: PR #12, matched by patch-id)" <<< "$plan"'
check "dry run: extra commit stays in KEEP with the reason" 'grep -q "feat/extra  (PR #13 merged, but this tip differs" "$tmp/dry.out"'
check "dry run: dirty worktree skipped" 'grep -A1 "^SKIP (merged but dirty" "$tmp/dry.out" | grep -q "feat/dirty"'
check "dry run: nothing removed" '[ -d "$main/.wt/done" ] && git show-ref --verify -q refs/heads/feat/sq'

run > "$tmp/run.out" 2>&1; rc=$?
check "execute: main checkout survives with .git" '[ -d "$main/.git" ] && [ -f "$main/x.txt" ]'
check "execute: main checkout still on its branch" '[ "$(git -C "$main" branch --show-current)" = "feat/x" ]'
check "execute: clean worktree with read-only dir removed" '[ ! -e "$main/.wt/done" ] && ! git show-ref --verify -q refs/heads/feat/done'
check "execute: locked worktree left in place" '[ -d "$main/.wt/locked" ] && git show-ref --verify -q refs/heads/feat/locked'
check "execute: locked worktree reported as FAILED, exit 1" '[ $rc -eq 1 ] && grep -q "worktree: .*locked (git refused" "$tmp/run.out"'
check "execute: squash-merged branches deleted" '! git show-ref --verify -q refs/heads/feat/sq && ! git show-ref --verify -q refs/heads/feat/rewritten'
check "execute: unmerged and dirty kept" 'git show-ref --verify -q refs/heads/feat/extra && [ -f "$main/.wt/dirty/wip.txt" ]'

git -C "$main" remote add broken "$tmp/missing.git"
run --dry-run > /dev/null 2> "$tmp/fetch.err"; rc=$?
check "unreachable remote: warns and still plans" '[ $rc -eq 0 ] && grep -q "WARN: fetch failed" "$tmp/fetch.err"'

if [ -x /bin/bash ] && ! /bin/bash -c '((BASH_VERSINFO[0] >= 4))'; then
  (cd "$main" && /bin/bash "$script" --dry-run) > /dev/null 2> "$tmp/old.err"; rc=$?
  check "bash 3: clear error, exit 2" '[ $rc -eq 2 ] && grep -q "needs bash 4+" "$tmp/old.err"'
fi
exit $fail
