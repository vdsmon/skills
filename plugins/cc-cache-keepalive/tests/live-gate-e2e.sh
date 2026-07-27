#!/usr/bin/env bash
# Live end-to-end check for the keepalive guard. Spends tokens, spawns a real
# background session, takes ~5 minutes. Opt-in only:
#   bash plugins/cc-cache-keepalive/tests/live-gate-e2e.sh --live
#
# It proves the two things static analysis cannot, and that the unit suite
# cannot reach:
#   A) a UserPromptSubmit hook fires at all for a prompt injected by a cron tick
#      (those arrive as queued isMeta/promptSource:"system" prompts, a different
#      path from anything you type)
#   B) blocking one produces NO API request - no assistant turn, no usage
#
# Shape: ALLOW -> BLOCK -> ALLOW in a single session, flipping one stamp file
# between phases. Silence is ambiguous on its own - a missing turn could equally
# be a dead session, a cron that was never created, or a stalled model - so the
# block is sandwiched between two positive controls.
#
# Validated against Claude Code 2.1.220. It depends on CLI internals that can
# change: the system record with subtype "scheduled_task_fire", queue-operation
# enqueue records, promptSource:"system" on injected prompts, and the block
# branch discarding the pending user message. If a future version breaks any of
# them, the guard stops cancelling ticks and you simply pay more, with no error
# anywhere - which is exactly why this is worth running after a CLI upgrade.
#
# Teardown is the sharp edge, so read cleanup() before changing it. A background
# session is supervised twice over: a pty host respawns its worker, and the
# daemon resurrects the session from its transcript. Killing the obvious process
# leaves a 1-minute cron firing at ~36k tokens a pop, and `claude agents` will
# happily report the session as gone while it does. The teardown therefore kills
# the host, sweeps by argv, and then purges the throwaway project so there is
# nothing left to resume from. If this script ever prints LEAKED SESSION, act on
# it - that is real money.
set -u

[ "${1:-}" = "--live" ] || {
  cat >&2 <<'USAGE'
live-gate-e2e.sh needs --live: it launches a real background Claude Code
session, creates a 1-minute cron, and spends tokens. Nothing runs without it.
USAGE
  exit 2
}

command -v claude >/dev/null 2>&1 || { echo "FATAL: claude not on PATH" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUN="$(date +%s)"
LAB="$HOME/.cache/ka-e2e-$RUN"
EVIDENCE="$HOME/.cache/ka-e2e-$RUN.evidence"
NAME="ka-e2e-$RUN"
SENT="ka-probe-$RUN"
# A --bg worker assigns its own session id regardless of what you pass, so
# nothing here may key off a guessed one. The hook log hands us the real id and
# the real transcript path on its first line; until then, the run-scoped NAME
# (which appears in the worker's argv) is the handle for cleanup.
SID=""
START="$RUN"
HARD_DEADLINE=$((START + 600))
TRANSCRIPT=""
WORKER_PID=""
WATCHDOG=""
VERDICT=1

mkdir -p "$LAB" || { echo "FATAL: cannot create $LAB" >&2; exit 1; }

# Killing the process that matches the run is NOT enough. A --bg session is a
# pty-host parent supervising a child; kill the child and the host immediately
# brings it back with `--resume <transcript>`, cron and all, under a new pid.
# Learned the hard way: three "cleaned up" runs were still firing a 1-minute
# cron minutes later. Always walk up to the host.
kill_hard() { # <pid>
  local pid="$1" ppid
  [ -n "$pid" ] || return 0
  ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -n "$ppid" ] && ps -o command= -p "$ppid" 2>/dev/null | grep -q -- '--bg-pty-host'; then
    kill -TERM "$ppid" 2>/dev/null
    for _ in 1 2 3; do kill -0 "$ppid" 2>/dev/null || break; sleep 1; done
    kill -KILL "$ppid" 2>/dev/null
  fi
  kill -TERM "$pid" 2>/dev/null
  for _ in 1 2 3; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -KILL "$pid" 2>/dev/null
}

# Every process whose argv mentions this run: the pty host (it carries the
# launch args), the worker, and any resumed child.
run_pids() { pgrep -f -- "$NAME" 2>/dev/null | grep -v "^$$\$"; }

