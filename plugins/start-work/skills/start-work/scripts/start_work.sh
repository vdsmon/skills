#!/usr/bin/env bash
# start_work.sh: make a worktree for one job, based on a fresh fetch of the remote.
#
# Usage:
#   start_work.sh <repo> <branch>                  new branch from origin's default branch
#   start_work.sh <repo> --detach <ref> <name>     detached worktree at <ref>, for an experiment
#
# The worktree goes to <main checkout>/.claude/worktrees/<name>, where Claude Code
# keeps its own worktrees. <name> defaults to the branch with "/" turned into "-".
# An existing local branch is reused; a branch that exists only on origin is
# tracked. The main checkout is never switched or changed, except that
# .claude/worktrees/ is added to .git/info/exclude when nothing ignores it yet.
# Gitignored files that match .worktreeinclude (gitignore syntax) are copied in.
set -euo pipefail

die() { echo "start-work: $*" >&2; exit 1; }

[[ $# -ge 2 ]] || die "usage: start_work.sh <repo> <branch> | <repo> --detach <ref> <name>"
repo_arg="$1"; shift
detach=""; branch=""; name=""
if [[ "$1" == "--detach" ]]; then
  [[ $# -eq 3 ]] || die "usage: start_work.sh <repo> --detach <ref> <name>"
  detach="$2"; name="$3"
else
  [[ $# -eq 1 ]] || die "usage: start_work.sh <repo> <branch>"
  branch="$1"; name="${branch//\//-}"
fi

# The main checkout, even when <repo> points into a linked worktree or a subfolder.
common=$(git -C "$repo_arg" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
  || die "$repo_arg is not inside a git repository"
[[ "$(git -C "$repo_arg" rev-parse --is-bare-repository)" == "false" ]] || die "bare repositories are not supported"
root=$(dirname "$common")
path="$root/.claude/worktrees/$name"
[[ ! -e "$path" ]] || die "$path already exists"

if ! git -C "$root" fetch --quiet origin 2>/dev/null; then
  echo "WARN: fetch from origin failed, using the refs already here" >&2
fi

if [[ -n "$detach" ]]; then
  sha=$(git -C "$root" rev-parse --verify --quiet "$detach^{commit}") || die "unknown ref: $detach"
  git -C "$root" worktree add --quiet --detach "$path" "$sha"
  summary="detached at ${sha:0:7} ($detach)"
else
  git -C "$root" check-ref-format --branch "$branch" >/dev/null 2>&1 || die "invalid branch name: $branch"
  if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$root" worktree add --quiet "$path" "$branch"
    summary="existing branch $branch at $(git -C "$root" rev-parse --short "$branch")"
  elif git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$root" worktree add --quiet --track -b "$branch" "$path" "origin/$branch"
    summary="branch $branch tracking origin/$branch"
  else
    base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) || base=""
    if [[ -z "$base" ]]; then
      for b in main master; do
        git -C "$root" show-ref --verify --quiet "refs/remotes/origin/$b" && { base="origin/$b"; break; }
      done
    fi
    [[ -n "$base" ]] || die "cannot find origin's default branch; pass an existing branch or use --detach"
    # --no-track: the new branch gets its upstream on its first push, not origin's default branch.
    git -C "$root" worktree add --quiet --no-track -b "$branch" "$path" "$base"
    summary="new branch $branch from $base at $(git -C "$root" rev-parse --short "$base")"
  fi
fi

excluded=""
if ! git -C "$root" check-ignore -q ".claude/worktrees/$name"; then
  echo ".claude/worktrees/" >> "$common/info/exclude"
  excluded="added .claude/worktrees/ to .git/info/exclude"
fi

copied=0
if [[ -f "$root/.worktreeinclude" ]]; then
  # Only files git ignores: tracked files are already in the worktree.
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    mkdir -p "$path/$(dirname "$f")"
    cp -p "$root/$f" "$path/$f"
    copied=$((copied + 1))
  done < <(comm -12 \
    <(git -C "$root" ls-files --others --ignored --exclude-standard | sort) \
    <(git -C "$root" ls-files --others --ignored --exclude-from="$root/.worktreeinclude" | sort))
fi

echo "worktree: $path"
echo "branch: $summary"
[[ $copied -eq 0 ]] || echo "copied: $copied file(s) listed in .worktreeinclude"
[[ -z "$excluded" ]] || echo "note: $excluded"
