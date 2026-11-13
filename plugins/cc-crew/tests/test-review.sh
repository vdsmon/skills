#!/usr/bin/env bash
# Offline checks for scripts/review.sh. A fake codex first on PATH records its
# arguments one file each and acts out the outcome named in FAKE_CODEX. review.sh is
# copied beside stand-in templates, so Work 1's real templates are never needed.
set -u
here=$(cd "$(dirname "$0")" && pwd)
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/review-test.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export HOME="$tmp" GIT_CONFIG_NOSYSTEM=1
unset REVIEW_MODEL

mkdir -p "$tmp/bin" "$tmp/scripts" "$tmp/out"
cp "$here/../scripts/review.sh" "$tmp/scripts/review.sh"
review="$tmp/scripts/review.sh"
printf 'Stand-in plan template: judge the plan.\n{{PRINCIPLE}}\nEnd of plan template.\n' > "$tmp/scripts/review-prompt-plan.md"
printf 'Stand-in diff template: judge the diff.\n{{PRINCIPLE}}\nEnd of diff template.\n' > "$tmp/scripts/review-prompt-diff.md"
# & and \ break naive sed or ${//} substitution.
printf 'Principle: R&D first, paths like C:\\tmp\\n stay literal.\n' > "$tmp/principle.md"
printf '# Plan\nBuild the thing.\n' > "$tmp/plan.md"
printf 'stdin that must not reach codex\n' > "$tmp/stdin-feed"

# Fake codex: one file per argument in $FAKE_ARGS/<call>/, then FAKE_CODEX decides.
cat > "$tmp/bin/codex" <<'EOF'
#!/usr/bin/env bash
n=$(( $(ls "$FAKE_ARGS" | wc -l) + 1 )); d="$FAKE_ARGS/$n"; mkdir -p "$d"
i=0; out=
for a in "$@"; do i=$((i + 1)); printf '%s' "$a" > "$d/$(printf %02d $i)"; done
prev=; for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
[ -t 0 ] && echo tty > "$d/stdin" || cat > "$d/stdin"
echo "OpenAI Codex (fake)"
echo "session id: 0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
echo "user"; echo "${@: -1}"
case $FAKE_CODEX in
  ok) printf 'The review.\n' > "$out"; exit 0 ;;
  empty) : > "$out"; exit 0 ;;
  usage) echo "ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again later."; exit 1 ;;
  fail) echo "ERROR: unexpected status 500 Internal Server Error"; exit 1 ;;
  crash) exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/codex"
export PATH="$tmp/bin:$PATH"

# run <outcome> <args...>: sets rc, last (stdout's last line), err, call (args dir).
run() {
  export FAKE_CODEX=$1 FAKE_ARGS="$tmp/args-$RANDOM$RANDOM"; shift
  mkdir -p "$FAKE_ARGS"
  # Stdin carries text, so a codex call that inherits it would record it.
  bash "$review" "$@" < "$tmp/stdin-feed" > "$tmp/stdout" 2> "$tmp/stderr"; rc=$?
  last=$(tail -n 1 "$tmp/stdout"); err=$(cat "$tmp/stderr"); call="$FAKE_ARGS/1"
}
# has_args <dir> <a> <b>: argument <a> is directly followed by <b>.
has_args() {
  local f prev=
  for f in "$1"/[0-9]*; do [ "$prev" = "$2" ] && [ "$(cat "$f")" = "$3" ] && return 0; prev=$(cat "$f"); done
  return 1
}
prompt_of() { cat "$(ls "$1"/[0-9]* | tail -n 1)"; }

echo "--- plan review: prompt, model, sandbox, answer"
run ok plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
folder=$(dirname "$last")
check "plan exits 0" '[ "$rc" -eq 0 ]'
check "last line is a non-empty answer.md" '[ "$(basename "$last")" = answer.md ] && [ -s "$last" ]'
check "folder holds principle and plan" 'cmp -s "$folder/principle.md" "$tmp/principle.md" && cmp -s "$folder/plan.md" "$tmp/plan.md"'
check "prompt carries the principle verbatim" 'prompt_of "$call" | grep -qF "R&D first, paths like C:\\tmp\\n stay literal."'
check "prompt carries the template text" 'prompt_of "$call" | grep -q "^Stand-in plan template: judge the plan.$" && prompt_of "$call" | grep -q "^End of plan template.$"'
check "token is gone from the prompt" '! prompt_of "$call" | grep -qF "{{PRINCIPLE}}"'
check "model defaults to gpt-6-astra" 'has_args "$call" -m gpt-6-astra'
check "sandbox is read-only" 'has_args "$call" --sandbox read-only'
check "reasoning effort high" "has_args \"\$call\" -c 'model_reasoning_effort=\"high\"'"
check "runs in the fresh folder" 'has_args "$call" -C "$folder"'
check "codex stdin is /dev/null" '[ ! -s "$call/stdin" ]'
check "session id saved" '[ "$(cat "$folder/session-id")" = 0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee ]'
check "answer keeps the review and ends with the script's reminder" 'head -n 1 "$last" | grep -qx "The review." && grep -q "^From the review script, not the reviewer\. Before you fix anything above" "$last"'
check "a first read says nothing about a second" '! grep -q "^This is read" "$last"'