cleanup() {
  [ -n "$WATCHDOG" ] && kill "$WATCHDOG" 2>/dev/null
  # Evidence first, and outside $LAB - teardown deletes $LAB itself below, and
  # must never destroy the result.
  [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] && cp "$TRANSCRIPT" "$LAB/transcript.jsonl" 2>/dev/null
  mkdir -p "$EVIDENCE" 2>/dev/null
  cp "$LAB/hook.log" "$LAB/transcript.jsonl" "$LAB/launch.out" "$EVIDENCE/" 2>/dev/null
  if [ -z "$WORKER_PID" ] && [ -n "$SID" ]; then
    WORKER_PID="$(/usr/bin/python3 - "$SID" <<'PY' 2>/dev/null
import json, os, sys
sid = sys.argv[1]
p = os.path.expanduser("~/.claude/daemon/roster.json")
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)
for w in (d.get("workers") or {}).values():
    if isinstance(w, dict) and w.get("sessionId") == sid and w.get("pid"):
        print(w["pid"]); break
PY
)"
  fi
  [ -n "$WORKER_PID" ] && kill_hard "$WORKER_PID"
  # The run-scoped name is in the argv of every process belonging to this run,
  # and unlike a session id it is known before launch. Sweep until nothing is
  # left, since killing a child can briefly expose a host that was not matched.
  for _ in 1 2 3; do
    left="$(run_pids)"
    [ -z "$left" ] && break
    for p in $left; do kill_hard "$p"; done
    sleep 2
  done

  # Killing is still not the end of it. The daemon resurrects a background
  # session, and it survived both a pty-host kill and a project purge on its
  # own - three separate "successful" teardowns were still firing a 1-minute
  # cron minutes later. What finally sticks is taking away everything the
  # session needs to come back: its transcript (purge) AND its working
  # directory, which is also where its --settings file and hook script live.
  # Both are scoped to this run's throwaway paths by construction; the guard
  # below is there so a future edit cannot point them anywhere real.
  case "$LAB" in
    "$HOME/.cache/ka-e2e-"*)
      claude project purge "$LAB" -y >/dev/null 2>&1
      rm -rf "$LAB"
      ;;
    *) echo "refusing to purge unexpected lab path: $LAB" >&2 ;;
  esac
  for _ in 1 2 3; do
    left="$(run_pids)"
    [ -z "$left" ] && break
    for p in $left; do kill_hard "$p"; done
    sleep 2
  done
  # Verdict on the processes, not on `claude agents`: the daemon keeps listing a
  # session well after it dies, so the agent list raises false alarms. What
  # actually matters is that nothing is left running - crons are in-memory, so
  # they die with the process and keep firing as long as it lives.
  left="$(run_pids)"
  if [ -n "$left" ]; then
    echo "LEAKED SESSION $NAME pids=$(echo "$left" | tr '\n' ' ')- it is still firing a" >&2
    echo "1-minute cron. Kill those pids (and their --bg-pty-host parents) by hand." >&2
  fi
  # Crons created here are session-only (in-memory) and die with the process.
  # This only catches the case where that stops being true.
  if grep -rqs -- "$SENT" "$HOME/.claude/scheduled_tasks.json" 2>/dev/null; then
    echo "LEAKED CRON $SENT found in a durable store - delete it by hand" >&2
  fi
  echo "evidence: $EVIDENCE"
}
trap cleanup EXIT INT TERM

die() { echo "FATAL: $*" >&2; exit 1; }

deadline_check() {
  [ "$(date +%s)" -lt "$HARD_DEADLINE" ] || die "hard deadline exceeded"
}

# --- rig ----------------------------------------------------------------------

printf '%s' "$SENT" > "$LAB/sentinel"
echo 0 > "$LAB/stamp"   # start stale, so tick 1 is allowed

cat > "$LAB/gate.py" <<'PY'
#!/usr/bin/env python3
"""Stand-in for keepalive-guard.sh: same decision, but it logs every invocation
before deciding, so 'the hook fired' is provable independently of the transcript."""
import datetime, json, os, sys, time

LAB = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(LAB, "hook.log")


def log(decision, age, payload):
    prompt = str(payload.get("prompt", "")).replace("\t", "\\t").replace("\n", "\\n")
    with open(LOG, "a") as f:
        f.write("\t".join([
            datetime.datetime.now().isoformat(timespec="seconds"),
            "%.3f" % time.time(),
            decision,
            "age=%s" % age,
            "sid=%s" % payload.get("session_id", ""),
            "tp=%s" % payload.get("transcript_path", ""),
            "prompt=%s" % prompt,
        ]) + "\n")


payload = {}
try:
    sentinel = open(os.path.join(LAB, "sentinel")).read().strip()
    payload = json.loads(sys.stdin.read())
    prompt = str(payload.get("prompt", ""))
    try:
        stamped = int(open(os.path.join(LAB, "stamp")).read().strip() or "0")
    except Exception:
        stamped = 0
    age = int(time.time() - stamped) if stamped else 10 ** 9

    if prompt.strip() != sentinel:
        log("PASSTHRU", age, payload)
    elif age < 600:
        log("BLOCK", age, payload)
        sys.stdout.write(json.dumps({
            "decision": "block",
            "reason": "ka-gate: cache fresh (age=%ds), cancelled %s" % (age, sentinel),
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "suppressOriginalPrompt": True,
            },
        }))
    else:
        log("ALLOW", age, payload)
