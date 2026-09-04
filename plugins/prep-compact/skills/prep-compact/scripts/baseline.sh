#!/usr/bin/env bash
# baseline.sh [dir]: the mechanical half of the prep-compact audit, in one call.
#
# What git knows (branch and upstream, status with counts, the last five commits,
# the stash), plus the one thing `git status` never shows and a compact message
# must point at: gitignored plan or state files modified after the last commit
# (a `.sweep/plan.md`, a `.flow/` run record, a scratch note). Read-only; prints
# only lines worth pasting into the compact message. Exit 0 always, so a host
# that runs it in a non-repository still gets a usable line.
set -u

cd "${1:-.}" 2>/dev/null || { echo "baseline: not a directory: ${1:-.}"; exit 0; }
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "baseline: not a git repository: $(pwd)"
  exit 0
fi

branch=$(git branch --show-current 2>/dev/null)
[ -n "$branch" ] || branch="(detached at $(git rev-parse --short HEAD 2>/dev/null))"
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)
if [ -n "$upstream" ]; then
  counts=$(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null)
  behind=${counts%%[[:space:]]*}; ahead=${counts##*[[:space:]]}
  echo "branch: $branch -> $upstream (ahead ${ahead:-0}, behind ${behind:-0})"
else
  echo "branch: $branch (no upstream)"
fi

status=$(git status --short 2>/dev/null)
if [ -z "$status" ]; then
  echo "status: clean"
else
  tracked=$(printf '%s\n' "$status" | grep -c -v '^??')
  untracked=$(printf '%s\n' "$status" | grep -c '^??')
  echo "status: $tracked changed, $untracked untracked"
  printf '%s\n' "$status" | head -40 | sed 's/^/  /'
  total=$(printf '%s\n' "$status" | grep -c .)
  [ "$total" -gt 40 ] && echo "  ... $((total - 40)) more"
fi

echo "last commits:"
git log -5 --oneline 2>/dev/null | sed 's/^/  /'

stashes=$(git stash list 2>/dev/null | grep -c .)
[ "$stashes" -gt 0 ] && echo "stashes: $stashes (git stash list)"

# Gitignored files newer than the last commit. Ignored directories are listed as
# one entry each (--directory) so a virtualenv is one stat, not thousands; the
# usual dependency and cache directories are skipped by name, and the rest are
# searched to a shallow depth with a reference file carrying the commit time
# (portable across BSD and GNU find, which disagree on -newermt).
head_epoch=$(git log -1 --format=%ct 2>/dev/null)
if [ -n "$head_epoch" ]; then
  ref=$(mktemp "${TMPDIR:-/tmp}/prep-compact-ref.XXXXXX") || ref=""
  if [ -n "$ref" ]; then
    stamp=$(date -r "$head_epoch" '+%Y%m%d%H%M.%S' 2>/dev/null || date -d "@$head_epoch" '+%Y%m%d%H%M.%S' 2>/dev/null)
    [ -n "$stamp" ] && touch -t "$stamp" "$ref" 2>/dev/null
    skip='(^|/)(node_modules|\.venv|venv|\.git|__pycache__|\.mypy_cache|\.ruff_cache|\.pytest_cache|\.cache|dist|build|target|\.next|\.turbo|coverage)/?$'
    found=$(git ls-files --others --ignored --exclude-standard --directory 2>/dev/null \
      | grep -Ev "$skip" \
      | while IFS= read -r entry; do
          [ -n "$entry" ] || continue
          if [ -d "$entry" ]; then
            find "$entry" -maxdepth 4 -type f -newer "$ref" \
              -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/__pycache__/*' \
              -not -path '*/.git/*' 2>/dev/null
          elif [ -f "$entry" ] && [ "$entry" -nt "$ref" ]; then
            printf '%s\n' "$entry"
          fi
        done | head -20)
    rm -f "$ref"
    if [ -n "$found" ]; then
      echo "ignored files changed after the last commit (not in git; the compact message must point at them):"
      printf '%s\n' "$found" | sed 's/^/  /'
    fi
  fi
fi
exit 0