echo "--- REVIEW_MODEL from the environment"
REVIEW_MODEL=other-model run ok plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
check "REVIEW_MODEL overrides the model" 'has_args "$call" -m other-model'
check "the same principle again is read 2, with the stop" 'grep -q "^This is read 2 of this change\. A blocker on a spot you already fixed is a stop" "$last"'

echo "--- follow-up: same folder, model and read-only sandbox again"
printf 'Why is step 2 risky?\n' > "$tmp/q.md"
run ok follow-up "$folder" "$tmp/q.md"
check "follow-up exits 0 with answer-2.md" '[ "$rc" -eq 0 ] && [ "$last" = "$folder/answer-2.md" ] && [ -s "$last" ]'
check "follow-up has the model" 'has_args "$call" -m gpt-6-astra'
check "a follow-up answer carries no reminder" '! grep -q "From the review script" "$last"'
check "follow-up is read-only" 'has_args "$call" --sandbox read-only'
check "follow-up is a plain exec, not a resume" '[ "$(cat "$call/01")" = exec ] && [ "$(cat "$call/02")" != resume ]'
check "follow-up prompt has the question and names the earlier answer" 'prompt_of "$call" | grep -q "Why is step 2 risky?" && prompt_of "$call" | grep -q "answer.md"'
run usage follow-up "$folder" "$tmp/q.md"
check "refused follow-up exits 3" '[ "$rc" -eq 3 ]'
run ok follow-up "$folder" "$tmp/q.md"
check "asking again after a refusal reuses number 3" '[ "$last" = "$folder/answer-3.md" ] && prompt_of "$call" | grep -q "answer-2.md"'
check "a relative folder still gives absolute paths" '(cd "$tmp" && bash "$review" follow-up "${folder#"$tmp"/}" q.md < "$tmp/stdin-feed" | tail -n 1 | grep -qx "$folder/answer-4.md")'

echo "--- failures"
run usage plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
check "usage refusal exits 3" '[ "$rc" -eq 3 ]'
check "usage refusal is reported" 'printf "%s" "$err" | grep -q "usage limit"'
run fail plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
check "other Codex failure exits 4 with the log tail" '[ "$rc" -eq 4 ] && printf "%s" "$err" | grep -q "500 Internal Server Error"'
run empty plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
check "empty answer exits 4, not 0" '[ "$rc" -eq 4 ]'
# The fake echoes the prompt into the log; a principle quoting a usage error must
# not turn a failure with no error line of its own into 3.
printf 'ERROR: You have hit your usage limit, said the old log.\n' > "$tmp/principle-usage.md"
run crash plan "$tmp/principle-usage.md" "$tmp/plan.md" "$tmp/out"
check "usage words echoed from the prompt still exit 4" '[ "$rc" -eq 4 ]'
# Refused, failed and empty reads above left no answer, and this principle is new here.
run ok plan "$tmp/principle-usage.md" "$tmp/plan.md" "$tmp/out"
check "another principle in the same output folder starts at read 1" '[ "$rc" -eq 0 ] && grep -q "^From the review script" "$last" && ! grep -q "^This is read" "$last"'
sed 's/{{PRINCIPLE}}/nothing/' "$tmp/scripts/review-prompt-plan.md" > "$tmp/notoken.md" && cp "$tmp/scripts/review-prompt-plan.md" "$tmp/keep.md" && cp "$tmp/notoken.md" "$tmp/scripts/review-prompt-plan.md"
run ok plan "$tmp/principle.md" "$tmp/plan.md" "$tmp/out"
check "template without the token exits 4 and never calls codex" '[ "$rc" -eq 4 ] && [ ! -e "$call" ]'
cp "$tmp/keep.md" "$tmp/scripts/review-prompt-plan.md"