except Exception as exc:  # a crashed hook must never look like a deliberate block
    try:
        log("CRASH:%s" % type(exc).__name__, -1, payload)
    except Exception:
        pass
sys.exit(0)
PY

/usr/bin/python3 - "$LAB" > "$LAB/settings.json" <<'PY'
import json, sys
lab = sys.argv[1]
print(json.dumps({
    "env": {"CC_KEEPALIVE_OFF": "1"},
    "hooks": {"UserPromptSubmit": [{"hooks": [
        {"type": "command", "command": '/usr/bin/python3 "%s/gate.py"' % lab, "timeout": 10}
    ]}]},
}, indent=2))
PY

SEED="Call the CronCreate tool exactly once, with exactly these arguments:
  cron: \"* * * * *\"
  prompt: $SENT
  recurring: true
The prompt argument must be the literal string $SENT - no quotes, no punctuation,
no prefix, no suffix. Do not call any other tool. Do not read or write any file.
After CronCreate returns, reply with exactly: CRON_READY
Then stop and stay idle.
Whenever you are later given the prompt $SENT, reply with exactly: TICK and end
the turn - no thinking, no tool calls, no narration."

# --- launch -------------------------------------------------------------------

( sleep 660; kill -TERM $$ ) 2>/dev/null &
WATCHDOG=$!

echo "run=$RUN name=$NAME sentinel=$SENT"
echo "lab=$LAB"

# --permission-mode manual is mandatory, not cosmetic: CronCreate returns a
#   classifier-review passthrough in auto mode, and auto is the default here.
#   `manual` is the CLI spelling of the internal `default` mode.
# --setting-sources project in a scratch dir drops user settings entirely, so no
#   personal hooks and no enabledPlugins - cc-cache-keepalive itself cannot load
#   and cannot create a competing cron. --settings is flagSettings, which the
#   resolver always includes, so our gate survives the filter.
# --bg is required: the cron scheduler lives in the REPL, so `claude -p` has none.
( cd "$LAB" && claude --bg \
    --permission-mode manual \
    --setting-sources project \
    --settings "$LAB/settings.json" \
    -n "$NAME" \
    "$SEED" ) > "$LAB/launch.out" 2>&1 \
  || die "claude --bg failed: $(cat "$LAB/launch.out")"

# The first hook line comes from the seed prompt itself. It proves the hook is
# registered *before* any cron exists, so an empty log later means "hook never
# loaded", not "hook does not fire for cron ticks" - and it hands us the
# transcript path straight from the CLI instead of us re-deriving the mangling.
for _ in $(seq 1 45); do
  [ -s "$LAB/hook.log" ] && break
  deadline_check; sleep 2
done
[ -s "$LAB/hook.log" ] || die "hook never fired for the seed prompt - it is not registered"
TRANSCRIPT="$(head -n1 "$LAB/hook.log" | tr '\t' '\n' | sed -n 's/^tp=//p')"
SID="$(head -n1 "$LAB/hook.log" | tr '\t' '\n' | sed -n 's/^sid=//p')"
[ -n "$TRANSCRIPT" ] || die "hook log carried no transcript_path"
echo "session=$SID"
echo "transcript=$TRANSCRIPT"

count_fires() { # counts cron ticks seen so far
  /usr/bin/python3 - "$TRANSCRIPT" "$SENT" <<'PY' 2>/dev/null || echo 0
import json, sys
path, sent = sys.argv[1], sys.argv[2]
n = 0
try:
    for line in open(path, errors="replace"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("type") == "queue-operation" and r.get("operation") == "enqueue" \
                and r.get("content") == sent:
            n += 1
except Exception:
    pass
print(n)
PY
}

wait_for_ticks() { # <n> <label>
  local want="$1" label="$2" got=0
  for _ in $(seq 1 75); do
    got="$(count_fires)"
    [ "${got:-0}" -ge "$want" ] && { echo "  $label: tick $want seen"; return 0; }
    deadline_check; sleep 2
  done
  die "timed out waiting for tick $want ($label)"
}

# Verify the cron was created with the exact arguments before spending ticks on
# a sentinel that would never match.
for _ in $(seq 1 45); do
  ok="$(/usr/bin/python3 - "$TRANSCRIPT" "$SENT" <<'PY' 2>/dev/null
import json, sys
path, sent = sys.argv[1], sys.argv[2]
try:
    for line in open(path, errors="replace"):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("type") != "assistant":
            continue
        for b in (r.get("message") or {}).get("content") or []:
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "CronCreate":
                i = b.get("input") or {}
                print("OK" if i.get("cron") == "* * * * *" and i.get("prompt") == sent
                      else "BAD %r %r" % (i.get("cron"), i.get("prompt")))
                sys.exit(0)
except Exception:
    pass
PY
)"
  [ -n "$ok" ] && break
  deadline_check; sleep 2
