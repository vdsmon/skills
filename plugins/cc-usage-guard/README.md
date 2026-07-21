# cc-usage-guard

Pause Claude Code cleanly when you're about to hit a usage limit, then auto-resume when the window resets.

Two parts:

- **`hooks/usage-sensor.sh`**: a `statusLine` wrapper. Claude Code only exposes `rate_limits` on statusLine stdin (Pro/Max), so this is the one place the data can be read. It records 5-hour + weekly usage to `${CLAUDE_CONFIG_DIR:-~/.claude}/.usage-guard/usage.json`, then renders your normal status line.
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
  "command": "bash \"$HOME/.claude/plugins/marketplaces/vdsmon-skills/plugins/cc-usage-guard/hooks/usage-sensor.sh\"",
  "refreshInterval": 5
}
```

Point the path at the **marketplace checkout** (`~/.claude/plugins/marketplaces/<marketplace>/...`), not a personal clone of this repo. The marketplace checkout updates together with the installed plugin, so the sensor and the guard always come from the same version. A personal clone drifts: after a plugin update the guard runs new code while the statusLine still runs the old sensor, and if the state-file schema changed between the two versions the guard goes blind (it now detects this and warns instead - see below). The sensor must be your `statusLine` because that's the only stream carrying `rate_limits`. Avoid the versioned install path under `plugins/cache/` too - it breaks on every version bump.

**Multiple profiles / accounts** (separate `CLAUDE_CONFIG_DIR` dirs, e.g. personal + work subscriptions): wire the sensor into **each** profile's `settings.json`. Both halves derive their state dir from `CLAUDE_CONFIG_DIR` (falling back to `~/.claude`), which hooks and the statusLine command inherit from the CLI process, so every profile tracks its own account's usage in its own `<profile>/.usage-guard/`. A profile with the guard enabled but no sensor wired trips the liveness gate below instead of silently reading another account's numbers. For a directory-sourced marketplace (`/plugin marketplace add <local path>`) the local path *is* the marketplace checkout - point that profile's statusLine there.

## Config (env vars)

| Var | Default | Effect |
| --- | --- | --- |
| `CLAUDE_USAGE_THRESHOLD_5H` (or `CLAUDE_USAGE_THRESHOLD`) | `97` | 5-hour window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_THRESHOLD_WEEKLY` | `99` | weekly window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_WARN_5H` | `90` | 5-hour window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_WARN_WEEKLY` | `96` | weekly window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_RESUME_BUFFER_MIN` | `1` | minutes after reset to schedule the auto-resume cron |
| `CLAUDE_USAGE_REMIND_PARK_MIN` | `1` | minutes between throttled PARK repeat reminders |
| `CLAUDE_USAGE_REMIND_WARN_MIN` | `5` | minutes between throttled WARN repeat reminders |
| `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN` | `15` | minutes before the guard treats the sensor state as stale and warns |
| `CLAUDE_USAGE_RENDER_CMD` | `ccstatusline` | downstream status-line renderer the sensor pipes to |

Keep each `WARN` below its `THRESHOLD` (warn fires on the approach; park fires at the cap).

The sensor defaults to [`ccstatusline`](https://github.com/sirmalloc/ccstatusline) as the renderer. If that command isn't on PATH (or you point `CLAUDE_USAGE_RENDER_CMD` at something missing), it falls back to a minimal built-in line (`5h NN% | wk NN%`) instead of dumping raw JSON.

## Subagents, teammates, and nesting

The hooks fire inside spawned agents too, so the guard stays correct when work fans out:

- It detects a spawned context by the hook payload's `agent_id` (empirically non-empty + unique for every subagent, across all of Claude Code's up-to-5 nesting levels, and for every team teammate; empty only on a root/main session). `agent_type` is deliberately *not* used: a root can report `agent_type: "claude"` with an empty `agent_id`, which would misclassify it.
- **Main/root session:** full WARN -> PARK (STOP + auto-resume cron + push).
- **Subagent or teammate (at any depth):** silent at WARN (keeps the runway; its parent is blocked and can't re-check meanwhile), and at PARK it gets a **wind-down**: finish the step and return, don't start new work or spawn further agents, and *don't* schedule a pause/cron (it can't pause the session). The wind-down cascades up the stack until the main session runs the real park. The main session's WARN also tells it not to *launch* new subagent fleets while near the cap.
- Markers key on `session_id` + `agent_id`, so the main session and every spawned agent fire (and repeat) independently, no cross-muting.

## Sensor liveness (the guard fails loud, not blind)

The guard only sees what the sensor writes, and the sensor only runs when a statusLine renders. Before acting on the state file, the guard checks that the sensor is actually alive, and if not it injects a **one-time-per-session warning** into the root session (spawned agents stay silent; their parent gets the same warning) instead of silently doing nothing:

- **Missing state file**: the statusLine was never wired to `usage-sensor.sh`.
- **Stale state file** (older than `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN`): no attended session is rendering a statusLine. Background/headless sessions (`claude --bg`, cron runners, subagent fleets) do **not** render one, so a machine running only unattended work stops refreshing the state even when wired correctly. Keep an attended session open while unattended fleets burn budget, or the guard cannot see usage.
- **Schema mismatch**: the sensor stamps `schema: 2` into the state file and the guard refuses anything else, so a sensor and guard from different plugin versions (a drifted personal clone, a stale versioned cache path) fail loud instead of the guard reading nulls off renamed keys.
- **Unreadable state file** (empty or invalid JSON): the guard retries once after 200ms, then decides by freshness. A *fresh* unreadable file means a sensor is actively writing and the guard caught a torn read - it skips the cycle silently. A *stale* unreadable file means the sensor wrote a bad state and stopped - that faults loud like the cases above. (The sensor writes atomically - tmp file + rename - and never overwrites good state when its own jq call fails, so this case is a belt-and-braces guard for mixed-version rollouts where an older sensor still truncates in place.)
- **Missing `jq`**: without jq neither half can function; the guard warns once per machine (not per session) and points at the fix, and the sensor's built-in status-line fallback prints a visible `usage sensor blind` notice instead of going blank.

While any of these hold, WARN/PARK cannot fire - the warning says so explicitly and points at the fix. The warning re-arms if the sensor recovers and later goes dark again in the same session.

## Notes

- A session's `rate_limits` is a snapshot of its **last API response**, not live account data, so an idle session keeps re-rendering a frozen snapshot every statusLine refresh. The sensor refuses to write any snapshot whose 5-hour reset is already past (it provably predates a window rollover), and the guard ignores windows whose reset is past - so a day-old over-limit snapshot from a still-open session can neither poison the state file nor trigger a false park. Side effect of the guard check: repeat reminders stop on their own once a window resets, even if no sensor refreshes the state.
- macOS/BSD: the guard uses `date -r <epoch>` for reset-time math and `stat -f %m` for the repeat-throttle clock. On Linux that would need `date -d @<epoch>` and `stat -c %Y`.
- Requires `jq` and `awk` on PATH (missing jq fails loud, see above).
- State lives at `${CLAUDE_CONFIG_DIR:-~/.claude}/.usage-guard/` (created on first run), not inside the plugin dir, because the statusLine sensor gets no `${CLAUDE_PLUGIN_ROOT}` and both halves must derive the same per-profile path. Stale session markers (>7 days) and orphaned sensor tmp files are garbage-collected on prompt-submit.
- Tests: `bash plugins/cc-usage-guard/tests/test-usage-guard.sh` (or `mise run test:usage-guard`); add `--soak` for a concurrent write/read race check.
