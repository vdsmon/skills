#!/usr/bin/env bash
# Test suite for keepalive-guard.sh + keepalive-sensor.sh (and the two flag-file
# parsing regressions in keepalive.sh). Plain bash, no test framework. Run:
#   bash plugins/cc-cache-keepalive/tests/test-cache-keepalive.sh
# Every case points HOME at a throwaway dir so real ~/.claude state is untouched.
#
# Not automatable here: that Claude Code actually honours `decision: block` and
# skips the API request for a cron-injected prompt. That needs a live session -
# see tests/live-gate-e2e.sh.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/../hooks/keepalive-guard.sh"
SENSOR="$HERE/../hooks/keepalive-sensor.sh"
SESSIONSTART="$HERE/../hooks/keepalive.sh"

unset CC_KEEPALIVE_OFF CC_KEEPALIVE_WINDOW_MIN CC_KEEPALIVE_TTL_MIN \
  CC_KEEPALIVE_SAFETY_MIN CLAUDE_CONFIG_DIR 2>/dev/null

TESTHOME=$(mktemp -d "${TMPDIR:-/tmp}/cache-keepalive-test.XXXXXX")
if [ -z "$TESTHOME" ] || [ ! -d "$TESTHOME" ]; then
  echo "FATAL: could not create test home (mktemp failed)" >&2
  exit 1
fi
trap 'rm -rf "$TESTHOME"' EXIT
FLAG="$TESTHOME/.cc-cache-keepalive"
STATE_DIR="$TESTHOME/.claude/.cc-cache-keepalive"
TXDIR="$TESTHOME/tx"
mkdir -p "$TXDIR"

# Session ids must look like ids the hooks will extract: 8+ chars of [0-9a-fA-F-].
SA="aaaaaaaa-1111-1111-1111-111111111111"
SB="bbbbbbbb-2222-2222-2222-222222222222"

PASS=0
FAIL=0

# --- fixtures -----------------------------------------------------------------

reset_state() {
  rm -rf "$STATE_DIR"
  rm -f "$FLAG"
}

set_flag() { # <line1> [line2]
  if [ "$#" -gt 1 ]; then printf '%s\n%s\n' "$1" "$2" > "$FLAG"
  else printf '%s\n' "$1" > "$FLAG"; fi
}

stamp() { # <session_id> <age_seconds> [uuid]  -> last-real-turn
  mkdir -p "$STATE_DIR"
  printf '%s\n%s\n' "$(( $(date +%s) - $2 ))" "${3:-}" > "$STATE_DIR/last-real-turn-$1"
}

stamp_any() { # <session_id> <age_seconds> [uuid]  -> last-turn (any kind)
  mkdir -p "$STATE_DIR"
  printf '%s\n%s\n' "$(( $(date +%s) - $2 ))" "${3:-}" > "$STATE_DIR/last-turn-$1"
}

run_guard() { # <stdin-json> -> stdout
  printf '%s' "$1" | HOME="$TESTHOME" bash "$GUARD" 2>&1
}

run_sensor() { # <stdin-json> -> stdout (must always be empty)
  printf '%s' "$1" | HOME="$TESTHOME" bash "$SENSOR" 2>&1
}

ups() { # <session_id> <prompt-json-literal>
  printf '{"session_id":"%s","transcript_path":"/tmp/x.jsonl","cwd":"/w","prompt_id":"p1","permission_mode":"manual","agent_type":"claude","hook_event_name":"UserPromptSubmit","prompt":%s,"session_title":"t"}' \
    "$1" "$2"
}

stopj() { # <session_id> <transcript_path>
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"/w","hook_event_name":"Stop","stop_hook_active":false}' \
    "$1" "$2"
}

# Transcript line fixtures, shaped after real JSONL records.
REAL='{"parentUuid":"a","isSidechain":false,"promptId":"p1","type":"user","message":{"role":"user","content":"fix the bug"},"uuid":"11111111-1111-1111-1111-111111111111","timestamp":"2026-07-20T06:00:00.000Z"}'
REAL2='{"parentUuid":"a","isSidechain":false,"promptId":"p2","type":"user","message":{"role":"user","content":"now ship it"},"uuid":"66666666-6666-6666-6666-666666666666","timestamp":"2026-07-20T06:10:00.000Z"}'
TICK='{"parentUuid":"b","type":"user","message":{"role":"user","content":"cc-cache-keepalive"},"isMeta":true,"promptSource":"system","queuePriority":"later","uuid":"22222222-2222-2222-2222-222222222222"}'
LEGACY='{"parentUuid":"b","type":"user","message":{"role":"user","content":"[Silent cc-cache-keepalive — run Bash tool only. No text output.]"},"isMeta":true,"uuid":"77777777-7777-7777-7777-777777777777"}'
TOOLRES='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1"}]},"toolUseResult":{"stdout":"x"},"uuid":"33333333-3333-3333-3333-333333333333"}'
QUEUEOP='{"type":"queue-operation","operation":"enqueue","timestamp":"2026-07-20T06:23:30.000Z","sessionId":"s1","content":"cc-cache-keepalive"}'
ASSIST='{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":2,"cache_read_input_tokens":1000}},"uuid":"44444444-4444-4444-4444-444444444444"}'
# What an offline / rate-limited / logged-out turn leaves behind: a synthetic
# assistant record that never reached the API. Shaped after real records.
ERRASSIST='{"type":"assistant","uuid":"88888888-8888-8888-8888-888888888888","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"API Error: Unable to connect to API (ENOTFOUND)"}],"usage":{"input_tokens":0}},"isApiErrorMessage":true}'
SIDECHAIN='{"type":"user","isSidechain":true,"message":{"role":"user","content":"subagent task"},"uuid":"55555555-5555-5555-5555-555555555555"}'

