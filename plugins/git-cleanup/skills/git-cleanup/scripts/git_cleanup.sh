#!/usr/bin/env bash
# git_cleanup.sh: analyze and remove merged branches + their worktrees
#
# Usage:
#   git_cleanup.sh [--dry-run] [--exclude=a,b]
#
# By default, removes merged branches and clean worktrees (skips dirty ones).
# Merge detection is ancestry-based (git branch --merged) plus, on GitHub
# remotes with gh available, squash-aware: a branch whose tip equals the head
# SHA of a merged PR, or whose net diff has the same patch-id as the PR's merge
# commit, counts as merged.
# --dry-run: Only show what would be removed/kept, without changing anything.

((BASH_VERSINFO[0] >= 4)) || { echo "git-cleanup needs bash 4+ (brew install bash)" >&2; exit 2; }

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

# substr, not $2: a worktree path with spaces must come back whole, or the
# execute loop would act on a truncated path.
worktree_for_branch() {
  local branch="$1"
  git worktree list --porcelain | awk -v b="$branch" '
    /^worktree / { wt=substr($0, 10) }
    /^branch refs\/heads\// {
      sub(/^branch refs\/heads\//, "")
      if ($0 == b) print wt
    }
  '
}

# The first entry of `git worktree list` is always the main worktree. git
# refuses to remove it, so it must never reach the rm -rf fallback.
main_worktree() {
  git worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }'
}

is_registered_worktree() {
  git worktree list --porcelain | P="worktree $1" awk '$0 == ENVIRON["P"] { f=1 } END { exit !f }'
}

# A path that exists but where git status fails is treated as dirty: unknown
# state is never removed.
worktree_is_dirty() {
  local wt_path="$1" out
  [[ -d "$wt_path" ]] || return 1
  out=$(git -C "$wt_path" status --porcelain 2>/dev/null) || return 0
  [[ -n "$out" ]]
}

# git patch-id only emits an id for input that starts with a commit header.
# diff-tree, not diff: porcelain `git diff` obeys user config (diff.external,
# diff.noprefix, color.ui=always) that turns the output into something
# patch-id cannot read, and every patch-id match would silently fail.
net_patch_id() {
  local from="$1" to="$2"
  { echo "commit $to"; git diff-tree -p -r "$from" "$to"; } | git patch-id --stable | awk '{ print $1 }'
}

# --- Main ---

echo "Fetching and pruning remotes..."
git fetch --all --prune 2>/dev/null || echo "WARN: fetch failed, using cached remote refs" >&2

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
MAIN_WT=$(main_worktree)

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
# equals the head SHA of a merged PR, or, when the PR branch was rewritten
# before merge, if the branch's net diff has the same patch-id as the PR's
# merge commit. A tip with changes the PR never had stays in KEEP.
declare -A SQUASH_PR     # branch -> merged PR number
declare -A SQUASH_BY_ID  # branch -> 1 when matched by patch-id, not tip
declare -A PR_DIFFERS    # branch -> merged PR number whose content differs
if command -v gh >/dev/null 2>&1 && git remote get-url origin 2>/dev/null | grep -qi 'github'; then
  while IFS=$'\t' read -r name oid num merge; do
    [[ -z "$name" || -z "$oid" ]] && continue
    [[ -n "${SQUASH_PR[$name]+_}" ]] && continue
    tip=$(git rev-parse --verify --quiet "refs/heads/$name") || continue
    if [[ "$tip" == "$oid" ]]; then
      SQUASH_PR[$name]="$num"
      unset "PR_DIFFERS[$name]"
      continue
    fi
    if [[ -n "$merge" ]] && git cat-file -e "$merge^{commit}" 2>/dev/null \
      && base=$(git merge-base "$tip" "$merge^1" 2>/dev/null); then
      pr_id=$(net_patch_id "$merge^1" "$merge")
      tip_id=$(net_patch_id "$base" "$tip")
      if [[ -n "$pr_id" && "$pr_id" == "$tip_id" ]]; then
        SQUASH_PR[$name]="$num"
        SQUASH_BY_ID[$name]=1
        unset "PR_DIFFERS[$name]"
        continue
      fi
    fi
    [[ -z "${PR_DIFFERS[$name]+_}" ]] && PR_DIFFERS[$name]="$num"
  done < <(gh pr list --state merged --limit 300 --json headRefName,headRefOid,number,mergeCommit \
    --template '{{range .}}{{.headRefName}}{{"\t"}}{{.headRefOid}}{{"\t"}}{{.number}}{{"\t"}}{{if .mergeCommit}}{{.mergeCommit.oid}}{{end}}{{"\n"}}{{end}}' 2>/dev/null)
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
SKIP_MAIN=""          # merged but checked out in the main worktree
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

    if [[ -n "$wt_path" && "$wt_path" == "$MAIN_WT" ]]; then
      SKIP_MAIN="$branch"
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
    if [[ -n "${SQUASH_BY_ID[$branch]+_}" ]]; then
      via="  (squash-merged: PR #${SQUASH_PR[$branch]}, matched by patch-id)"
    elif [[ -n "${SQUASH_PR[$branch]+_}" ]]; then
      via="  (squash-merged: PR #${SQUASH_PR[$branch]})"
    fi
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

if [[ -n "$SKIP_MAIN" ]]; then
  echo "SKIP (checked out in main worktree):"
  echo "  - $SKIP_MAIN  (worktree: $MAIN_WT)"
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
    note=""
    [[ -n "${PR_DIFFERS[$branch]+_}" ]] && note="  (PR #${PR_DIFFERS[$branch]} merged, but this tip differs from what was merged)"
    wt_path=$(worktree_for_branch "$branch")
    if [[ -n "$wt_path" ]]; then
      echo "  - $branch$note  (worktree: $wt_path)"
    else
      echo "  - $branch$note"
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
  echo "Dry run: no changes made. Run without --dry-run to apply."
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
      if is_registered_worktree "$wt"; then
        # git refused (main or locked worktree): the dir is still in use, so
        # never fall through to rm -rf.
        FAILED+=("worktree: $wt (git refused to remove it)")
        echo ""
        continue
      fi
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

    # The branch can only be deleted after its worktree is gone: git refuses to
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
