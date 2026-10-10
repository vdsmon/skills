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

# The prompt and the current-name line, read from the mod so the eval tests what ships.
read_prompt() {
  python3 - "$here/../../plugins/cc-autotitle/hooks/register.ts" "$1" <<'EOF'
import re, sys
src, current = open(sys.argv[1]).read(), sys.argv[2]
text = re.search(r"const PROMPT = `(.*?)`", src, re.S).group(1)
if current:
    line = re.search(r"parts\.push\(`(The session is now named \$\{current\}[^`]*)`\)", src).group(1)
    text += "\n\n" + line.replace("${current}", current)
print(text)
EOF
}

# case:fixture:current name ('' for a first name)
cases=(
  "drift:drift:"
  "split:split:"
  "portuguese:portuguese:"
  "keep:drift:pr-31-feed-cursor-fix"
  "move:drift:ruff-e501-per-file-ignores"
)

for spec in "${cases[@]}"; do
  IFS=: read -r case fixture current <<<"$spec"
  prompt="$(read_prompt "$current")"
  for n in $(seq 1 "$runs"); do
    printf '%s\n\n---\n\n%s\n' "$(cat "$here/fixtures/$fixture.md")" "$prompt" |
      (cd "$out" && command claude -p --model "$model") > "$out/$case-$n.txt" 2>&1 &
  done
done
wait
python3 "$here/grade.py" "$out"
exit 0