tx() { # <name> <line>... -> echoes path
  local name="$1"; shift
  printf '%s\n' "$@" > "$TXDIR/$name.jsonl"
  printf '%s' "$TXDIR/$name.jsonl"
}

# --- assertions ---------------------------------------------------------------

assert_contains() { # <name> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected output containing '$3', got: ${2:-<empty>}"
  fi
}

assert_lacks() { # <name> <haystack> <needle>
  if printf '%s' "$2" | grep -qF "$3"; then
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected output WITHOUT '$3', got: $2"
  else
    PASS=$((PASS + 1)); echo "ok: $1"
  fi
}

assert_silent() { # <name> <output>
  if [ -z "$2" ]; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected no output, got: $2"
  fi
}

assert_eq() { # <name> <actual> <expected>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected '$3', got '${2:-<empty>}'"
  fi
}

assert_file_absent() { # <name> <path>
  if [ -e "$2" ]; then
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected '$2' to not exist"
  else
    PASS=$((PASS + 1)); echo "ok: $1"
  fi
}

assert_file_present() { # <name> <path>
  if [ -e "$2" ]; then
    PASS=$((PASS + 1)); echo "ok: $1"
  else
    FAIL=$((FAIL + 1)); echo "FAIL: $1 - expected '$2' to exist"
  fi
}

# --- guard: sentinel recognition ----------------------------------------------

echo "# guard: sentinel recognition"

reset_state; set_flag "30m"; stamp "$SA" 300
out=$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")
assert_contains "exact sentinel blocks when the last real turn is fresh" "$out" '"decision":"block"'
assert_contains "block payload carries suppressOriginalPrompt" "$out" '"suppressOriginalPrompt":true'
assert_contains "block payload names the hook event" "$out" '"hookEventName":"UserPromptSubmit"'
assert_lacks "block payload injects no additionalContext" "$out" 'additionalContext'
assert_lacks "block payload never uses continue:false" "$out" '"continue"'

reset_state; set_flag "30m"; stamp "$SA" 1800
assert_silent "exact sentinel passes when the last real turn is stale" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

# window at the 30m default is min(30, 60-30-10) = 20m = 1200s
reset_state; set_flag "30m"; stamp "$SA" 1200
assert_silent "boundary: age == window fires (strict <)" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
reset_state; set_flag "30m"; stamp "$SA" 1199
assert_contains "boundary: age == window - 1 blocks" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'

# The false-positive cases that matter: a user talking ABOUT the plugin.
reset_state; set_flag "30m"; stamp "$SA" 60
assert_silent "prompt mentioning the sentinel is not blocked" \
  "$(run_guard "$(ups "$SA" '"what does the cc-cache-keepalive plugin do?"')")"
assert_silent "prompt with trailing text is not blocked" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive please"')")"
assert_silent "prompt with leading text is not blocked" \
  "$(run_guard "$(ups "$SA" '"run cc-cache-keepalive now"')")"
assert_silent "prompt pasting an escaped hook payload is not blocked" \
  "$(run_guard "$(ups "$SA" '"see: {\"prompt\":\"cc-cache-keepalive\"} ok"')")"
assert_silent "plain non-sentinel prompt is silent" \
  "$(run_guard "$(ups "$SA" '"hello"')")"

# Decoys: the sentinel in a neighbouring field must not count.
assert_silent "prompt_id decoy does not block" \
  "$(run_guard "$(printf '{"session_id":"%s","prompt_id":"cc-cache-keepalive","hook_event_name":"UserPromptSubmit","prompt":"hello","session_title":"t"}' "$SA")")"
assert_silent "session_title decoy does not block" \
  "$(run_guard "$(printf '{"session_id":"%s","prompt_id":"p1","hook_event_name":"UserPromptSubmit","prompt":"hello","session_title":"cc-cache-keepalive"}' "$SA")")"

assert_contains "sentinel matches with prompt as the last key" \
  "$(run_guard "$(printf '{"session_id":"%s","hook_event_name":"UserPromptSubmit","prompt":"cc-cache-keepalive"}' "$SA")")" '"decision":"block"'
assert_contains "sentinel matches with whitespace around the colon" \
  "$(run_guard "$(printf '{"session_id":"%s", "prompt" : "cc-cache-keepalive"}' "$SA")")" '"decision":"block"'

before=$(cat "$STATE_DIR/last-real-turn-$SA")
run_guard "$(ups "$SA" '"cc-cache-keepalive"')" >/dev/null
assert_eq "guard never writes the stamp" "$(cat "$STATE_DIR/last-real-turn-$SA")" "$before"