done
case "${ok:-}" in
  OK) echo "cron created with the exact sentinel" ;;
  "") die "no CronCreate call appeared - see $LAB/transcript.jsonl" ;;
  *)  die "cron created with wrong arguments: $ok" ;;
esac

# A tick is detected by its enqueue record, but the hook call for that same tick
# lands a beat later. Flipping the stamp immediately would put the flip within a
# second or two of a hook call and make that tick genuinely ambiguous. Ticks are
# 60s apart, so pausing before each flip costs nothing and keeps every
# invocation unambiguously on one side.
settle() { sleep 4; }

echo "phase 1: ALLOW (stamp stale)"
wait_for_ticks 1 "phase 1"
settle

date +%s > "$LAB/stamp"; T_ARM="$(date +%s)"
echo "armed at $T_ARM - phase 2: BLOCK"
wait_for_ticks 2 "phase 2"
settle

echo 0 > "$LAB/stamp"; T_DISARM="$(date +%s)"
echo "disarmed at $T_DISARM - phase 3: ALLOW"
wait_for_ticks 3 "phase 3"

sleep 5   # let the third turn land before we read
cp "$TRANSCRIPT" "$LAB/transcript.jsonl" 2>/dev/null

# --- analysis -----------------------------------------------------------------

cat > "$LAB/analyze.py" <<'PY'
#!/usr/bin/env python3
"""Segment the transcript into cron-tick windows and check each one."""
import json, sys

transcript, hooklog, sent = sys.argv[1], sys.argv[2], sys.argv[3]
t_arm, t_disarm = float(sys.argv[4]), float(sys.argv[5])

recs = []
for line in open(transcript, errors="replace"):
    line = line.strip()
    if not line:
        continue
    try:
        recs.append(json.loads(line))
    except Exception:
        pass


def is_tick_anchor(r):
    return (r.get("type") == "queue-operation" and r.get("operation") == "enqueue"
            and r.get("content") == sent)


