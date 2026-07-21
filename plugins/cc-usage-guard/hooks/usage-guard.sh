#!/usr/bin/env bash
# PostToolUse + UserPromptSubmit hook. Reads usage state written by usage-sensor.sh.
# When a usage window crosses a threshold, injects a pause+auto-resume (PARK) or
# heads-up (WARN) instruction via hookSpecificOutput.additionalContext. Fires once in
# full per (window:level:reset), then throttled short-form repeats until the level
# changes or the window resets - keeps pressure on an agent that ignores the first nudge.
# Session/context stays alive across the limit, so resume is in-context; no state file needed.
# Note: epoch/mtime math uses `date -r` / `stat -f` (macOS/BSD). Linux would need
# `date -d @epoch` / `stat -c %Y`.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:/bin:/usr/bin:$PATH"

# hard PARK thresholds (stop + auto-resume) and soft WARN thresholds (one nudge), per window
FIVE_HOUR_THRESHOLD="${CLAUDE_USAGE_THRESHOLD_5H:-${CLAUDE_USAGE_THRESHOLD:-97}}"
WEEKLY_THRESHOLD="${CLAUDE_USAGE_THRESHOLD_WEEKLY:-99}"
FIVE_HOUR_WARN="${CLAUDE_USAGE_WARN_5H:-90}"
WEEKLY_WARN="${CLAUDE_USAGE_WARN_WEEKLY:-96}"
BUFFER_MIN="${CLAUDE_USAGE_RESUME_BUFFER_MIN:-1}"
REMIND_PARK_MIN="${CLAUDE_USAGE_REMIND_PARK_MIN:-1}"
REMIND_WARN_MIN="${CLAUDE_USAGE_REMIND_WARN_MIN:-5}"
SENSOR_MAX_AGE_MIN="${CLAUDE_USAGE_SENSOR_MAX_AGE_MIN:-15}"
# profile dir (CLAUDE_CONFIG_DIR, inherited from the CLI process): state isolates per
# profile so multi-account machines never guard one account against another's usage
PROFILE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STATE_DIR="$PROFILE_DIR/.usage-guard"
state="$STATE_DIR/usage.json"

input=$(cat)

# jq gate: without jq the guard can parse neither stdin nor state, and the sensor writes
# nothing (its non-clobber write skips on empty jq output) - a silently blind guard, the
# exact failure mode the liveness gate exists to prevent. fail loud once per machine
# (missing jq is machine-level, not per-session) with hand-rolled JSON; safe because the
# message is fully static. hook_event_name comes from a sed scrape with a fallback.
if ! command -v jq >/dev/null 2>&1; then
  jq_marker="$STATE_DIR/jq-missing-warn-marker"
  [ -f "$jq_marker" ] && exit 0
  mkdir -p "$STATE_DIR"
  : > "$jq_marker"
  hook_event=$(printf '%s' "$input" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [ -n "$hook_event" ] || hook_event="PostToolUse"
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"cc-usage-guard SENSOR OFFLINE - jq is not on PATH, so the guard cannot read usage state. The guard is blind: WARN/PARK will NOT fire even if the account hits a rate limit. Fix: install jq (brew install jq). Relay this to the user in one short line in your next reply, then continue normally."}}\n' "$hook_event"
  exit 0
fi
rm -f "$STATE_DIR/jq-missing-warn-marker" 2>/dev/null

hook_event=$(printf '%s' "$input" | jq -r '.hook_event_name // "PostToolUse"' 2>/dev/null)
if [ -z "$hook_event" ] || [ "$hook_event" = "null" ]; then hook_event="PostToolUse"; fi

# GC: markers from sessions that ended while over-threshold or mid-fault are never
# cleaned by the in-session paths, and a crash between tmp write and rename can orphan
# a sensor tmp. sweep on UserPromptSubmit only (roughly once per turn) so the hot
# per-tool-call path stays find-free.
if [ "$hook_event" = "UserPromptSubmit" ] && [ -d "$STATE_DIR" ]; then
  find "$STATE_DIR" -maxdepth 1 -type f \
    \( \( -name '*-marker*' -mtime +7 \) -o \( -name 'usage.json.tmp.*' -mmin +60 \) \) \
    -delete 2>/dev/null
