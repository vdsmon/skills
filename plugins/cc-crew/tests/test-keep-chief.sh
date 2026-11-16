#!/bin/bash
# Offline tests for the hook that keeps the chief engineer's role through a compaction.
set -u
here=$(cd "$(dirname "$0")" && pwd)
hook=$here/../hooks/keep-chief.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0
# The hook prints the opening report: keep it off the machine's real plans.
export HOME=$tmp/home CC_CREW_PLANS=$tmp/plans

typed='{"type":"user","message":{"role":"user","content":"<command-message>cc-crew:chief-engineer</command-message>\n<command-name>/cc-crew:chief-engineer</command-name>"}}'
printf '%s\n' "$typed" > "$tmp/chief.jsonl"
printf '{"type":"user","message":{"role":"user","content":"hi"}}\n' > "$tmp/plain.jsonl"

run() { # source, transcript
  printf '{"session_id":"s","transcript_path":"%s","hook_event_name":"SessionStart","source":"%s"}' "$2" "$1" | bash "$hook"
}
check() { # name, condition...
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}

out=$(run compact "$tmp/chief.jsonl")
check "re-states the role after a compaction" bash -c "grep -q '^<cc-crew-chief>' <<<\"\$1\" && grep -q '^</cc-crew-chief>' <<<\"\$1\"" _ "$out"
check "carries the skill body" grep -q '## After a compaction' <<<"$out"
check "leaves out the frontmatter" bash -c "! grep -q 'disable-model-invocation' <<<\"\$1\"" _ "$out"
check "silent in a session without the role" test -z "$(run compact "$tmp/plain.jsonl")"
check "silent on a start that is not a compaction" test -z "$(run startup "$tmp/chief.jsonl")"
check "silent with the off switch" test -z "$(CC_CREW_KEEP_CHIEF=0 run compact "$tmp/chief.jsonl")"
check "exits 0 without input" bash -c "bash '$hook' </dev/null"

# The opening report, from a copy of the plugin whose role holds the "!`" line the harness expands.
fixture=$tmp/plugin
mkdir -p "$fixture/skills/chief-engineer" "$tmp/home" "$tmp/plans/kettle" "$tmp/work" "$tmp/other"
cp -R "$here/../hooks" "$here/../scripts" "$fixture/"
cat > "$fixture/skills/chief-engineer/SKILL.md" <<'EOF'
---
name: chief-engineer
---

# Role

!`python3 "${CLAUDE_SKILL_DIR}/../../scripts/plans.py" report`

## After a compaction
EOF
work=$(cd "$tmp/work" && pwd -P)
other=$(cd "$tmp/other" && pwd -P)
printf '# kettle\n\nPhase: building.\nRepository: %s\nHeld by: sess-k\n' "$work" > "$tmp/plans/kettle/plan.md"
compact() { # cwd field, or nothing for none
  local cwd=""
  [ -z "${1:-}" ] || cwd=",\"cwd\":\"$1\""
  printf '{"session_id":"sess-k","transcript_path":"%s","hook_event_name":"SessionStart","source":"compact"%s}' "$tmp/chief.jsonl" "$cwd" |
    bash "$fixture/hooks/keep-chief.sh"
}
out=$(compact "$work")
after_role=$(sed -n '/^## After a compaction/,$p' <<<"$out")
check "the opening report follows the role" grep -qxF '<cc-crew-plans>' <<<"$after_role"
check "inside the role's tag" test "$(tail -n 1 <<<"$out")" = '</cc-crew-chief>'
check "the report reads the session and the repository from the input" grep -qxF -- "- kettle · building · held by this session" <<<"$out"
check "the role's command line is left out" bash -c '! grep -qF "!\`python3" <<<"$1"' _ "$out"
out=$(cd "$other" && compact)
check "without cwd the hook's own directory names the repository" grep -qxF "No plan under way in $other." <<<"$out"

[ "$fails" -eq 0 ] && echo "all passed" || echo "$fails failed"
exit "$fails"