def content_text(r):
    c = (r.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") for b in c if isinstance(b, dict))
    return ""


def descends_from(rec, root_uuid, by_uuid):
    """Is rec reachable from root_uuid by walking parentUuid?

    Not the same as a direct parent link: the CLI threads attachment records
    between the injected prompt and the reply, so the chain can be several hops.
    """
    seen = set()
    cur = rec
    while cur is not None:
        parent = cur.get("parentUuid")
        if parent is None or parent in seen:
            return False
        if parent == root_uuid:
            return True
        seen.add(parent)
        cur = by_uuid.get(parent)
    return False


anchors = [i for i, r in enumerate(recs) if is_tick_anchor(r)]
windows = []
for n, start in enumerate(anchors):
    end = anchors[n + 1] if n + 1 < len(anchors) else len(recs)
    w = recs[start:end]
    by_uuid = {r.get("uuid"): r for r in w if r.get("uuid")}
    user_meta = next((r for r in w if r.get("type") == "user" and r.get("isMeta")
                      and r.get("promptSource") == "system"
                      and content_text(r).strip() == sent), None)
    assistants = [r for r in w if r.get("type") == "assistant"]
    usage = 0
    for a in assistants:
        u = (a.get("message") or {}).get("usage") or {}
        usage += sum(int(u.get(k, 0) or 0) for k in
                     ("input_tokens", "output_tokens",
                      "cache_read_input_tokens", "cache_creation_input_tokens"))
    windows.append({
        "n": n + 1,
        "fire": any(r.get("type") == "system" and r.get("subtype") == "scheduled_task_fire"
                    for r in w),
        "user_meta": user_meta is not None,
        "chained": bool(user_meta) and any(
            descends_from(a, user_meta.get("uuid"), by_uuid) for a in assistants),
        "assistants": len(assistants),
        "usage": usage,
        "block_notice": any(r.get("type") == "system" and r.get("subtype") == "informational"
                            and str(r.get("content", "")).startswith(
                                "UserPromptSubmit operation blocked by hook:") for r in w),
    })

hooks = []
passthru = 0
for line in open(hooklog, errors="replace"):
    parts = line.rstrip("\n").split("\t")
    if len(parts) < 7:
        continue
    epoch, decision = float(parts[1]), parts[2]
    age = parts[3][len("age="):]
    prompt = parts[6][len("prompt="):]
    rec = {"epoch": epoch, "decision": decision, "prompt": prompt, "age": age}
    if decision.startswith("CRASH"):
        hooks.append(rec)
    elif decision == "PASSTHRU":
        passthru += 1
    elif prompt.strip() == sent:
        hooks.append(rec)


# A hook invocation used whatever the stamp held at that instant, so its epoch
# against the two flips is what classifies it. The only real ambiguity is an
# invocation racing the file write itself, hence the narrow band - the runner
# already spaces each flip several seconds away from the preceding tick.
def phase_of(epoch):
    if abs(epoch - t_arm) <= 1.5 or abs(epoch - t_disarm) <= 1.5:
        return "INDETERMINATE"
    if epoch < t_arm:
        return "allow-1"
    if epoch < t_disarm:
        return "block"
    return "allow-3"


print("%-6s %-6s %-10s %-10s %-6s %-9s %s" %
      ("tick", "fire", "user_meta", "assistants", "usage", "notice", "hook"))
fails = []
for i, w in enumerate(windows):
    h = hooks[i] if i < len(hooks) else {"decision": "-", "epoch": 0}
    ph = phase_of(h["epoch"]) if h["epoch"] else "?"
    print("%-6d %-6s %-10s %-10d %-6d %-9s %s (%s)" %
          (w["n"], w["fire"], w["user_meta"], w["assistants"], w["usage"],
           w["block_notice"], h["decision"], ph))

if passthru < 1:
    fails.append("no PASSTHRU line: the hook was never registered, so nothing here is measurable")
if any(h["decision"].startswith("CRASH") for h in hooks):
    fails.append("the gate crashed on at least one invocation")

allow_w = [(w, h) for w, h in zip(windows, hooks) if phase_of(h["epoch"]) in ("allow-1", "allow-3")]
block_w = [(w, h) for w, h in zip(windows, hooks) if phase_of(h["epoch"]) == "block"]

if len(allow_w) < 2:
    fails.append("need two allowed ticks as positive controls, got %d" % len(allow_w))
if len(block_w) < 1:
    fails.append("no tick landed in the armed phase")

def logged_age(h):
    try:
        return int(h["age"])
    except Exception:
        return -1


for w, h in allow_w:
    if h["decision"] != "ALLOW":
        fails.append("tick %d: expected the gate to allow, it said %s" % (w["n"], h["decision"]))
    # Independent of the epoch classification: the gate records the age it saw.
    if logged_age(h) < 600:
        fails.append("tick %d: gate saw a fresh stamp (age=%s) in an unarmed phase"
                     % (w["n"], h["age"]))
    if not w["user_meta"]:
        fails.append("tick %d: allowed tick has no injected user record" % w["n"])
    if not w["chained"]:
        fails.append("tick %d: no assistant reply chained to the injected prompt" % w["n"])
    if w["usage"] <= 0:
        fails.append("tick %d: allowed tick reported no token usage" % w["n"])

for w, h in block_w:
    if h["decision"] != "BLOCK":
        fails.append("tick %d: expected the gate to block, it said %s" % (w["n"], h["decision"]))
    if not 0 <= logged_age(h) < 600:
        fails.append("tick %d: gate saw age=%s in the armed phase" % (w["n"], h["age"]))
    if w["user_meta"]:
        fails.append("tick %d: CLAIM B FAILED - blocked tick still persisted a user record" % w["n"])
    if w["assistants"] or w["usage"]:
        fails.append("tick %d: CLAIM B FAILED - blocked tick produced %d assistant turn(s), %d tokens"
                     % (w["n"], w["assistants"], w["usage"]))

print()
if fails:
    print("VERDICT: FAIL")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("VERDICT: PASS")
print("  A) the hook fires for cron-injected prompts (%d ticks measured, %d sentinel "
      "invocations logged)" % (len(windows), len(hooks)))
print("  B) the blocked tick produced no assistant turn and no tokens")
for w, h in block_w:
    print("     tick %d: %d tokens vs %s on the allowed ticks"
          % (w["n"], w["usage"], ", ".join(str(a["usage"]) for a, _ in allow_w)))
sys.exit(0)
PY

echo
/usr/bin/python3 "$LAB/analyze.py" "$LAB/transcript.jsonl" "$LAB/hook.log" "$SENT" "$T_ARM" "$T_DISARM"
VERDICT=$?
exit "$VERDICT"