fi

# marker, keyed by session_id + agent_id. a parent, its subagents (any of
# the up-to-5 nesting depths), and its team teammates ALL share one session_id; a
# single shared marker muted every concurrent context except the first to cross the
# threshold. agent_id is the reliable "spawned agent" discriminator, verified
# empirically: non-empty + unique for every subagent and teammate, empty on a
# root/main session. agent_type is NOT used - a root can report agent_type "claude"
# with an empty agent_id, so it would misclassify a main session. keying the marker
# by session_id AND agent_id lets the main session and each spawned agent fire
# independently (once per window-reset each, then throttled repeats).
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
agent_id=$(printf '%s' "$input" | jq -r '.agent_id // empty' 2>/dev/null)
marker="$STATE_DIR/usage-park-marker${session_id:+-$session_id}${agent_id:+-$agent_id}"

# sensor liveness gate. a dead sensor used to mean a silently blind guard: no state
# file (statusLine never wired), a stale file (no attended session rendering; bg/headless
# sessions get no statusLine), or a schema from a different plugin version all made every
# threshold read as "fine". warn the root session once per session instead; spawned
# agents stay silent because their parent gets the same warning.
fault=""
if [ ! -f "$state" ]; then
  fault="state file missing (statusLine sensor never ran)"
else
  schema=$(jq -r '.schema // 0' "$state" 2>/dev/null)
  if [ -z "$schema" ]; then
    # empty or unparseable: almost certainly a read inside a pre-0.5.1 sensor's
    # truncate-then-write window (this exact race produced false version-skew
    # alerts). retry once past the window before judging.
    sleep 0.2
    schema=$(jq -r '.schema // 0' "$state" 2>/dev/null)
  fi
  now=$(date +%s)
  state_age=$(( now - $(stat -f %m "$state" 2>/dev/null || echo "$now") ))
  if [ -z "$schema" ]; then
    if [ "$state_age" -gt $((SENSOR_MAX_AGE_MIN * 60)) ]; then
      fault="state file unreadable (empty or invalid JSON), last written $((state_age / 60)) min ago (sensor wrote a bad state and stopped)"
    else
      # fresh but unreadable: a sensor is actively writing, so this is a torn
      # read, not a dead sensor. skip this cycle; the next read gets a whole
      # file. deliberately does not touch warn_marker - a transient skip must
      # not clear a legitimately armed fault warning.
      exit 0
    fi
  elif [ "$schema" != "2" ]; then
    fault="state schema is '$schema', guard expects 2 (sensor and guard come from different plugin versions - point the statusLine at the checkout the plugin runs from)"
  elif [ "$state_age" -gt $((SENSOR_MAX_AGE_MIN * 60)) ]; then
    fault="state is $((state_age / 60)) min old, max ${SENSOR_MAX_AGE_MIN} (no attended session is rendering the statusLine)"
  fi
fi
warn_marker="$STATE_DIR/sensor-warn-marker${session_id:+-$session_id}"
if [ -n "$fault" ]; then
  [ -n "$agent_id" ] && exit 0
  [ -f "$warn_marker" ] && exit 0
  mkdir -p "$STATE_DIR"
  printf '%s' "$fault" > "$warn_marker"
  msg="cc-usage-guard SENSOR OFFLINE - $fault. The guard is blind: WARN/PARK will NOT fire even if the account hits a rate limit. Fix: wire usage-sensor.sh as the statusLine command in $PROFILE_DIR/settings.json (see the plugin README) and keep an attended session open. Relay this to the user in one short line in your next reply, then continue normally."
  jq -nc --arg hook_event "$hook_event" --arg ctx "$msg" '{hookSpecificOutput:{hookEventName:$hook_event,additionalContext:$ctx}}'
  exit 0
fi
rm -f "$warn_marker"

