#!/usr/bin/env bash
# Asks the cc-autotitle fork prompt after each fixture, the way the fork asks it
# after the session, and grades the replies. Spends tokens.
# Usage: evals/autotitle/run.sh <out-dir> [runs-per-case] [model]
set -u
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?out dir}"
runs="${2:-3}"
model="${3:-opus}"
mkdir -p "$out"

# The prompt plus its hint or current-name line, read from the mod so the eval tests what ships.
read_prompt() {
  python3 "$here/prompt.py" "$here/../../plugins/cc-autotitle/hooks/register.ts" "$1" "$2"
}

# case:fixture:current name:hint ('' for none)
cases=(
  "drift:drift::"
  "split:split::"
  "portuguese:portuguese::"
  "keep:drift:pr-31-feed-cursor-fix:"
  "move:drift:ruff-e501-per-file-ignores:"
  "hint:drift:pr-31-feed-cursor-fix:focus on the ruff question"
)

for spec in "${cases[@]}"; do
  IFS=: read -r case fixture current hint <<<"$spec"
  prompt="$(read_prompt "$current" "$hint")"
  for n in $(seq 1 "$runs"); do
    printf '%s\n\n---\n\n%s\n' "$(cat "$here/fixtures/$fixture.md")" "$prompt" |
      (cd "$out" && command claude -p --model "$model") > "$out/$case-$n.txt" 2> "$out/$case-$n.err" &
  done
done
wait
python3 "$here/grade.py" "$out"
exit 0
