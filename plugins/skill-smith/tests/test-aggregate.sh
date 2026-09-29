#!/usr/bin/env bash
# Offline checks for the skill-smith benchmark aggregator and viewer. Their failure mode is
# silent: a reversed delta sign or zeroed time/tokens still renders a normal-looking report.
set -u
here=$(cd "$(dirname "$0")" && pwd)
skill="$here/../skills/skill-smith"
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
# jq-free JSON lookup: jget <file> <python expression over d>
jget() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$1"; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/skill-smith-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# run <dir> <passed> <total> <timing.json body> [grading timing block]
run() {
  mkdir -p "$1/outputs"
  echo "out" > "$1/outputs/result.txt"
  local rate; rate=$(python3 -c "print($2/$3)")
  printf '{"expectations":[{"text":"a","passed":true,"evidence":"e"}],"summary":{"passed":%s,"failed":%s,"total":%s,"pass_rate":%s}%s}\n' \
    "$2" "$(( $3 - $2 ))" "$3" "$rate" "${5:+,\"timing\":$5}" > "$1/grading.json"
  [ -n "$4" ] && echo "$4" > "$1/timing.json"
}

# Improve case: the baseline dir is old_skill, which sorts before with_skill.
a="$tmp/improve/iteration-1"
mkdir -p "$a/eval-1"
echo '{"eval_id":1,"eval_name":"fix-typo","prompt":"Fix the typo in notes.md","assertions":[]}' > "$a/eval-1/eval_metadata.json"
run "$a/eval-1/old_skill/run-1" 0 1 '{"total_tokens":1000,"duration_ms":5000}'
run "$a/eval-1/with_skill/run-1" 1 1 '{"total_tokens":2000,"duration_ms":8000}' '{"total_duration_seconds":8.0}'
python3 "$skill/scripts/aggregate_benchmark.py" "$a" --skill-name demo >/dev/null
bj="$a/benchmark.json"
check "improve: new version listed first" '[ "$(jget "$bj" "\",\".join(d[\"run_summary\"])")" = "with_skill,old_skill,delta" ]'
check "improve: delta is new minus baseline" '[ "$(jget "$bj" "d[\"run_summary\"][\"delta\"][\"pass_rate\"]")" = "+1.00" ]'
check "improve: tokens read when grading.json has timing" '[ "$(jget "$bj" "int(d[\"run_summary\"][\"with_skill\"][\"tokens\"][\"mean\"])")" = "2000" ]'
check "improve: seconds from duration_ms" '[ "$(jget "$bj" "d[\"run_summary\"][\"old_skill\"][\"time_seconds\"][\"mean\"]")" = "5.0" ]'
check "improve: markdown columns in order" 'grep -q "| Metric | With Skill | Old Skill | Delta |" "$a/benchmark.md"'
check "improve: runs per configuration counted" '[ "$(jget "$bj" "d[\"metadata\"][\"runs_per_configuration\"]")" = "1" ]'

# New-skill case: two evals, two runs each, timing.json carries only total_tokens + duration_ms.
b="$tmp/new/iteration-1"
for e in 1 2; do
  mkdir -p "$b/eval-$e"
  echo "{\"eval_id\":$e,\"eval_name\":\"case-$e\",\"prompt\":\"Task $e\",\"assertions\":[]}" > "$b/eval-$e/eval_metadata.json"
  for k in 1 2; do
    run "$b/eval-$e/with_skill/run-$k" 2 2 '{"total_tokens":3000,"duration_ms":10000}' '{"executor_duration_seconds":10.0}'
    run "$b/eval-$e/without_skill/run-$k" 1 2 '{"total_tokens":1500,"duration_ms":4000}'
  done
done
python3 "$skill/scripts/aggregate_benchmark.py" "$b" --skill-name demo >/dev/null
bj="$b/benchmark.json"
check "new: with_skill listed first" '[ "$(jget "$bj" "list(d[\"run_summary\"])[0]")" = "with_skill" ]'
check "new: delta positive" '[ "$(jget "$bj" "d[\"run_summary\"][\"delta\"][\"pass_rate\"]")" = "+0.50" ]'
check "new: with_skill tokens not zero" '[ "$(jget "$bj" "int(d[\"run_summary\"][\"with_skill\"][\"tokens\"][\"mean\"])")" = "3000" ]'
check "new: without_skill time not zero" '[ "$(jget "$bj" "d[\"run_summary\"][\"without_skill\"][\"time_seconds\"][\"mean\"]")" = "4.0" ]'
check "new: runs per configuration counted" '[ "$(jget "$bj" "d[\"metadata\"][\"runs_per_configuration\"]")" = "2" ]'
check "new: runs array keeps baseline last" '[ "$(jget "$bj" "d[\"runs\"][-1][\"configuration\"]")" = "without_skill" ]'

# One configuration only: no delta to report.
c="$tmp/single/iteration-1"
mkdir -p "$c/eval-1"
run "$c/eval-1/with_skill/run-1" 1 1 '{"total_tokens":10,"duration_ms":1000}'
python3 "$skill/scripts/aggregate_benchmark.py" "$c" >/dev/null
check "single config: no delta" '[ "$(jget "$c/benchmark.json" "\"delta\" in d[\"run_summary\"]")" = "False" ]'

# Viewer: eval_metadata.json sits at the eval level, two levels above the run-K dir.
python3 "$skill/eval-viewer/generate_review.py" "$a" --benchmark "$a/benchmark.json" --static "$tmp/view.html" >/dev/null
check "viewer: finds the eval prompt in the run-K layout" 'grep -q "Fix the typo in notes.md" "$tmp/view.html" && ! grep -q "(No prompt found)" "$tmp/view.html"'
check "viewer: skips transcript.md in outputs" 'mkdir -p "$a/eval-1/with_skill/run-1/outputs" && echo log > "$a/eval-1/with_skill/run-1/outputs/transcript.md" && python3 "$skill/eval-viewer/generate_review.py" "$a" --static "$tmp/view2.html" >/dev/null && ! grep -q "\"name\": \"transcript.md\"" "$tmp/view2.html"'
exit $fail
