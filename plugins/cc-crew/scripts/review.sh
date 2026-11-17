#!/usr/bin/env bash
# Ask the reviewer (Codex, model $REVIEW_MODEL) for a read-only review of a clean copy.
#
#   review.sh plan <plan-file> [<out-dir>]
#   review.sh grilling <plan-file> [<out-dir>]
#   review.sh diff <plan-file|purpose-file> <repo> <base> <head> [<out-dir>]
#   review.sh follow-up <folder> <question-file>
#
# A read is judged against the plan file's "## Principle" section. A grilling whose
# principle is not proposed yet is read against "## What this is for", and a diff
# with no plan takes a file that holds one sentence on what the change is for. plan,
# grilling and diff make a fresh folder under <out-dir>, by default reviews/ beside
# their first file; follow-up asks again in one. The last line of stdout is the
# answer file's path on exit 0, and on exit 3, when Codex refused for usage (limit
# or quota), the folder that holds what the fallback reviewer reads. Exit 4: any
# other failure, with the log tail on stderr. A plan, diff or grilling answer ends
# with the crew's reminder, which is not the reviewer's.
set -u
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
REVIEW_MODEL=${REVIEW_MODEL:-gpt-6.2-astra}
# The line in a prompt template that the principle replaces.
PRINCIPLE_TOKEN='{{PRINCIPLE}}'
# What record.py writes under "## Principle" until the grilling proposes one.
NO_PRINCIPLE='Not proposed yet.'

fail() { echo "review.sh: $*" >&2; exit 4; }

usage() {
  sed -n '4,7p' "$0" | sed 's/^#  *//' >&2
  exit 4
}

readable() { [ -f "$1" ] && [ -r "$1" ] || fail "cannot read $2: $1"; }

new_folder() { # <out-dir> <kind>
  mkdir -p "$1" || fail "cannot create $1"
  local d
  d=$(mktemp -d "$1/$2-$(date +%Y%m%d-%H%M%S).XXXXXX") || fail "cannot create a folder under $1"
  cd "$d" && pwd -P
}

