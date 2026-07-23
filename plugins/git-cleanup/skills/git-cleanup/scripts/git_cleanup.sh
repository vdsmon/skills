#!/usr/bin/env bash
# git_cleanup.sh — Analyze and remove merged branches + their worktrees
#
# Usage:
#   git_cleanup.sh [--dry-run]
#
# By default, removes merged branches and clean worktrees (skips dirty ones).
# Merge detection is ancestry-based (git branch --merged) plus, on GitHub
# remotes with gh available, squash-aware: a branch whose tip equals the head
# SHA of a merged PR counts as merged.
# --dry-run: Only show what would be removed/kept, without changing anything.

set -euo pipefail

DRY_RUN=false
EXCLUDE_CSV=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --exclude=*) EXCLUDE_CSV="${arg#--exclude=}" ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Branches the user wants kept out of REMOVE regardless of merge/clean status.
declare -A EXCLUDE_SET
if [[ -n "$EXCLUDE_CSV" ]]; then
  IFS=',' read -ra _ex <<< "$EXCLUDE_CSV"
  for e in "${_ex[@]}"; do
    e="$(echo "$e" | xargs)"
    [[ -n "$e" ]] && EXCLUDE_SET[$e]=1
  done
fi

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

# Squash and rebase merges never make a branch tip an ancestor of the target,
# leaving `git branch --merged` permanently blind to them. When origin is a
# GitHub repo and gh is available, also count a branch as merged if its tip
# equals the head SHA of a merged PR. A tip that moved past the merged PR head
# means post-merge work, so that branch stays in KEEP.
declare -A SQUASH_PR  # branch -> merged PR number
if command -v gh >/dev/null 2>&1 && git remote get-url origin 2>/dev/null | grep -qi 'github'; then
  while IFS=$'\t' read -r name oid num; do
    [[ -z "$name" || -z "$oid" ]] && continue
    tip=$(git rev-parse --verify --quiet "refs/heads/$name") || continue
    [[ "$tip" == "$oid" ]] && SQUASH_PR[$name]="$num"
  done < <(gh pr list --state merged --limit 300 --json headRefName,headRefOid,number \
    --template '{{range .}}{{.headRefName}}{{"\t"}}{{.headRefOid}}{{"\t"}}{{.number}}{{"\n"}}{{end}}' 2>/dev/null)
fi

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
EXCLUDED=()           # merged but kept out by --exclude

for branch in "${ALL_BRANCHES[@]}"; do
  wt_path=$(worktree_for_branch "$branch")

  if [[ -n "${MERGED_INTO[$branch]+_}" || -n "${SQUASH_PR[$branch]+_}" ]]; then
    # Branch is merged
    if [[ "$branch" == "$CURRENT_BRANCH" ]]; then
      SKIP_CURRENT="$branch"
      continue
    fi

    if [[ -n "${EXCLUDE_SET[$branch]+_}" ]]; then
      EXCLUDED+=("$branch")
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
    branch="${REMOVE_BRANCHES[$i]}"
    wt="${REMOVE_WORKTREES[$i]}"
    via=""
    [[ -n "${SQUASH_PR[$branch]+_}" ]] && via="  (squash-merged: PR #${SQUASH_PR[$branch]})"
    if [[ -n "$wt" ]]; then
      echo "  - $branch$via  (worktree: $wt)"
    else
      echo "  - $branch$via"
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

if [[ ${#EXCLUDED[@]} -gt 0 ]]; then
  echo "EXCLUDED (kept by request):"
  printf '  - %s\n' "${EXCLUDED[@]}"
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

  removed_wt=0
  deleted_br=0
  FAILED=()

  # A single removal failure must not abort the whole batch, so drop -e/pipefail
  # for the loop and isolate each item explicitly.
  set +e
  set +o pipefail

  for i in "${!REMOVE_BRANCHES[@]}"; do
    branch="${REMOVE_BRANCHES[$i]}"
    wt="${REMOVE_WORKTREES[$i]}"

    if [[ -n "$wt" ]]; then
      echo "Removing worktree: $wt"
      # --force is required on macOS: Finder drops .DS_Store into worktree dirs,
      # so plain `git worktree remove` fails with "Directory not empty". These
      # worktrees are already verified clean, so --force discards nothing of value.
      git worktree remove --force "$wt" 2>/dev/null
      # git de-registers the worktree even when the dir survives: leftover
      # untracked files, or read-only files (content-addressed store blobs,
      # immutable caches) in read-only dirs that neither `git worktree remove`
      # nor plain `rm` can unlink. Restore write perms across the tree first,
      # then nuke it; retry once for nested copies.
      if [[ -d "$wt" ]]; then
        chmod -R u+w "$wt" 2>/dev/null
        rm -rf "$wt" 2>/dev/null
        rm -rf "$wt" 2>/dev/null
      fi
      if [[ -d "$wt" ]]; then
        FAILED+=("worktree: $wt")
      else
        removed_wt=$((removed_wt + 1))
      fi
    fi

    # The branch can only be deleted after its worktree is gone — git refuses to
    # delete a branch still checked out in a registered worktree.
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      echo "Deleting branch: $branch"
      # A squash-merged branch is never an ancestor of the target and -d refuses
      # it; the PR-state check already proved its content is merged, making -D
      # safe. Ancestry-merged branches keep -d as a safety belt.
      del="-d"
      [[ -n "${SQUASH_PR[$branch]+_}" ]] && del="-D"
      if git branch "$del" "$branch" >/dev/null 2>&1; then
        deleted_br=$((deleted_br + 1))
      else
        FAILED+=("branch: $branch")
      fi
    fi
    echo ""
  done

  set -euo pipefail

  git worktree prune
  echo "Done! Deleted $deleted_br branch(es), removed $removed_wt worktree(s)."
  if [[ ${#FAILED[@]} -gt 0 ]]; then
    echo ""
    echo "FAILED (needs manual cleanup):"
    printf '  - %s\n' "${FAILED[@]}"
    exit 1
  fi
fi