# The live test exercises a mirror of this hook so it can log every invocation,
# so pin the real hook's payload against the shape Claude Code actually accepts:
# decision/reason at the top level, and a hookSpecificOutput that carries only
# keys the UserPromptSubmit variant declares. An unknown key is dropped
# silently, which would turn suppressOriginalPrompt into a no-op.
reset_state; set_flag "30m"; stamp "$SA" 300
shape=$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')" | /usr/bin/python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print("not valid JSON: %s" % e); raise SystemExit
top = set(d)
allowed_top = {"decision", "reason", "hookSpecificOutput"}
hso = d.get("hookSpecificOutput", {})
allowed_hso = {"hookEventName", "additionalContext", "sessionTitle", "suppressOriginalPrompt"}
problems = []
if not top <= allowed_top:
    problems.append("unexpected top-level keys: %s" % sorted(top - allowed_top))
if d.get("decision") != "block":
    problems.append("decision is %r" % d.get("decision"))
if not set(hso) <= allowed_hso:
    problems.append("unexpected hookSpecificOutput keys: %s" % sorted(set(hso) - allowed_hso))
if hso.get("hookEventName") != "UserPromptSubmit":
    problems.append("hookEventName is %r" % hso.get("hookEventName"))
if hso.get("suppressOriginalPrompt") is not True:
    problems.append("suppressOriginalPrompt is %r" % hso.get("suppressOriginalPrompt"))
if not str(d.get("reason", "")).strip():
    problems.append("reason is empty")
print("; ".join(problems) if problems else "OK")
')
assert_eq "block payload matches the UserPromptSubmit hook schema" "$shape" "OK"

# --- guard: fail open ---------------------------------------------------------

echo
echo "# guard: fail open"

reset_state; stamp "$SA" 60
assert_silent "flag file absent short-circuits" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
rm -rf "$STATE_DIR"
reset_state; set_flag "30m"
assert_silent "flag absent leaves no state dir behind" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

reset_state; set_flag "30m"; mkdir -p "$STATE_DIR"
assert_silent "missing stamp file fails open" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

reset_state; set_flag "30m"
assert_silent "missing state dir fails open" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

reset_state; set_flag "30m"; mkdir -p "$STATE_DIR"
printf 'not-a-number\n' > "$STATE_DIR/last-real-turn-$SA"
assert_silent "corrupt stamp fails open" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

: > "$STATE_DIR/last-real-turn-$SA"
assert_silent "empty stamp fails open" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

printf 'abc\n%s\n' "$(date +%s)" > "$STATE_DIR/last-real-turn-$SA"
assert_silent "garbage on line 1 fails open even with a valid line 2" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

reset_state; set_flag "30m"; stamp "$SA" -3600
assert_silent "stamp in the future (clock skew) fails open" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

if [ "$(id -u)" != "0" ]; then
  reset_state; set_flag "30m"; stamp "$SA" 60
  chmod 000 "$STATE_DIR/last-real-turn-$SA"
  assert_silent "unreadable stamp fails open" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
  chmod 644 "$STATE_DIR/last-real-turn-$SA"
else
  echo "skip: unreadable stamp (running as root)"
fi

# The single most important line in the guard: no id, no shared-file fallback.
reset_state; set_flag "30m"; mkdir -p "$STATE_DIR"
printf '%s\n\n' "$(date +%s)" > "$STATE_DIR/last-real-turn-"
assert_silent "empty session_id fails open, never uses a shared stamp" \
  "$(run_guard "$(printf '{"session_id":"","hook_event_name":"UserPromptSubmit","prompt":"cc-cache-keepalive"}')")"

reset_state; set_flag "30m"; stamp "$SA" 60
assert_silent "a fresh stamp for another session does not block this one" \
  "$(run_guard "$(ups "$SB" '"cc-cache-keepalive"')")"

reset_state; set_flag "30m"; stamp "$SA" 60
assert_silent "CC_KEEPALIVE_OFF disables the guard" \
  "$(printf '%s' "$(ups "$SA" '"cc-cache-keepalive"')" | HOME="$TESTHOME" CC_KEEPALIVE_OFF=1 bash "$GUARD" 2>&1)"

assert_silent "CC_KEEPALIVE_WINDOW_MIN=0 never skips" \
  "$(printf '%s' "$(ups "$SA" '"cc-cache-keepalive"')" | HOME="$TESTHOME" CC_KEEPALIVE_WINDOW_MIN=0 bash "$GUARD" 2>&1)"

reset_state; set_flag "30m" "0m"; stamp "$SA" 60
assert_silent "flag line 2 of 0m never skips" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

# --- guard: window arithmetic -------------------------------------------------

echo
echo "# guard: window arithmetic"

# flag-line-1 -> expected window in minutes. 0 means "never skip".
# 08m and 0m are the regressions for the keepalive.sh octal / divide-by-zero fixes.
while read -r iv expect; do
  [ -n "$iv" ] || continue
  label="${iv:-<empty>}"
  reset_state
  if [ "$iv" = "EMPTY" ]; then : > "$FLAG"; else set_flag "$iv"; fi
  if [ "$expect" -eq 0 ]; then
    stamp "$SA" 0
    assert_silent "window($label) = never skip" "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
  else
    # Probing both sides of the boundary pins the window to the exact minute
    # without asserting on the message text - the reason string is deliberately
    # terse and must stay free to change.
    stamp "$SA" $(( expect * 60 - 30 ))
    assert_contains "window($label) = ${expect}m, blocks just inside" \
      "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
    stamp "$SA" $(( expect * 60 + 30 ))
    assert_silent "window($label) = ${expect}m, passes just outside" \
      "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
  fi