# Prints the body of a plan file's "## <title>" section, without its blank edges.
section() { # <file> <title>
  awk -v want="## $2" '
    /^[[:space:]]*(```|~~~)/ { fenced = !fenced }
    !fenced && /^## / { h = $0; sub(/[[:space:]]+$/, "", h); on = (h == want); next }
    on { buf[++n] = $0; if ($0 ~ /[^[:space:]]/) { if (!first) first = n; last = n } }
    END { for (i = first; first && i <= last; i++) print buf[i] }
  ' "$1"
}

# Prints what a read is judged against: the principle of a plan file, or, for a
# diff with no plan, the whole of a file that has no "## Principle" heading.
principle_of() { # <plan|grilling|diff> <file>
  local kind=$1 file=$2 text
  if ! grep -q '^## Principle[[:space:]]*$' "$file"; then
    [ "$kind" = diff ] || fail "$file has no \"## Principle\" section"
    cat "$file" || fail "cannot read $file"
    return
  fi
  text=$(section "$file" Principle)
  if [ "$kind" = grilling ] && { [ -z "$text" ] || [ "$text" = "$NO_PRINCIPLE" ]; }; then
    text=$(section "$file" 'What this is for')
    [ -n "$text" ] || fail "$file proposes no principle and says nothing under \"## What this is for\""
  fi
  { [ -n "$text" ] && [ "$text" != "$NO_PRINCIPLE" ]; } || fail "$file proposes no principle yet"
  printf '%s\n' "$text"
}

# Splits on the token instead of sed or ${//}: the principle may hold & / or \.
build_prompt() { # <template-name> <principle-file> <folder>
  local tpl_file="$here/$1" tpl principle
  readable "$tpl_file" "prompt template"
  tpl=$(cat "$tpl_file") || fail "cannot read $tpl_file"
  principle=$(cat "$2") || fail "cannot read $2"
  case $tpl in
    *"$PRINCIPLE_TOKEN"*) ;;
    *) fail "$tpl_file has no $PRINCIPLE_TOKEN line; refusing to send a prompt without the principle" ;;
  esac
  printf '%s%s%s\n' "${tpl%%"$PRINCIPLE_TOKEN"*}" "$principle" "${tpl#*"$PRINCIPLE_TOKEN"}" > "$3/prompt.md" \
    || fail "cannot write $3/prompt.md"
}

# Closes an answer with the weighing the chief engineer owes each objection. It
# goes here because this file is where a fix gets decided: the same rule, always in
# view in the role text, was skipped at exactly this moment.
add_reminder() { # <folder>
  local folder=$1 kind d n=0
  kind=$(basename "$folder"); kind=${kind%%-*}
  # A grilling's objections go to the user as questions, not to a fix, and a grilling
  # has no rounds of fixes to count.
  if [ "$kind" = grilling ]; then
    printf '\n---\n\nFrom the review script, not the reviewer. Weigh each objection before it reaches Victor: one that a fact settles gets one line naming the fact; the rest go to him as questions, in the reviewer'"'"'s own words.\n' \
      >> "$folder/answer.md" || fail "cannot write the reminder into $folder/answer.md"
    return
  fi
  # Reads of one change share an output folder and a principle; another change
  # reviewed into the same output folder has its own principle.
  for d in "$(dirname "$folder")/$kind"-*; do
    [ -s "$d/answer.md" ] && cmp -s "$d/principle.md" "$folder/principle.md" && n=$((n + 1))
  done
  {
    printf '\n---\n\nFrom the review script, not the reviewer. Before you fix anything above, write one line per blocker: was the failure ever seen or only constructed, where else does the same mechanism live, would the design built from scratch keep the fix. Then fix it, decline it in one line, or take it to Victor.\n'
    [ "$n" -lt 2 ] || printf '\nThis is read %s of this change. A blocker on a spot you already fixed is a stop: change the design or drop the fix.\n' "$n"
  } >> "$folder/answer.md" || fail "cannot write the reminder into $folder/answer.md"
}

# Runs one read-only Codex session in <folder> and exits with the script's code.
# With a fifth argument, a good answer gets the reminder.
run_codex() { # <folder> <answer-file> <log-file> <prompt> [remind]
  local folder=$1 answer=$2 log=$3 prompt=$4 rc sid refusal
  codex exec -C "$folder" --skip-git-repo-check --sandbox read-only \
    -m "$REVIEW_MODEL" -c model_reasoning_effort='"high"' --color never \
    -o "$answer" "$prompt" </dev/null >"$log" 2>&1
  rc=$?

  # Informational only: follow-ups start a fresh session (see cmd_follow_up).
  sid=$(sed -n 's/^session id: *//p' "$log" | head -n 1)
  [ -n "$sid" ] && [ ! -e "$folder/session-id" ] && printf '%s\n' "$sid" > "$folder/session-id"

  if [ "$rc" -eq 0 ] && [ -s "$answer" ]; then
    [ -z "${5:-}" ] || add_reminder "$folder"
    printf '%s\n' "$answer"
    exit 0
  fi

  # Judge only Codex's last error line, skipping lines the prompt itself holds: the
  # log also echoes the prompt and whatever the reviewer read, and either may quote
  # a usage message. Wording from the strings of codex-cli 0.167.2.
  refusal=$(printf '%s\n' "$prompt" | grep -vxFf - "$log" | grep -E '^(\[[^]]*\] *)?ERROR:' | tail -n 1 \
    | grep -iE "usage limit|usage_limit_reached|usage_not_included|quota exceeded|insufficient_quota|upgrade to plus")
  if [ -n "$refusal" ]; then
    echo "review.sh: Codex refused for usage:" >&2
    printf '%s\n' "$refusal" >&2
    printf '%s\n' "$folder"
    exit 3
  fi

  if [ "$rc" -eq 0 ]; then
    echo "review.sh: Codex exited 0 but $answer is missing or empty. Log tail ($log):" >&2
  else
    echo "review.sh: Codex exited $rc. Log tail ($log):" >&2
  fi
  tail -n 30 "$log" >&2
  exit 4
}

# A grilling's record and a plan are one file at two moments, read with different
# prompts under the name each prompt uses.
cmd_plan_file() { # <plan|grilling> <name-in-folder> <plan-file> [<out-dir>]
  local kind=$1 name=$2 principle folder
  shift 2
  { [ $# -ge 1 ] && [ $# -le 2 ]; } || usage
  readable "$1" "plan file"
  principle=$(principle_of "$kind" "$1") || exit 4
  folder=$(new_folder "${2:-$(dirname "$1")/reviews}" "$kind") || exit 4
  { printf '%s\n' "$principle" > "$folder/principle.md" && cp "$1" "$folder/$name"; } || fail "cannot copy into $folder"
  build_prompt "review-prompt-$kind.md" "$folder/principle.md" "$folder"
  run_codex "$folder" "$folder/answer.md" "$folder/codex.log" "$(cat "$folder/prompt.md")" remind
}

cmd_diff() {
  { [ $# -ge 4 ] && [ $# -le 5 ]; } || usage
  local repo=$2 base=$3 head=$4 out=${5:-$(dirname "$1")/reviews} principle base_sha head_sha fork_sha upstream up_fork folder
  readable "$1" "plan or purpose file"
  principle=$(principle_of diff "$1") || exit 4
  base_sha=$(git -C "$repo" rev-parse --verify --quiet "$base^{commit}") || fail "not a commit in $repo: $base"
  head_sha=$(git -C "$repo" rev-parse --verify --quiet "$head^{commit}") || fail "not a commit in $repo: $head"
  # Diff from where the branch left <base>, not from <base> as it is now: work
  # that landed on <base> since would otherwise read as deleted by the change.
  fork_sha=$(git -C "$repo" merge-base "$base_sha" "$head_sha") || fail "no common ancestor of $base and $head in $repo"
  # A local <base> that is behind its upstream puts that fork too early for a branch
  # cut from the upstream: the diff would carry work that has already landed there.
  if upstream=$(git -C "$repo" rev-parse --abbrev-ref --verify --quiet "$base@{upstream}" 2>/dev/null) && [ -n "$upstream" ]; then
    up_fork=$(git -C "$repo" merge-base "$upstream" "$head_sha" 2>/dev/null) || up_fork=$fork_sha
    if [ "$up_fork" != "$fork_sha" ] && git -C "$repo" merge-base --is-ancestor "$fork_sha" "$up_fork"; then
      fail "$base is behind $upstream, and $head left $upstream later than it left $base: pass $upstream as the base"
    fi
  fi
  folder=$(new_folder "$out" diff) || exit 4
  printf '%s\n' "$principle" > "$folder/principle.md" || fail "cannot write into $folder"
  # Objects only, never the working tree: archive the commit, diff two commits, and
  # take .gitattributes from <head>, not from whatever the checkout holds.
  mkdir "$folder/tree" || fail "cannot create $folder/tree"
  git -C "$repo" archive --format=tar "$head_sha" | tar -x -C "$folder/tree" \
    || fail "cannot archive $head ($head_sha) from $repo"
  git -C "$repo" --attr-source="$head_sha" diff --no-ext-diff --no-textconv --no-color "$fork_sha" "$head_sha" > "$folder/diff.patch" \
    || fail "cannot diff $base...$head in $repo"
  printf 'base %s %s\nfork %s\nhead %s %s\n' "$base" "$base_sha" "$fork_sha" "$head" "$head_sha" > "$folder/revs.txt"
  build_prompt review-prompt-diff.md "$folder/principle.md" "$folder"
  run_codex "$folder" "$folder/answer.md" "$folder/codex.log" "$(cat "$folder/prompt.md")" remind
}

# `codex exec resume` takes no --sandbox flag, so nothing shows it stays read-only.
# A follow-up is a fresh read-only session that reads the earlier turns as files.
cmd_follow_up() {
  [ $# -eq 2 ] || usage
  local folder question=$2 n=2 i earlier=answer.md prompt
  folder=$(cd "$1" 2>/dev/null && pwd -P) || fail "no such folder: $1"
  { [ -f "$folder/prompt.md" ] && [ -s "$folder/answer.md" ]; } || fail "not a review folder with an answer: $folder"
  readable "$question" "question file"
  # A failed follow-up leaves no answer, so asking again reuses its number.
  while [ -s "$folder/answer-$n.md" ]; do n=$((n + 1)); done
  cp "$question" "$folder/question-$n.md" || fail "cannot copy into $folder"
  for ((i = 2; i < n; i++)); do earlier="$earlier, question-$i.md, answer-$i.md"; done
  prompt="This is a follow-up to a review you gave in this folder. The original request is in prompt.md; the earlier turns, in order, are $earlier. Read them first, then answer the question below (also saved as question-$n.md). Stay a reviewer: read, do not change anything.

$(cat "$question")"
  run_codex "$folder" "$folder/answer-$n.md" "$folder/codex-$n.log" "$prompt"
}

case ${1:-} in
  plan) shift; cmd_plan_file plan plan.md "$@" ;;
  grilling) shift; cmd_plan_file grilling record.md "$@" ;;
  diff) shift; cmd_diff "$@" ;;
  follow-up) shift; cmd_follow_up "$@" ;;
  *) usage ;;
esac
