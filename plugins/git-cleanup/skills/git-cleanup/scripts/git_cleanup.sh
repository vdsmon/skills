#!/usr/bin/env bash
# git_cleanup.sh — Analyze and remove merged branches + their worktrees
#
# Usage:
#   git_cleanup.sh [--dry-run]
#
# By default, removes merged branches and clean worktrees (skips dirty ones).
# --dry-run: Only show what would be removed/kept, without changing anything.

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# --- Helpers ---

is_target_branch() {
  local branch="$1"
  [[ "$branch" == "dev" || "$branch" == "develop" || "$branch" == "master" || "$branch" == "main" ]]
}

worktree_for_branch() {
  local branch="$1"
  git worktree list --porcelain | awk -v b="$branch" '
    /^worktree / { wt=$2 }
    /^branch refs\/heads\// {
      sub(/^branch refs\/heads\//, "")
      if ($0 == b) print wt
    }
  '
}

worktree_is_dirty() {
  local wt_path="$1"
  [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]
}

# --- Main ---

echo "Fetching and pruning remotes..."
git fetch --all --prune 2>/dev/null

# Find target branches that exist on remote
TARGETS=()
for b in dev develop master main; do
  if git rev-parse --verify "origin/$b" &>/dev/null; then
    TARGETS+=("origin/$b")
  fi
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "ERROR: No target branches (dev/develop/master/main) found on remote."
  exit 1
fi

echo "Target branches: ${TARGETS[*]}"
echo ""

# Collect all local branches (except target branches and current branch)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")

declare -A MERGED_INTO  # branch -> target it's merged into

for target in "${TARGETS[@]}"; do
  while IFS= read -r raw; do
    branch=$(echo "$raw" | sed 's/^[+* ]*//' | xargs)
    [[ -z "$branch" ]] && continue
    is_target_branch "$branch" && continue
    # Store first target it's merged into
    if [[ -z "${MERGED_INTO[$branch]+_}" ]]; then
      MERGED_INTO[$branch]="$target"
    fi
  done < <(git branch --merged "$target" 2>/dev/null)
done

# Collect all local branches
ALL_BRANCHES=()
while IFS= read -r raw; do
  branch=$(echo "$raw" | sed 's/^[+* ]*//' | xargs)
  [[ -z "$branch" ]] && continue
  is_target_branch "$branch" && continue
  ALL_BRANCHES+=("$branch")
done < <(git branch 2>/dev/null)

# Deduplicate
ALL_BRANCHES=($(printf '%s\n' "${ALL_BRANCHES[@]}" | sort -u))

# Categorize
REMOVE_BRANCHES=()    # merged + clean worktree (or no worktree)
REMOVE_WORKTREES=()   # worktree paths to remove (parallel to REMOVE_BRANCHES)
SKIP_DIRTY=()         # merged but dirty worktree
SKIP_DIRTY_PATHS=()
SKIP_CURRENT=""
KEEP_UNMERGED=()      # not merged

for branch in "${ALL_BRANCHES[@]}"; do
  wt_path=$(worktree_for_branch "$branch")

  if [[ -n "${MERGED_INTO[$branch]+_}" ]]; then
    # Branch is merged
    if [[ "$branch" == "$CURRENT_BRANCH" ]]; then
      SKIP_CURRENT="$branch"
      continue
    fi

    if [[ -n "$wt_path" ]]; then
      if worktree_is_dirty "$wt_path"; then
        SKIP_DIRTY+=("$branch")
        SKIP_DIRTY_PATHS+=("$wt_path")
      else
        REMOVE_BRANCHES+=("$branch")
        REMOVE_WORKTREES+=("$wt_path")
      fi
    else
      REMOVE_BRANCHES+=("$branch")
      REMOVE_WORKTREES+=("")
    fi
  else
    KEEP_UNMERGED+=("$branch")
  fi
done

# --- Output ---

echo "=== PLAN ==="
echo ""

if [[ ${#REMOVE_BRANCHES[@]} -gt 0 ]]; then
  echo "REMOVE (merged, clean):"
  for i in "${!REMOVE_BRANCHES[@]}"; do
    wt="${REMOVE_WORKTREES[$i]}"
    if [[ -n "$wt" ]]; then
      echo "  - ${REMOVE_BRANCHES[$i]}  (worktree: $wt)"
    else
      echo "  - ${REMOVE_BRANCHES[$i]}"
    fi
  done
  echo ""
fi

if [[ ${#SKIP_DIRTY[@]} -gt 0 ]]; then
  echo "SKIP (merged but dirty worktree):"
  for i in "${!SKIP_DIRTY[@]}"; do
    echo "  - ${SKIP_DIRTY[$i]}  (worktree: ${SKIP_DIRTY_PATHS[$i]})"
  done
  echo ""
fi

if [[ -n "$SKIP_CURRENT" ]]; then
  echo "SKIP (current branch):"
  echo "  - $SKIP_CURRENT"
  echo ""
fi

if [[ ${#KEEP_UNMERGED[@]} -gt 0 ]]; then
  echo "KEEP (not merged):"
  for branch in "${KEEP_UNMERGED[@]}"; do
    wt_path=$(worktree_for_branch "$branch")
    if [[ -n "$wt_path" ]]; then
      echo "  - $branch  (worktree: $wt_path)"
    else
      echo "  - $branch"
    fi
  done
  echo ""
fi

if [[ ${#REMOVE_BRANCHES[@]} -eq 0 ]]; then
  echo "Nothing to clean up!"
  exit 0
fi

# --- Execute ---

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run — no changes made. Run without --dry-run to apply."
else
  echo "=== EXECUTING ==="
  echo ""

  for i in "${!REMOVE_BRANCHES[@]}"; do
    branch="${REMOVE_BRANCHES[$i]}"
    wt="${REMOVE_WORKTREES[$i]}"

    if [[ -n "$wt" ]]; then
      echo "Removing worktree: $wt"
      git worktree remove "$wt"
    fi

    echo "Deleting branch: $branch"
    git branch -d "$branch"
    echo ""
  done

  echo "Done! Removed ${#REMOVE_BRANCHES[@]} branch(es)."
fi