done <<'TABLE'
1m 1
90s 2
10m 10
20m 20
24m 24
26m 24
30m 20
45m 5
50m 0
1h 0
1d 0
EMPTY 20
banana 20
0m 20
08m 8
TABLE

# run_guard_env <VAR=value> <age_seconds> -> stdout, with the stamp set first
run_guard_env() {
  stamp "$SA" "$2"
  printf '%s' "$(ups "$SA" '"cc-cache-keepalive"')" | HOME="$TESTHOME" env "$1" bash "$GUARD" 2>&1
}

reset_state; set_flag "30m"
assert_contains "CC_KEEPALIVE_TTL_MIN=120 widens the window to the interval" \
  "$(run_guard_env CC_KEEPALIVE_TTL_MIN=120 $(( 29 * 60 )))" '"decision":"block"'
assert_silent "CC_KEEPALIVE_TTL_MIN=120 window stops at the interval, not beyond" \
  "$(run_guard_env CC_KEEPALIVE_TTL_MIN=120 $(( 31 * 60 )))"

reset_state; set_flag "30m"
assert_contains "CC_KEEPALIVE_SAFETY_MIN=0 widens the window" \
  "$(run_guard_env CC_KEEPALIVE_SAFETY_MIN=0 $(( 29 * 60 )))" '"decision":"block"'
assert_silent "CC_KEEPALIVE_SAFETY_MIN=0 still caps at the interval" \
  "$(run_guard_env CC_KEEPALIVE_SAFETY_MIN=0 $(( 31 * 60 )))"

reset_state; set_flag "30m" "25m"; stamp "$SA" $(( 24 * 60 ))
assert_contains "flag line 2 overrides the derived window" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
stamp "$SA" $(( 26 * 60 ))
assert_silent "flag line 2 window is respected on the far side" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

# Silence at 6m is what proves the env value (5) won over flag line 2 (25).
reset_state; set_flag "30m" "25m"
assert_contains "env beats flag line 2 beats derived" \
  "$(run_guard_env CC_KEEPALIVE_WINDOW_MIN=5 240)" '"decision":"block"'
assert_silent "env window of 5m really is 5m, not the flag's 25m" \
  "$(run_guard_env CC_KEEPALIVE_WINDOW_MIN=5 360)"

# --- guard: cold gate ---------------------------------------------------------
# The machine slept, or was offline: the in-process cron fires the moment it
# wakes, but the cache expired hours ago. Firing would re-read the whole
# conversation uncached, for nobody. Age is measured from the NEWEST turn of any
# kind, so a session kept warm purely by pings is still pinged.

echo
echo "# guard: cold gate"

TICK_JSON="$(ups "$SA" '"cc-cache-keepalive"')"

reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 ))
out=$(run_guard "$TICK_JSON")
assert_contains "five hours after the last turn the tick is blocked (cold)" "$out" '"decision":"block"'
assert_contains "cold block carries suppressOriginalPrompt" "$out" '"suppressOriginalPrompt":true'
assert_contains "cold block names the hook event" "$out" '"hookEventName":"UserPromptSubmit"'
assert_lacks "cold block injects no additionalContext" "$out" 'additionalContext'
assert_lacks "cold block never uses continue:false" "$out" '"continue"'

reset_state; set_flag "30m"; stamp_any "$SA" $(( 59 * 60 ))
assert_silent "59 min after the last turn the tick still fires (cache alive)" "$(run_guard "$TICK_JSON")"
reset_state; set_flag "30m"; stamp_any "$SA" $(( 60 * 60 ))
assert_contains "boundary: age == TTL blocks (>=)" "$(run_guard "$TICK_JSON")" '"decision":"block"'
reset_state; set_flag "30m"; stamp_any "$SA" $(( 60 * 60 - 1 ))
assert_silent "boundary: age == TTL - 1s fires" "$(run_guard "$TICK_JSON")"

# The newest of the two stamps is what counts.
reset_state; set_flag "30m"; stamp_any "$SA" $(( 10 * 60 )); stamp "$SA" $(( 3 * 3600 ))
assert_silent "session kept warm only by pings (real turn 3h ago, ping 10m ago) is still pinged" \
  "$(run_guard "$TICK_JSON")"
reset_state; set_flag "30m"; stamp_any "$SA" $(( 61 * 60 )); stamp "$SA" $(( 30 * 60 ))
assert_silent "a fresher real turn overrides a stale last-turn stamp" "$(run_guard "$TICK_JSON")"
reset_state; set_flag "30m"; stamp "$SA" $(( 61 * 60 ))
assert_contains "no last-turn stamp yet (pre-1.6 session): the real-turn stamp alone can call it cold" \
  "$(run_guard "$TICK_JSON")" '"decision":"block"'
reset_state; set_flag "30m"; stamp "$SA" $(( 30 * 60 ))
assert_silent "no last-turn stamp, real turn 30m ago: fires" "$(run_guard "$TICK_JSON")"

