#!/usr/bin/env bash
# PostToolUse + UserPromptSubmit hook. Reads usage state written by usage-sensor.sh.
# When a usage window crosses the hard threshold, injects a pause+auto-resume instruction
# via hookSpecificOutput.additionalContext. Debounced once per window-reset.
# Session/context stays alive across the limit, so resume is in-context; no state file needed.
# Note: epoch math uses `date -r` (macOS/BSD). Linux would need `date -d @epoch`.
export PATH="/opt/homebrew/bin:$HOME/.local/share/mise/shims:/bin:/usr/bin:$PATH"

# hard PARK thresholds (stop + auto-resume) and soft WARN thresholds (one nudge), per window
FIVE_THRESHOLD="${CLAUDE_USAGE_THRESHOLD_5H:-${CLAUDE_USAGE_THRESHOLD:-97}}"
SEVEN_THRESHOLD="${CLAUDE_USAGE_THRESHOLD_WEEKLY:-99}"
FIVE_WARN="${CLAUDE_USAGE_WARN_5H:-90}"
SEVEN_WARN="${CLAUDE_USAGE_WARN_WEEKLY:-96}"
BUFFER_MIN="${CLAUDE_USAGE_RESUME_BUFFER_MIN:-2}"
STATE_DIR="$HOME/.claude/.usage-guard"
state="$STATE_DIR/usage.json"

input=$(cat)
evt=$(printf '%s' "$input" | jq -r '.hook_event_name // "PostToolUse"' 2>/dev/null)
if [ -z "$evt" ] || [ "$evt" = "null" ]; then evt="PostToolUse"; fi

# per-session debounce marker. a single shared marker muted every concurrent
# session except the first to cross the threshold (it wrote the marker; the rest
# matched it and exited silent), so parallel jobs never saw the STOP. key the
# marker by session_id so each session warns once per window-reset. fall back to
# the shared name when session_id is absent.
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
marker="$STATE_DIR/usage-park-marker${sid:+-$sid}"

[ -f "$state" ] || exit 0
vals=$(jq -r '[(.five // -1),(.seven // -1),(.five_reset // 0),(.seven_reset // 0)] | @tsv' "$state" 2>/dev/null)
[ -z "$vals" ] && exit 0
IFS=$'\t' read -r five seven five_reset seven_reset <<< "$vals"

# pick the most severe window: level 2=park, 1=warn, 0=none; tie-break on higher pct
read -r sel level <<< "$(awk -v f="$five" -v s="$seven" \
  -v ft="$FIVE_THRESHOLD" -v st="$SEVEN_THRESHOLD" -v wt5="$FIVE_WARN" -v wt7="$SEVEN_WARN" 'BEGIN{
  fl=(f>=ft)?2:((f>=wt5)?1:0);
  sl=(s>=st)?2:((s>=wt7)?1:0);
  ml=(fl>sl)?fl:sl;
  if(ml==0){ print ""; exit }
  fc=(fl==ml); sc=(sl==ml);
  if(fc&&sc){ if(f>=s) print "five " ml; else print "seven " ml }
  else if(fc) print "five " ml; else print "seven " ml;
}')"
if [ -z "$sel" ]; then rm -f "$marker"; exit 0; fi

if [ "$sel" = "five" ]; then pct="$five"; reset="$five_reset"; window="5-hour"
else pct="$seven"; reset="$seven_reset"; window="weekly"; fi
reset_int=${reset%%.*}
pct_int=${pct%%.*}

# debounce: fire once per (window:level:reset); a warn->park graduation re-fires
key="$window:$level:$reset_int"
[ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$key" ] && exit 0

# compute reset wall-clock + one-shot cron fields for wake = reset + buffer
hhmm=""; cron=""
if [ "$reset_int" -gt 0 ] 2>/dev/null; then
  wake=$((reset_int + BUFFER_MIN*60))
  hhmm=$(date -r "$reset_int" '+%H:%M' 2>/dev/null)
  cmin=$(date -r "$wake" '+%M' 2>/dev/null); chour=$(date -r "$wake" '+%H' 2>/dev/null)
  cdom=$(date -r "$wake" '+%d' 2>/dev/null); cmon=$(date -r "$wake" '+%m' 2>/dev/null)
  if [ -n "$cmin" ]; then cron="$((10#$cmin)) $((10#$chour)) $((10#$cdom)) $((10#$cmon)) *"; fi
fi
[ -n "$hhmm" ] || hhmm="soon (check /usage)"

if [ "$level" = "2" ]; then
  if [ -n "$cron" ]; then
    resume_step="3. Schedule auto-resume: use the CronCreate tool (load it via ToolSearch if needed) with cron \`$cron\` and prompt: \"RESUME: the usage limit has reset, continue the work we paused. Once resumed, delete this cron via CronDelete.\""
  else
    resume_step="3. Could not compute the reset time, so do not schedule a cron; tell the user to resume manually after the limit resets."
  fi
  msg="STOP - usage at ${pct_int}% of the ${window} limit; it resets ~${hhmm} local. This session and its context stay alive across the limit, so you do NOT need to dump state to a file - just pause cleanly and wake yourself when it resets:
1. Stop starting new work now (only finish an atomic step already in flight).
2. In one short message, note where you are and the immediate next step (stays in context for the resume).
${resume_step}
4. Then stop. Tell the user in chat you paused and will auto-resume ~${hhmm}, AND send the same as a push: use the PushNotification tool (load it via ToolSearch if needed) with a short message like \"cc-usage-guard: paused at ${pct_int}% of the ${window} limit, auto-resume ~${hhmm}\"."
else
  msg="HEADS UP - usage at ${pct_int}% of the ${window} limit (warn threshold); it resets ~${hhmm} local. You're approaching the cap, not at it yet. Start landing the current thread: prefer finishing or closing over starting big new work, and reach a clean stopping point soon. No need to pause yet - cc-usage-guard will STOP you and schedule auto-resume if you hit the hard limit."
fi

printf '%s' "$key" > "$marker"
jq -nc --arg evt "$evt" --arg ctx "$msg" '{hookSpecificOutput:{hookEventName:$evt,additionalContext:$ctx}}'
exit 0
