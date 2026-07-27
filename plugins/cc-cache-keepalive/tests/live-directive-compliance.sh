#!/usr/bin/env bash
# Does the model actually act on the SessionStart directive? Spends tokens, so
# opt-in only:
#   bash plugins/cc-cache-keepalive/tests/live-directive-compliance.sh --live
#
# This exists because the failure is invisible. If the directive stops being
# obeyed, no cron is created, no error appears anywhere, and the plugin quietly
# does nothing at all - you only find out from the bill. The shipped wording was
# measured, not guessed: an earlier phrasing that led with "Immediately,
# silently, call the CronList tool" scored 0/8 here and 0/2 in real --bg
# sessions, because a model handed an ordinary first prompt simply answers it.
# Leading with REQUIRED SETUP and ordering the steps ahead of the user's request
# scored 8/8 and 3/3. Adding a "why it matters" paragraph dropped it back to
# 2/3, so resist padding this.
#
# Print mode is used because it fires SessionStart hooks, has the Cron tools,
# and costs one small turn per trial. Crons created here are session-only and
# die when the print-mode process exits, so nothing is left running.
set -u

[ "${1:-}" = "--live" ] || {
  echo "live-directive-compliance.sh needs --live: it runs real turns and spends tokens." >&2
  exit 2
}
command -v claude >/dev/null 2>&1 || { echo "FATAL: claude not on PATH" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../hooks/keepalive.sh"
RUNS="${RUNS:-3}"
# Model behaviour is not deterministic; require a clear majority rather than
# perfection so this reports drift without being flaky. The count is always
# printed, so a slide from 3/3 to 2/3 is visible even on a pass.
MIN_PASS="${MIN_PASS:-2}"

# Deliberately not under $TMPDIR: on macOS that resolves through a /var symlink,
# so the transcript's project directory is mangled from a different path than
# the one we would compute, and every trial reads as unmeasurable.
ROOT="$HOME/.cache/ka-directive-$$"
mkdir -p "$ROOT" || { echo "FATAL: cannot create $ROOT" >&2; exit 1; }
FAKEHOME="$ROOT/home"; mkdir -p "$FAKEHOME"
printf '30m\n' > "$FAKEHOME/.cc-cache-keepalive"

cleanup() {
  for lab in "$ROOT"/run-*; do
    [ -d "$lab" ] || continue
    claude project purge "$lab" -y >/dev/null 2>&1
  done
  rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

hits=0
unmeasured=0
for n in $(seq 1 "$RUNS"); do
  lab="$ROOT/run-$n"; mkdir -p "$lab"
  lab="$(cd "$lab" && pwd -P)"
  /usr/bin/python3 - "$lab" "$HOOK" "$FAKEHOME" > "$lab/settings.json" <<'PY'
import json, sys
lab, hook, home = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"hooks": {"SessionStart": [{"hooks": [
    {"type": "command", "command": 'env HOME="%s" bash "%s"' % (home, hook), "timeout": 10}]}]}}))
PY

  ( cd "$lab" && timeout 120 env -u CLAUDE_JOB_DIR -u CC_KEEPALIVE_OFF claude -p \
      --permission-mode manual --setting-sources project \
      --settings "$lab/settings.json" \
      'Say hi in one short sentence.' ) > "$lab/out.txt" 2>&1 </dev/null

  proj="$HOME/.claude/projects/$(printf '%s' "$lab" | tr -c '[:alnum:]' '-')"
  t="$(ls -t "$proj"/*.jsonl 2>/dev/null | head -n1)"
  if [ -z "$t" ]; then
    # Never let this read as "the directive was ignored" - that is a different
    # and much scarier claim than "the harness could not see the answer".
    echo "run $n: NO-TRANSCRIPT (harness could not measure; see $lab/out.txt)"
    unmeasured=$((unmeasured + 1))
    continue
  fi
  verdict="$(/usr/bin/python3 - "$t" <<'PY'
import json, sys
created = listed = False
for line in open(sys.argv[1], errors="replace"):
    try: r = json.loads(line)
    except Exception: continue
    if r.get("type") != "assistant": continue
    for b in (r.get("message") or {}).get("content") or []:
        if isinstance(b, dict) and b.get("type") == "tool_use":
            if b.get("name") == "CronCreate": created = True
            if b.get("name") == "CronList": listed = True
print("CREATED" if created else ("LISTED-ONLY" if listed else "IGNORED"))
PY
)"
  echo "run $n: $verdict"
  [ "$verdict" = "CREATED" ] && hits=$((hits + 1))
done

echo
if [ "$unmeasured" -eq "$RUNS" ]; then
  echo "INCONCLUSIVE: no trial produced a transcript, so nothing was measured." >&2
  echo "              This is a harness problem, not a verdict on the directive." >&2
  exit 2
fi
echo "$hits/$((RUNS - unmeasured)) measured sessions created the keepalive cron (need >= $MIN_PASS)"
if [ "$hits" -lt "$MIN_PASS" ]; then
  echo "FAIL: the SessionStart directive is being ignored - the plugin is inert." >&2
  echo "      Reword hooks/keepalive.sh's directive and re-measure with this script." >&2
  exit 1
fi
echo "PASS"