# Fail open on anything unreadable, same as the warm gate.
reset_state; set_flag "30m"; mkdir -p "$STATE_DIR"; printf 'garbage\n' > "$STATE_DIR/last-turn-$SA"
assert_silent "corrupt last-turn stamp fails open" "$(run_guard "$TICK_JSON")"
reset_state; set_flag "30m"; stamp_any "$SA" -7200
assert_silent "future-dated last-turn stamp fails open" "$(run_guard "$TICK_JSON")"
reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 ))
assert_silent "another session's cold stamp does not block this one" \
  "$(run_guard "$(ups "$SB" '"cc-cache-keepalive"')")"

# "Never cancel" configs disable the warm gate only. Re-creating a dead cache
# was never what anyone meant by never cancel.
reset_state; set_flag "30m" "0m"; stamp_any "$SA" $(( 5 * 3600 ))
assert_contains "flag line 2 = 0m still blocks a cold tick" "$(run_guard "$TICK_JSON")" '"decision":"block"'
reset_state; set_flag "1h"; stamp_any "$SA" $(( 5 * 3600 ))
assert_contains "1h interval (window 0) still blocks a cold tick" "$(run_guard "$TICK_JSON")" '"decision":"block"'
reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 ))
assert_contains "CC_KEEPALIVE_WINDOW_MIN=0 still blocks a cold tick" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_WINDOW_MIN=0 bash "$GUARD" 2>&1)" '"decision":"block"'

# Overrides.
reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 ))
assert_silent "CC_KEEPALIVE_COLD_MIN=0 disables the cold gate" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_COLD_MIN=0 bash "$GUARD" 2>&1)"
reset_state; set_flag "30m"; stamp_any "$SA" $(( 31 * 60 ))
assert_contains "CC_KEEPALIVE_COLD_MIN=30 blocks at 31m" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_COLD_MIN=30 bash "$GUARD" 2>&1)" '"decision":"block"'
stamp_any "$SA" $(( 29 * 60 ))
assert_silent "CC_KEEPALIVE_COLD_MIN=30 fires at 29m" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_COLD_MIN=30 bash "$GUARD" 2>&1)"
reset_state; set_flag "30m"; stamp_any "$SA" $(( 90 * 60 ))
assert_silent "CC_KEEPALIVE_TTL_MIN=120 moves the cold threshold too (90m fires)" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_TTL_MIN=120 bash "$GUARD" 2>&1)"
stamp_any "$SA" $(( 121 * 60 ))
assert_contains "CC_KEEPALIVE_TTL_MIN=120 blocks at 121m" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_TTL_MIN=120 bash "$GUARD" 2>&1)" '"decision":"block"'
reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 ))
assert_contains "CC_KEEPALIVE_COLD_MIN=banana falls back to the TTL" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_COLD_MIN=banana bash "$GUARD" 2>&1)" '"decision":"block"'
stamp_any "$SA" $(( 9 * 60 ))
assert_contains "CC_KEEPALIVE_COLD_MIN=08 is decimal 8, not octal" \
  "$(printf '%s' "$TICK_JSON" | HOME="$TESTHOME" CC_KEEPALIVE_COLD_MIN=08 bash "$GUARD" 2>&1)" '"decision":"block"'

# A cold-blocked tick must not refresh anything, or the block would undo itself.
reset_state; set_flag "30m"; stamp_any "$SA" $(( 5 * 3600 )); stamp "$SA" $(( 6 * 3600 ))
b1=$(cat "$STATE_DIR/last-turn-$SA"); b2=$(cat "$STATE_DIR/last-real-turn-$SA")
run_guard "$TICK_JSON" >/dev/null
assert_eq "cold block leaves last-turn untouched" "$(cat "$STATE_DIR/last-turn-$SA")" "$b1"
assert_eq "cold block leaves last-real-turn untouched" "$(cat "$STATE_DIR/last-real-turn-$SA")" "$b2"
assert_eq "cold block creates no other files" "$(find "$STATE_DIR" -type f | wc -l | tr -d ' ')" "2"

# --- sensor -------------------------------------------------------------------

echo
echo "# sensor"

reset_state; set_flag "30m"
t=$(tx real "$ASSIST" "$REAL" "$ASSIST")
assert_silent "sensor writes nothing to stdout" "$(run_sensor "$(stopj "$SA" "$t")")"
assert_file_present "sensor stamps a real turn" "$STATE_DIR/last-real-turn-$SA"
now=$(date +%s); got=$(head -n1 "$STATE_DIR/last-real-turn-$SA")
if [ $(( now - got )) -le 5 ] && [ $(( now - got )) -ge -5 ]; then
  PASS=$((PASS + 1)); echo "ok: stamp records the current time"
else
  FAIL=$((FAIL + 1)); echo "FAIL: stamp records the current time - drift $(( now - got ))s"
fi

assert_file_present "sensor stamps last-turn on a real turn too" "$STATE_DIR/last-turn-$SA"
assert_eq "both stamps carry the same prompt uuid" \
  "$(sed -n 2p "$STATE_DIR/last-turn-$SA")" "$(sed -n 2p "$STATE_DIR/last-real-turn-$SA")"

