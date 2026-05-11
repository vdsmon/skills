#!/usr/bin/env bash
# build-dispatch-prompt.sh — construct subagent prompt for tasks:orchestrate
#
# Usage: build-dispatch-prompt.sh <story-file> <agent-type> [--retry]
#
#   <story-file>   path to tasks/T<NN>-<slug>.md
#   <agent-type>   cavecrew-builder | general-purpose
#   --retry        re-inject ONLY the latest ## Retry notes entry
#                  (last ### subheading) inline in the contract
#
# Strips ## Human handoff / ## Blocker / ## Retry notes (H2-or-EOF
# boundary). Prepends the per-agent contract. Prints to stdout.
#
# Pass the stdout as the `prompt` argument to the Agent tool call.
# Hand-stitching the prompt is an anti-pattern (H2-boundary detection
# errors and stale Blocker/Retry leakage are recurrent failure modes).

set -euo pipefail

STORY=${1:?usage: build-dispatch-prompt.sh <story-file> <agent-type> [--retry]}
AGENT=${2:?usage: build-dispatch-prompt.sh <story-file> <agent-type> [--retry]}
RETRY=${3:-}

[ -f "$STORY" ] || { echo "ERROR: story file not found: $STORY" >&2; exit 2; }

case "$AGENT" in
  cavecrew-builder)
    CONTRACT='CONTRACT: Leave frontmatter as `pending`. Do NOT commit. Parent handles acceptance + commit. Edit only files listed in `## Files`.'
    ;;
  general-purpose)
    CONTRACT='CONTRACT: Run every `## Acceptance` command. On pass, flip frontmatter `status: pending` -> `status: done` + commit with subject `T<NN>: <slug>`. Parent re-verifies; do not lie about acceptance results.'
    ;;
  *)
    echo "ERROR: unknown agent-type: $AGENT (expected: cavecrew-builder | general-purpose)" >&2
    exit 2
    ;;
esac

# Extract LATEST Retry notes entry (last ### block within the section)
LATEST_RETRY=""
if [ "$RETRY" = "--retry" ]; then
  LATEST_RETRY=$(awk '
    /^## Retry notes/      { in_section=1; next }
    in_section && /^## /   { in_section=0 }
    in_section             { print }
  ' "$STORY" | awk '
    /^### /  { buf=""; capture=1 }
    capture  { buf = buf $0 "\n" }
    END      { printf "%s", buf }
  ')
fi

# Strip ## Human handoff / ## Blocker / ## Retry notes (H2-or-EOF bounded)
BODY=$(awk '
  /^## (Human handoff|Blocker|Retry notes)/ { skip=1; next }
  skip && /^## /                            { skip=0 }
  !skip
' "$STORY")

# Emit
printf '%s\n\n' "$CONTRACT"
if [ -n "$LATEST_RETRY" ]; then
  printf 'PRIOR-RETRY CONTEXT (latest entry from ## Retry notes, inlined per skill spec):\n\n%s\n' "$LATEST_RETRY"
fi
printf 'Story (verbatim, ## Human handoff / ## Blocker / ## Retry notes excised):\n\n%s\n' "$BODY"