echo "--- diff snapshot: tree of <head>, never the working tree"
repo="$tmp/repo"
git init -q -b main "$repo"
printf 'keep\n' > "$repo/keep.txt"; printf 'doomed\n' > "$repo/gone.txt"
git -C "$repo" add . && git -C "$repo" commit -q -m base
base=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" rm -q gone.txt && printf 'keep v2\n' > "$repo/keep.txt" && git -C "$repo" commit -q -am head
head=$(git -C "$repo" rev-parse HEAD)
# Dirty the checkout and move HEAD away from <head>.
printf 'later\n' > "$repo/later.txt" && git -C "$repo" add later.txt && git -C "$repo" commit -q -m later
printf 'dirty edit\n' > "$repo/keep.txt"; printf 'untracked\n' > "$repo/untracked.txt"; printf 'resurrected\n' > "$repo/gone.txt"
printf '*.txt -diff\n' > "$repo/.gitattributes"
run ok diff "$tmp/principle.md" "$repo" "$base" "$head" "$tmp/out"
dfolder=$(dirname "$last")
check "diff exits 0" '[ "$rc" -eq 0 ]'
check "tree holds <head>'s version of a changed file" '[ "$(cat "$dfolder/tree/keep.txt")" = "keep v2" ]'
check "deleted file is absent from the tree" '[ ! -e "$dfolder/tree/gone.txt" ]'
check "nothing from after <head> or the working tree" '[ ! -e "$dfolder/tree/later.txt" ] && [ ! -e "$dfolder/tree/untracked.txt" ] && [ ! -e "$dfolder/tree/.gitattributes" ]'
check "diff records the deletion as text despite the checkout's .gitattributes" 'grep -q "^deleted file mode" "$dfolder/diff.patch" && grep -q "^-doomed$" "$dfolder/diff.patch"'
check "diff prompt uses the diff template and principle" 'prompt_of "$call" | grep -q "^Stand-in diff template" && prompt_of "$call" | grep -qF "R&D first"'
check "diff runs read-only in the snapshot folder" 'has_args "$call" --sandbox read-only && has_args "$call" -C "$dfolder"'
run ok diff "$tmp/principle.md" "$repo" "$base" no-such-rev "$tmp/out"
check "unknown revision exits 4" '[ "$rc" -eq 4 ] && [ ! -e "$call" ]'
# <base> has moved on since the branch was cut: its newer work is not this change's deletion.
git clone -q "$repo" "$tmp/repo2"
git -C "$tmp/repo2" checkout -q -b moved "$base"
printf 'landed later\n' > "$tmp/repo2/movedon.txt" && git -C "$tmp/repo2" add movedon.txt && git -C "$tmp/repo2" commit -q -m "base moved on"
run ok diff "$tmp/principle.md" "$tmp/repo2" moved "$head" "$tmp/out"
mfolder=$(dirname "$last")
check "work that landed on <base> since is not shown as deleted" '[ "$rc" -eq 0 ] && ! grep -q "movedon.txt" "$mfolder/diff.patch" && grep -q "^-doomed$" "$mfolder/diff.patch"'

echo "--- a local <base> that is behind its upstream"
git clone -q "$repo" "$tmp/repo3"
printf 'landed on the remote\n' > "$repo/landed.txt" && git -C "$repo" add landed.txt && git -C "$repo" commit -q -m "landed on the remote"
git -C "$tmp/repo3" fetch -q origin
git -C "$tmp/repo3" checkout -q -b change origin/main
printf 'the change\n' > "$tmp/repo3/change.txt" && git -C "$tmp/repo3" add change.txt && git -C "$tmp/repo3" commit -q -m change
run ok diff "$tmp/principle.md" "$tmp/repo3" main change "$tmp/out"
check "a stale base is refused before codex runs, naming the upstream" '[ "$rc" -eq 4 ] && [ ! -e "$call" ] && printf "%s" "$err" | grep -q "pass origin/main as the base"'
run ok diff "$tmp/principle.md" "$tmp/repo3" origin/main change "$tmp/out"
ufolder=$(dirname "$last")
check "the upstream as base shows only the change" '[ "$rc" -eq 0 ] && grep -q "change.txt" "$ufolder/diff.patch" && ! grep -q "landed.txt" "$ufolder/diff.patch"'
git -C "$tmp/repo3" checkout -q -b old main
printf 'old work\n' > "$tmp/repo3/old.txt" && git -C "$tmp/repo3" add old.txt && git -C "$tmp/repo3" commit -q -m old
run ok diff "$tmp/principle.md" "$tmp/repo3" main old "$tmp/out"
check "a stale base is fine for a branch cut from it" '[ "$rc" -eq 0 ] && grep -q "old.txt" "$(dirname "$last")/diff.patch"'

if [ "$fail" -ne 0 ]; then echo "test-review: FAILED"; exit 1; fi
echo "test-review: all passed"
exit 0