reset_state; set_flag "30m"; stamp "$SA" 9999 "old-uuid"
before=$(cat "$STATE_DIR/last-real-turn-$SA")
t=$(tx tick "$REAL" "$ASSIST" "$TICK" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_eq "sensor does not stamp its own keepalive ping as a real turn" \
  "$(cat "$STATE_DIR/last-real-turn-$SA")" "$before"
assert_file_present "sensor DOES stamp its own ping as a turn of some kind" "$STATE_DIR/last-turn-$SA"
now=$(date +%s); got=$(head -n1 "$STATE_DIR/last-turn-$SA")
if [ $(( now - got )) -le 5 ] && [ $(( now - got )) -ge -5 ]; then
  PASS=$((PASS + 1)); echo "ok: ping stamp records the current time"
else
  FAIL=$((FAIL + 1)); echo "FAIL: ping stamp records the current time - drift $(( now - got ))s"
fi
first=$(head -n1 "$STATE_DIR/last-turn-$SA")
sleep 1
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_eq "same ping is not re-stamped as a turn (uuid idempotence)" \
  "$(head -n1 "$STATE_DIR/last-turn-$SA")" "$first"

t=$(tx legacy "$REAL" "$ASSIST" "$LEGACY" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_eq "sensor skips the pre-1.3.0 silent-prefix ping" \
  "$(cat "$STATE_DIR/last-real-turn-$SA")" "$before"

t=$(tx toolres "$TICK" "$ASSIST" "$TOOLRES" "$TOOLRES")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_eq "sensor ignores tool-result user lines when finding the last prompt" \
  "$(cat "$STATE_DIR/last-real-turn-$SA")" "$before"

# A turn the API never answered touched no cache: no stamp of either kind.
reset_state; set_flag "30m"
t=$(tx offline "$REAL" "$ERRASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_absent "real turn that hit an API error is not stamped as real" "$STATE_DIR/last-real-turn-$SA"
assert_file_absent "real turn that hit an API error is not stamped as a turn" "$STATE_DIR/last-turn-$SA"
t=$(tx offlinetick "$REAL" "$ASSIST" "$TICK" "$ERRASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_absent "ping that hit an API error is not stamped as a turn" "$STATE_DIR/last-turn-$SA"
t=$(tx retry "$REAL" "$ERRASSIST" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_present "an error followed by a successful retry does stamp" "$STATE_DIR/last-real-turn-$SA"
reset_state; set_flag "30m"
t=$(tx synth "$REAL" '{"type":"assistant","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"You have hit your session limit"}]},"uuid":"99999999-9999-9999-9999-999999999999"}')
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_absent "a synthetic assistant record without the error flag still blocks stamping" \
  "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"
t=$(tx queueop "$REAL" "$ASSIST" "$QUEUEOP")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_present "sensor ignores queue-operation lines carrying the sentinel" \
  "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"
t=$(tx sidechain "$REAL" "$ASSIST" "$SIDECHAIN")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_present "sensor stamps when the last user line is a sidechain prompt" \
  "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"
run_sensor "$(stopj "$SA" "$TXDIR/nope.jsonl")" >/dev/null
assert_file_absent "missing transcript does not stamp (inverted vs stop-sound.sh)" \
  "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"; : > "$TXDIR/empty.jsonl"
run_sensor "$(stopj "$SA" "$TXDIR/empty.jsonl")" >/dev/null
assert_file_absent "empty transcript does not stamp" "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"; t=$(tx assistonly "$ASSIST" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_absent "transcript with no user lines does not stamp" "$STATE_DIR/last-real-turn-$SA"

if [ "$(id -u)" != "0" ]; then
  reset_state; set_flag "30m"; t=$(tx unreadable "$REAL"); chmod 000 "$t"
  run_sensor "$(stopj "$SA" "$t")" >/dev/null
  assert_file_absent "unreadable transcript does not stamp" "$STATE_DIR/last-real-turn-$SA"
  chmod 644 "$t"
else
  echo "skip: unreadable transcript (running as root)"
fi

reset_state; set_flag "30m"; t=$(tx real2 "$REAL")
run_sensor "$(printf '{"session_id":"","transcript_path":"%s","hook_event_name":"Stop"}' "$t")" >/dev/null
n=$(find "$STATE_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
assert_eq "empty session_id creates no stamp anywhere" "$n" "0"

reset_state; set_flag "30m"; t=$(tx pers "$REAL")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
run_sensor "$(stopj "$SB" "$t")" >/dev/null
assert_file_present "per-session keying: session A stamp" "$STATE_DIR/last-real-turn-$SA"
assert_file_present "per-session keying: session B stamp" "$STATE_DIR/last-real-turn-$SB"

reset_state; set_flag "30m"
PROF="$TESTHOME/workprofile"
t=$(tx prof "$REAL")
printf '%s' "$(stopj "$SA" "$t")" | HOME="$TESTHOME" CLAUDE_CONFIG_DIR="$PROF" bash "$SENSOR" >/dev/null 2>&1
assert_file_present "CLAUDE_CONFIG_DIR is honoured" "$PROF/.cc-cache-keepalive/last-real-turn-$SA"
assert_file_absent "profile run does not touch the default state dir" "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"; t=$(tx idem "$REAL")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
first=$(head -n1 "$STATE_DIR/last-real-turn-$SA")
sleep 1
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_eq "same last prompt is not re-stamped (uuid idempotence)" \
  "$(head -n1 "$STATE_DIR/last-real-turn-$SA")" "$first"
t2=$(tx idem2 "$REAL" "$ASSIST" "$REAL2")
run_sensor "$(stopj "$SA" "$t2")" >/dev/null
second=$(head -n1 "$STATE_DIR/last-real-turn-$SA")
if [ "$second" -gt "$first" ]; then
  PASS=$((PASS + 1)); echo "ok: a new prompt does re-stamp"
else
  FAIL=$((FAIL + 1)); echo "FAIL: a new prompt does re-stamp - $first -> $second"
fi
n=$(find "$STATE_DIR" -name '.tmp.*' 2>/dev/null | wc -l | tr -d ' ')
assert_eq "no tmp files leak" "$n" "0"

reset_state; set_flag "30m"
{ printf '%s\n' "$REAL"; for _ in $(seq 1 3000); do printf '%s\n' "$TOOLRES"; done; } > "$TXDIR/long.jsonl"
run_sensor "$(stopj "$SA" "$TXDIR/long.jsonl")" >/dev/null
assert_file_present "full-file fallback finds a prompt beyond the tail window" \
  "$STATE_DIR/last-real-turn-$SA"

reset_state; set_flag "30m"; t=$(tx off "$REAL")
printf '%s' "$(stopj "$SA" "$t")" | HOME="$TESTHOME" CC_KEEPALIVE_OFF=1 bash "$SENSOR" >/dev/null 2>&1
assert_file_absent "CC_KEEPALIVE_OFF disables the sensor" "$STATE_DIR/last-real-turn-$SA"

reset_state; t=$(tx noflag "$REAL")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_file_absent "flag absent leaves no sensor state" "$STATE_DIR/last-real-turn-$SA"

# --- integration --------------------------------------------------------------

echo
echo "# integration"

reset_state; set_flag "30m"; t=$(tx rt "$REAL" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_contains "round trip: sensor stamps, guard blocks the next tick" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
stamp "$SA" $(( 50 * 60 )); stamp_any "$SA" $(( 50 * 60 ))
assert_silent "round trip: fifty minutes later the tick goes through" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
stamp "$SA" $(( 61 * 60 )); stamp_any "$SA" $(( 61 * 60 ))
assert_contains "round trip: an hour later the cache is gone and the tick is held" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'

reset_state; set_flag "30m"; t=$(tx rt2 "$TICK" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null
assert_silent "round trip: a ping-only turn leaves the next tick unblocked" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

# The laptop-lid scenario end to end. Wall clock is simulated by ageing the
# stamps the sensor wrote; the transcript fixtures stand in for what each turn
# leaves behind.
echo
echo "# integration: the machine slept"
reset_state; set_flag "30m"
t=$(tx sleep1 "$REAL" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null                        # 09:00 real turn
stamp "$SA" $(( 30 * 60 )); stamp_any "$SA" $(( 30 * 60 ))         # 09:30
assert_silent "09:30 tick fires (real turn 30m ago, outside the 20m window)" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"
t=$(tx sleep2 "$REAL" "$ASSIST" "$TICK" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null                        # ping answered
stamp "$SA" $(( 5 * 3600 )); stamp_any "$SA" $(( 4 * 3600 + 30 * 60 ))  # lid closed 09:31, opened 14:00
assert_contains "14:00 wake-up tick is held: cache died at 10:30" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
stamp "$SA" $(( 5 * 3600 + 30 * 60 )); stamp_any "$SA" $(( 5 * 3600 ))  # 14:30
assert_contains "14:30 tick still held: nothing refreshed it, nothing will until a real turn" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
t=$(tx sleep3 "$REAL" "$ASSIST" "$TICK" "$ASSIST" "$REAL2" "$ASSIST")
run_sensor "$(stopj "$SA" "$t")" >/dev/null                        # 14:40 real turn (pays the cold read once)
stamp "$SA" $(( 10 * 60 )); stamp_any "$SA" $(( 10 * 60 ))         # 14:50
assert_contains "14:50 tick cancelled as warm again (real turn 10m ago)" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")" '"decision":"block"'
stamp "$SA" $(( 40 * 60 )); stamp_any "$SA" $(( 40 * 60 ))         # 15:20
assert_silent "15:20 tick fires: the chain is back" \
  "$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")"

# Parser drift: keepalive.sh owns the interval contract, the guard re-implements
# it. Pin both to one input table so they cannot drift apart silently.
echo
echo "# integration: interval parser drift"
while read -r iv reported; do
  [ -n "$iv" ] || continue
  reset_state
  if [ "$iv" = "EMPTY" ]; then : > "$FLAG"; else set_flag "$iv"; fi
  out=$(printf '{"source":"startup"}' | HOME="$TESTHOME" bash "$SESSIONSTART" 2>&1)
  assert_contains "keepalive.sh reports interval $iv as $reported" "$out" "interval: $reported"
done <<'TABLE'
30m 30m
10m 10m
90s 90s
1h 1h
08m 08m
0m 30m
banana 30m
EMPTY 30m
TABLE

reset_state; set_flag "08m"
out=$(printf '{"source":"startup"}' | HOME="$TESTHOME" bash "$SESSIONSTART" 2>&1)
assert_contains "keepalive.sh survives an octal-looking interval" "$out" "<cc-cache-keepalive>"
assert_lacks "keepalive.sh emits no shell error for 08m" "$out" "value too great"

reset_state; set_flag "0m"
out=$(printf '{"source":"startup"}' | HOME="$TESTHOME" bash "$SESSIONSTART" 2>&1)
assert_contains "keepalive.sh survives a zero interval" "$out" "<cc-cache-keepalive>"
assert_lacks "keepalive.sh emits no divide-by-zero for 0m" "$out" "division by 0"

# GC
echo
echo "# integration: garbage collection"
reset_state; set_flag "30m"; stamp "$SA" 60; stamp_any "$SA" 60
touch "$STATE_DIR/last-real-turn-old" "$STATE_DIR/last-turn-old" "$STATE_DIR/.tmp.999"
touch -t 202601010000 "$STATE_DIR/last-real-turn-old" "$STATE_DIR/last-turn-old" "$STATE_DIR/.tmp.999"
run_guard "$(ups "$SA" '"cc-cache-keepalive"')" >/dev/null
assert_file_absent "GC sweeps stale real-turn stamps" "$STATE_DIR/last-real-turn-old"
assert_file_absent "GC sweeps stale any-turn stamps" "$STATE_DIR/last-turn-old"
assert_file_absent "GC sweeps orphaned tmp files" "$STATE_DIR/.tmp.999"
assert_file_present "GC keeps the live session's real-turn stamp" "$STATE_DIR/last-real-turn-$SA"
assert_file_present "GC keeps the live session's any-turn stamp" "$STATE_DIR/last-turn-$SA"

reset_state; set_flag "30m"; stamp "$SA" 60
touch "$STATE_DIR/last-real-turn-old"; touch -t 202601010000 "$STATE_DIR/last-real-turn-old"
run_guard "$(ups "$SA" '"just a normal prompt"')" >/dev/null
assert_file_present "GC does not run on the non-sentinel hot path" "$STATE_DIR/last-real-turn-old"
# --- resume marker and on-demand arming (1.7.0) --------------------------------
# A resumed CLI process has no cron. SessionStart leaves a pending marker instead of
# arming (the user may only be reading), the guard arms on the first real prompt, and
# `--now` prints the instruction on demand so nobody guesses a cron expression.
reset_state
set_flag "30m"
ss() { # <session_id> <source> -> SessionStart stdin json
  printf '{"session_id":"%s","transcript_path":"/tmp/x.jsonl","cwd":"/w","hook_event_name":"SessionStart","source":"%s"}' "$1" "$2"
}
run_sessionstart() { printf '%s' "$1" | HOME="$TESTHOME" bash "$SESSIONSTART" 2>&1; }

out=$(run_sessionstart "$(ss "$SA" startup)")
assert_contains "startup emits the CronCreate instruction" "$out" "REQUIRED SETUP"
assert_contains "startup instruction carries a cron expression" "$out" 'cron:      "'
assert_file_absent "startup leaves no pending marker" "$STATE_DIR/pending-$SA"

out=$(run_sessionstart "$(ss "$SA" compact)")
assert_silent "compact emits nothing (the cron survives compaction)" "$out"
assert_file_absent "compact leaves no pending marker" "$STATE_DIR/pending-$SA"

out=$(run_sessionstart "$(ss "$SA" resume)")
assert_silent "resume emits nothing at SessionStart" "$out"
assert_file_present "resume leaves a pending marker" "$STATE_DIR/pending-$SA"

out=$(run_guard "$(ups "$SA" '"cc-cache-keepalive"')")
assert_lacks "a sentinel tick never arms" "$out" "REQUIRED SETUP"
assert_file_present "a sentinel tick keeps the pending marker" "$STATE_DIR/pending-$SA"

out=$(run_guard "$(ups "$SA" '"fix the bug"')")
assert_contains "first real prompt after a resume arms the cron" "$out" "REQUIRED SETUP"
assert_contains "arming rides as additionalContext" "$out" '"additionalContext"'
assert_contains "arming names the hook event" "$out" '"hookEventName":"UserPromptSubmit"'
assert_lacks "arming never blocks the real prompt" "$out" '"decision":"block"'
assert_file_absent "arming clears the pending marker" "$STATE_DIR/pending-$SA"
assert_silent "second real prompt is silent" "$(run_guard "$(ups "$SA" '"and ship it"')")"

run_sessionstart "$(ss "$SB" resume)" >/dev/null
assert_silent "another session's pending marker does not arm this one" "$(run_guard "$(ups "$SA" '"hello"')")"
assert_file_present "the other session stays pending" "$STATE_DIR/pending-$SB"

out=$(HOME="$TESTHOME" bash "$SESSIONSTART" --now </dev/null 2>&1)
assert_contains "--now prints the instruction on demand" "$out" "REQUIRED SETUP"
assert_contains "--now anchors a cron expression" "$out" 'cron:      "'
rm -f "$FLAG"
assert_silent "--now without the flag prints nothing" "$(HOME="$TESTHOME" bash "$SESSIONSTART" --now </dev/null 2>&1)"
set_flag "30m"
run_sessionstart "$(ss "$SA" resume)" >/dev/null
assert_silent "kill switch stops the arming too" "$(CC_KEEPALIVE_OFF=1 run_guard "$(ups "$SA" '"hi"')")"
reset_state


echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
