#!/usr/bin/env bash
# Ask the reviewer (Codex, model $REVIEW_MODEL) for a read-only review of a clean copy.
#
#   review.sh plan <principle-file> <plan-file> <out-dir>
#   review.sh diff <principle-file> <repo> <base> <head> <out-dir>
#   review.sh follow-up <folder> <question-file>
#
# plan and diff make a fresh folder under <out-dir>; follow-up asks again in one.
# Exit 0: the answer file's path is the last line of stdout. Exit 3: Codex refused
# for usage (limit or quota). Exit 4: any other failure, with the log tail on stderr.
# A plan or diff answer ends with the crew's reminder, which is not the reviewer's.
set -u
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
REVIEW_MODEL=${REVIEW_MODEL:-gpt-6-astra}
# The line in Work 1's templates that the principle file replaces.
PRINCIPLE_TOKEN='{{PRINCIPLE}}'

fail() { echo "review.sh: $*" >&2; exit 4; }

usage() {
  sed -n '4,6p' "$0" | sed 's/^#  *//' >&2
  exit 4
}

readable() { [ -f "$1" ] && [ -r "$1" ] || fail "cannot read $2: $1"; }

new_folder() { # <out-dir> <kind>
  mkdir -p "$1" || fail "cannot create $1"
  local d
  d=$(mktemp -d "$1/$2-$(date +%Y%m%d-%H%M%S).XXXXXX") || fail "cannot create a folder under $1"
  cd "$d" && pwd -P
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

# Closes a plan or diff answer with the weighing the chief engineer owes each
# blocker. It goes here because this file is where a fix gets decided: the same
# rule, always in view in the role text, was skipped at exactly this moment.
add_reminder() { # <folder>
  local folder=$1 kind d n=0
  kind=$(basename "$folder"); kind=${kind%%-*}
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

cmd_plan() {
  [ $# -eq 3 ] || usage
  readable "$1" "principle file"
  readable "$2" "plan file"
  local folder
  folder=$(new_folder "$3" plan) || exit 4
  { cp "$1" "$folder/principle.md" && cp "$2" "$folder/plan.md"; } || fail "cannot copy into $folder"
  build_prompt review-prompt-plan.md "$1" "$folder"
  run_codex "$folder" "$folder/answer.md" "$folder/codex.log" "$(cat "$folder/prompt.md")" remind
}

cmd_diff() {
  [ $# -eq 5 ] || usage
  local principle=$1 repo=$2 base=$3 head=$4 out=$5 base_sha head_sha fork_sha upstream up_fork folder
  readable "$principle" "principle file"
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
  cp "$principle" "$folder/principle.md" || fail "cannot copy into $folder"
  # Objects only, never the working tree: archive the commit, diff two commits, and
  # take .gitattributes from <head>, not from whatever the checkout holds.
  mkdir "$folder/tree" || fail "cannot create $folder/tree"
  git -C "$repo" archive --format=tar "$head_sha" | tar -x -C "$folder/tree" \
    || fail "cannot archive $head ($head_sha) from $repo"
  git -C "$repo" --attr-source="$head_sha" diff --no-ext-diff --no-textconv --no-color "$fork_sha" "$head_sha" > "$folder/diff.patch" \
    || fail "cannot diff $base...$head in $repo"
  printf 'base %s %s\nfork %s\nhead %s %s\n' "$base" "$base_sha" "$fork_sha" "$head" "$head_sha" > "$folder/revs.txt"
  build_prompt review-prompt-diff.md "$principle" "$folder"
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
  plan) shift; cmd_plan "$@" ;;
  diff) shift; cmd_diff "$@" ;;
  follow-up) shift; cmd_follow_up "$@" ;;
  *) usage ;;
esac
