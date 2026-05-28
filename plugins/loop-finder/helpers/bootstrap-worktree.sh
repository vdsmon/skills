#!/bin/bash
# Bootstrap a loop-finder variant worktree.
#
# Variant agents run this as their FIRST action after cd to worktree root.
# Solves the "worktree missing tools/ or pre-baseline src/" problem that
# bit 8+ variant agents in the cycle-1-through-4 dogfood:
#
# 1. Worktrees only contain tracked files. If orchestrator forgot to commit
#    tools/ or WIP main state, worktree is incomplete.
# 2. Variants need the SAME baseline as main has, not whatever older HEAD
#    the worktree branched from.
# 3. cargo workspace metadata (top-level Cargo.toml [workspace]) may be
#    missing from older HEADs.
#
# Usage from variant prompt:
#   "cd to worktree root, then run: bash <plugin-path>/helpers/bootstrap-worktree.sh"
#
# Idempotent. Safe to run multiple times.
#
# Optional env:
#   LOOPFINDER_MAIN_REF       which ref to sync from (default: main).
#   LOOPFINDER_PATHS          space-sep list of paths to checkout from main.
#                             Default: 'tools src Cargo.toml assets'

set -e

MAIN_REF="${LOOPFINDER_MAIN_REF:-main}"
SYNC_PATHS="${LOOPFINDER_PATHS:-tools src Cargo.toml assets}"

# Verify we're in a git worktree (not main checkout).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "bootstrap: not in a git work tree, aborting." >&2
  exit 1
fi

WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
cd "$WORKTREE_ROOT"

# Refuse to run in the main repo (this script is for worktrees only).
MAIN_GIT_DIR="$(git rev-parse --git-common-dir 2>/dev/null || git rev-parse --git-dir)"
THIS_GIT_DIR="$(git rev-parse --git-dir)"
if [ "$MAIN_GIT_DIR" = "$THIS_GIT_DIR" ]; then
  echo "bootstrap: running in the main checkout, not a worktree. Skipping (no harm)." >&2
  exit 0
fi

# Fetch main ref if needed (handles case where worktree was created before
# orchestrator committed WIP).
git fetch --quiet origin "$MAIN_REF" 2>/dev/null || true

# Resolve the ref. Prefer local main; fall back to origin/main.
if git rev-parse --verify --quiet "$MAIN_REF" >/dev/null; then
  REF="$MAIN_REF"
elif git rev-parse --verify --quiet "origin/$MAIN_REF" >/dev/null; then
  REF="origin/$MAIN_REF"
else
  echo "bootstrap: cannot resolve $MAIN_REF or origin/$MAIN_REF." >&2
  exit 1
fi

# For each declared sync path, checkout from the main ref if it exists there.
# This brings the worktree up to date with whatever the orchestrator
# committed before launching variants.
for path in $SYNC_PATHS; do
  if git ls-tree -r --name-only "$REF" -- "$path" 2>/dev/null | head -1 | grep -q .; then
    git checkout "$REF" -- "$path" 2>/dev/null && echo "bootstrap: synced $path from $REF"
  else
    echo "bootstrap: skipping $path (not in $REF)"
  fi
done

# Ensure Cargo.toml has [workspace] block if any subdir under tools/ has
# its own Cargo.toml. Older HEADs predate the workspace conversion.
if [ -f Cargo.toml ] && ! grep -q '^\[workspace\]' Cargo.toml; then
  for sub_cargo in tools/*/Cargo.toml; do
    if [ -f "$sub_cargo" ]; then
      member=$(dirname "$sub_cargo")
      echo "bootstrap: adding [workspace] block (member $member) to Cargo.toml"
      cat >> Cargo.toml <<-EOF

	[workspace]
	members = [".", "$member"]
EOF
      break
    fi
  done
fi

# Trust mise.toml if mise is present and the worktree's mise file is new.
if command -v mise >/dev/null && [ -f mise.toml ]; then
  mise trust 2>/dev/null || true
fi

echo "bootstrap: complete in $WORKTREE_ROOT"