usage_tsv=$(jq -r '[(.five_hour // -1),(.weekly // -1),(.five_hour_reset // 0),(.weekly_reset // 0)] | @tsv' "$state" 2>/dev/null)
[ -z "$usage_tsv" ] && exit 0
IFS=$'\t' read -r five_hour weekly five_hour_reset weekly_reset <<< "$usage_tsv"

# a window whose reset is already past cannot be over its limit: the pct is a stale
# snapshot from before the rollover (a >=0.6.1 sensor refuses to write those, but a
# pre-fix sensor in a still-open session can). drop the window instead of parking on
# it - a past reset would also put the suggested auto-resume cron on a date cron
# rolls over to next year. side effect: repeat reminders stop on their own once a
# window resets even if no sensor refreshes the state.
now=$(date +%s)
[ "${five_hour_reset%%.*}" -gt 0 ] 2>/dev/null && [ "${five_hour_reset%%.*}" -lt "$now" ] && five_hour=-1
[ "${weekly_reset%%.*}" -gt 0 ] 2>/dev/null && [ "${weekly_reset%%.*}" -lt "$now" ] && weekly=-1

# pick the most severe window: level 2=park, 1=warn, 0=none; tie-break on higher pct
read -r win_key level <<< "$(awk -v five_hour_pct="$five_hour" -v weekly_pct="$weekly" \
  -v five_hour_park_thresh="$FIVE_HOUR_THRESHOLD" -v weekly_park_thresh="$WEEKLY_THRESHOLD" \
  -v five_hour_warn_thresh="$FIVE_HOUR_WARN" -v weekly_warn_thresh="$WEEKLY_WARN" 'BEGIN{
  five_hour_lvl=(five_hour_pct>=five_hour_park_thresh)?2:((five_hour_pct>=five_hour_warn_thresh)?1:0);
  weekly_lvl=(weekly_pct>=weekly_park_thresh)?2:((weekly_pct>=weekly_warn_thresh)?1:0);
  max_lvl=(five_hour_lvl>weekly_lvl)?five_hour_lvl:weekly_lvl;
  if(max_lvl==0){ print ""; exit }
  five_hour_is_max=(five_hour_lvl==max_lvl); weekly_is_max=(weekly_lvl==max_lvl);
  if(five_hour_is_max&&weekly_is_max){ if(five_hour_pct>=weekly_pct) print "five_hour " max_lvl; else print "weekly " max_lvl }
  else if(five_hour_is_max) print "five_hour " max_lvl; else print "weekly " max_lvl;
}')"
if [ -z "$win_key" ]; then rm -f "$marker"; exit 0; fi

if [ "$win_key" = "five_hour" ]; then pct="$five_hour"; reset="$five_hour_reset"; window="5-hour"
else pct="$weekly"; reset="$weekly_reset"; window="weekly"; fi
reset_int=${reset%%.*}
pct_int=${pct%%.*}

# fire in full on the first crossing of a (window:level:reset) key, or on a
# warn->park graduation; after that, throttle repeats by wall-clock interval
# (tighter for PARK than WARN) instead of firing on literally every hook call
key="$window:$level:$reset_int"
stored_key=""
[ -f "$marker" ] && stored_key=$(cat "$marker" 2>/dev/null)
repeat_form="full"
if [ "$stored_key" = "$key" ]; then
  now=$(date +%s)
  marker_age=$(( now - $(stat -f %m "$marker" 2>/dev/null || echo "$now") ))
  interval_min=$([ "$level" = "2" ] && echo "$REMIND_PARK_MIN" || echo "$REMIND_WARN_MIN")
  [ "$marker_age" -lt "$((interval_min * 60))" ] && exit 0
  repeat_form="short"
fi

