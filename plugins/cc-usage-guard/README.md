# cc-usage-guard

Pause Claude Code cleanly when you're about to hit a usage limit, then auto-resume when the window resets.

Two parts:

- **`hooks/usage-sensor.sh`** — a `statusLine` wrapper. Claude Code only exposes `rate_limits` on statusLine stdin (Pro/Max), so this is the one place the data can be read. It records 5-hour + weekly usage to `~/.claude/.usage-guard/usage.json`, then renders your normal status line.
- **`hooks/usage-guard.sh`** — a `PostToolUse` + `UserPromptSubmit` hook. It reads that state and, when a window crosses its threshold, injects a STOP: the model pauses cleanly and schedules a one-shot `CronCreate` to auto-resume just after the limit resets. The session and its context stay alive across the limit, so the resume is in-context — no state dump needed. Debounced once per session per window-reset.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-usage-guard@vdsmon-skills
```

That wires the guard hooks automatically. **The sensor is a `statusLine`, which a plugin cannot declare** — add it to `~/.claude/settings.json` by hand:

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
| `CLAUDE_USAGE_THRESHOLD_5H` (or `CLAUDE_USAGE_THRESHOLD`) | `97` | 5-hour window % that trips the STOP |
| `CLAUDE_USAGE_THRESHOLD_WEEKLY` | `99` | weekly window % that trips the STOP |
| `CLAUDE_USAGE_RESUME_BUFFER_MIN` | `2` | minutes after reset to schedule the auto-resume cron |
| `CLAUDE_USAGE_RENDER_CMD` | `ccstatusline` | downstream status-line renderer the sensor pipes to |

The sensor defaults to [`ccstatusline`](https://github.com/sirmalloc/ccstatusline) as the renderer. If that command isn't on PATH (or you point `CLAUDE_USAGE_RENDER_CMD` at something missing), it falls back to a minimal built-in line (`5h NN% | wk NN%`) instead of dumping raw JSON.

## Notes

- macOS/BSD: the guard uses `date -r <epoch>` for reset-time math. On Linux that would need `date -d @<epoch>`.
- Requires `jq` and `awk` on PATH.
- State lives at `~/.claude/.usage-guard/` (created on first run), not inside the plugin dir, because the statusLine sensor gets no `${CLAUDE_PLUGIN_ROOT}` and both halves must agree on one path.
