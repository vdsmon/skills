# cc-usage-guard

Pause Claude Code cleanly when you're about to hit a usage limit, then auto-resume when the window resets.

Two parts:

- **`hooks/usage-sensor.sh`**: a `statusLine` wrapper. Claude Code only exposes `rate_limits` on statusLine stdin (Pro/Max), so this is the one place the data can be read. It records 5-hour + weekly usage to `~/.claude/.usage-guard/usage.json`, then renders your normal status line.
- **`hooks/usage-guard.sh`**: a `PostToolUse` + `UserPromptSubmit` hook. It reads that state and acts in two tiers, per window:
  - **WARN** (soft, lower threshold): a one-time heads-up nudging the model to land the current thread and reach a clean stopping point. No pause, no cron.
  - **PARK** (hard, higher threshold): injects a STOP, and the model pauses cleanly, schedules a one-shot `CronCreate` to auto-resume just after the limit resets, and fires a `PushNotification` so you learn about the park + resume time even when away. The session and its context stay alive across the limit, so the resume is in-context (no state dump needed).

  Each tier fires in full once per session per window-reset (a WARN that graduates to a PARK re-fires in full), then repeats as a short one-line reminder on a throttled interval until the level changes or the window resets - PARK repeats tighter than WARN, since ignoring a STOP is the worse failure mode.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-usage-guard@vdsmon-skills
```

That wires the guard hooks automatically. **The sensor is a `statusLine`, which a plugin cannot declare**, so add it to `~/.claude/settings.json` by hand:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/repos/personal/skills/plugins/cc-usage-guard/hooks/usage-sensor.sh",
  "refreshInterval": 5
}
```

(Point the path wherever the plugin lives; the install copy works too. The sensor must be your `statusLine` because that's the only stream carrying `rate_limits`.)

## Config (env vars)

| Var | Default | Effect |
| --- | --- | --- |
| `CLAUDE_USAGE_THRESHOLD_5H` (or `CLAUDE_USAGE_THRESHOLD`) | `97` | 5-hour window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_THRESHOLD_WEEKLY` | `99` | weekly window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_WARN_5H` | `90` | 5-hour window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_WARN_WEEKLY` | `96` | weekly window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_RESUME_BUFFER_MIN` | `2` | minutes after reset to schedule the auto-resume cron |
| `CLAUDE_USAGE_REMIND_PARK_MIN` | `1` | minutes between throttled PARK repeat reminders |
| `CLAUDE_USAGE_REMIND_WARN_MIN` | `5` | minutes between throttled WARN repeat reminders |
| `CLAUDE_USAGE_RENDER_CMD` | `ccstatusline` | downstream status-line renderer the sensor pipes to |

Keep each `WARN` below its `THRESHOLD` (warn fires on the approach; park fires at the cap).

The sensor defaults to [`ccstatusline`](https://github.com/sirmalloc/ccstatusline) as the renderer. If that command isn't on PATH (or you point `CLAUDE_USAGE_RENDER_CMD` at something missing), it falls back to a minimal built-in line (`5h NN% | wk NN%`) instead of dumping raw JSON.

## Subagents, teammates, and nesting

The hooks fire inside spawned agents too, so the guard stays correct when work fans out:

- It detects a spawned context by the hook payload's `agent_id` (empirically non-empty + unique for every subagent, across all of Claude Code's up-to-5 nesting levels, and for every team teammate; empty only on a root/main session). `agent_type` is deliberately *not* used: a root can report `agent_type: "claude"` with an empty `agent_id`, which would misclassify it.
- **Main/root session:** full WARN -> PARK (STOP + auto-resume cron + push).
- **Subagent or teammate (at any depth):** silent at WARN (keeps the runway; its parent is blocked and can't re-check meanwhile), and at PARK it gets a **wind-down**: finish the step and return, don't start new work or spawn further agents, and *don't* schedule a pause/cron (it can't pause the session). The wind-down cascades up the stack until the main session runs the real park. The main session's WARN also tells it not to *launch* new subagent fleets while near the cap.
- Markers key on `session_id` + `agent_id`, so the main session and every spawned agent fire (and repeat) independently, no cross-muting.

## Notes

- macOS/BSD: the guard uses `date -r <epoch>` for reset-time math and `stat -f %m` for the repeat-throttle clock. On Linux that would need `date -d @<epoch>` and `stat -c %Y`.
- Requires `jq` and `awk` on PATH.
- State lives at `~/.claude/.usage-guard/` (created on first run), not inside the plugin dir, because the statusLine sensor gets no `${CLAUDE_PLUGIN_ROOT}` and both halves must agree on one path.