# compute reset wall-clock + one-shot cron fields for wake = reset + buffer
hhmm=""; cron=""
if [ "$reset_int" -gt 0 ] 2>/dev/null; then
  wake=$((reset_int + BUFFER_MIN*60))
  hhmm=$(date -r "$reset_int" '+%H:%M' 2>/dev/null)
  wake_min=$(date -r "$wake" '+%M' 2>/dev/null); wake_hour=$(date -r "$wake" '+%H' 2>/dev/null)
  wake_dom=$(date -r "$wake" '+%d' 2>/dev/null); wake_mon=$(date -r "$wake" '+%m' 2>/dev/null)
  if [ -n "$wake_min" ]; then cron="$((10#$wake_min)) $((10#$wake_hour)) $((10#$wake_dom)) $((10#$wake_mon)) *"; fi
fi
[ -n "$hhmm" ] || hhmm="soon (check /usage)"

if [ -n "$agent_id" ]; then
  # a spawned agent (subagent at any of the up-to-5 nesting depths, or a team
  # teammate): it can't pause the session or schedule a resume, and its parent is
  # blocked while it runs. brake only at the hard PARK (keep the warn runway);
  # finish + hand back so the parent parks on its next cycle. the wind-down
  # cascades up the stack until the main session parks.
  [ "$level" = "2" ] || exit 0
  if [ "$repeat_form" = "full" ]; then
    msg="WIND DOWN - you are a spawned agent (subagent or teammate) and account usage is AT the ${window} limit (${pct_int}%); it resets ~${hhmm} local. Stop now and return to your parent. Your final message IS the handoff, so make it a concise status report: (1) what you COMPLETED, (2) what is still UNFINISHED, (3) the exact NEXT STEP needed to finish. Do NOT start new work, expand scope, or spawn further subagents, and do NOT schedule any pause or cron - the main session parks once you return and will resume your unfinished work from your handoff after the limit resets."
  else
    msg="STILL AT the ${window} limit (${pct_int}%); resets ~${hhmm} local. Wind down and return now if you haven't already."
  fi
elif [ "$level" = "2" ]; then
  if [ "$repeat_form" = "full" ]; then
    if [ -n "$cron" ]; then
      resume_step="3. Schedule auto-resume: use the CronCreate tool (load it via ToolSearch if needed) with cron \`$cron\` and prompt: \"RESUME: the usage limit has reset, continue the work we paused. Once resumed, delete this cron via CronDelete.\""
    else
      resume_step="3. Could not compute the reset time, so do not schedule a cron; tell the user to resume manually after the limit resets."
    fi
    msg="STOP - usage at ${pct_int}% of the ${window} limit; it resets ~${hhmm} local. This session and its context stay alive across the limit, so you do NOT need to dump state to a file - just pause cleanly and wake yourself when it resets:
1. Stop starting new work now (only finish an atomic step already in flight; do not spawn new subagents).
2. In one short message, note where you are and the immediate next step (stays in context for the resume).
${resume_step}
4. Then stop. Tell the user in chat you paused and will auto-resume ~${hhmm}, AND send the same as a push: use the PushNotification tool (load it via ToolSearch if needed) with a short message like \"cc-usage-guard: paused at ${pct_int}% of the ${window} limit, auto-resume ~${hhmm}\"."
  else
    msg="STILL AT the ${window} limit (${pct_int}%); resets ~${hhmm} local. Stop now if you haven't already."
  fi
else
  if [ "$repeat_form" = "full" ]; then
    msg="HEADS UP - usage at ${pct_int}% of the ${window} limit (warn threshold); it resets ~${hhmm} local. You're approaching the cap, not at it yet. Start landing the current thread: prefer finishing or closing over starting big new work, and reach a clean stopping point soon. Also hold off on launching new subagents or parallel fleets now - they burn the same account-global budget unattended and run past this guard's reach. No need to pause yet - cc-usage-guard will STOP you and schedule auto-resume if you hit the hard limit."
  else
    msg="Still approaching the ${window} limit (${pct_int}%); resets ~${hhmm} local. Keep wrapping up."
  fi
fi

printf '%s' "$key" > "$marker"
jq -nc --arg hook_event "$hook_event" --arg ctx "$msg" '{hookSpecificOutput:{hookEventName:$hook_event,additionalContext:$ctx}}'
exit 0
