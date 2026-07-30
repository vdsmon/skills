# cc-usage-guard

Pause Claude Code cleanly when you're about to hit a usage limit, then auto-resume when the window resets.

Three parts - one reader, one optional reader, one actor:

- **`hooks/usage-poller.sh`** (primary source): a `PostToolUse` + `UserPromptSubmit` hook. It fetches 5-hour + weekly usage from `GET /api/oauth/usage` - the same endpoint the CLI's own `/usage` view uses - and records it to `${CLAUDE_CONFIG_DIR:-~/.claude}/.usage-guard/usage.json`. Because it is a hook, it runs on **every surface**: terminal, the Claude desktop app, headless `-p` runs, background sessions, subagents. Throttled to one fetch per minute; prints nothing.
- **`hooks/usage-sensor.sh`** (optional supplement): a `statusLine` wrapper. `rate_limits` rides along on statusLine stdin (Pro/Max), so where a statusLine renders this refreshes the same state file for free, no network call of its own. Not required, and it cannot run in the desktop app - see [Why the poller exists](#why-the-poller-exists).
- **`hooks/usage-guard.sh`**: a `PostToolUse` + `UserPromptSubmit` hook. It reads that state and acts in two tiers, per window:
  - **WARN** (soft, lower threshold): a one-time heads-up nudging the model to land the current thread and reach a clean stopping point. No pause, no cron.
  - **PARK** (hard, higher threshold): injects a STOP, and the model pauses cleanly, schedules a one-shot `CronCreate` to auto-resume just after the limit resets, and fires a `PushNotification` so you learn about the park + resume time even when away. The session and its context stay alive across the limit, so the resume is in-context (no state dump needed).

  Each tier fires in full once per session per window-reset (a WARN that graduates to a PARK re-fires in full), then repeats as a short one-line reminder on a throttled interval until the level changes or the window resets - PARK repeats tighter than WARN, since ignoring a STOP is the worse failure mode.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-usage-guard@vdsmon-skills
```

That wires the poller and the guard automatically - nothing else is needed, on any surface.

The poller authenticates as you: it reads your Claude subscription OAuth token from the login keychain (item `Claude Code-credentials`), or from `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json` when that file exists, and sends it to `api.anthropic.com` only. The token is never written to disk or printed. API-key and Bedrock/Vertex sessions have no plan limits to read, so the poller records that and stays quiet.

## Optional: the statusLine sensor

Only worth wiring if you work in a terminal and want state refreshed with zero extra API calls. **A `statusLine` cannot be declared by a plugin**, so add it to `~/.claude/settings.json` by hand:

```json
"statusLine": {
  "type": "command",
  "command": "bash \"$HOME/.claude/plugins/marketplaces/vdsmon-skills/plugins/cc-usage-guard/hooks/usage-sensor.sh\"",
  "refreshInterval": 5
}
```

Point the path at the **marketplace checkout** (`~/.claude/plugins/marketplaces/<marketplace>/...`), not a personal clone of this repo. The marketplace checkout updates together with the installed plugin, so the sensor and the guard always come from the same version. A personal clone drifts: after a plugin update the guard runs new code while the statusLine still runs the old sensor, and if the state-file schema changed between the two versions the guard goes blind (it detects this and warns instead - see below). It must be your `statusLine` because that's the only stream carrying `rate_limits`. Avoid the versioned install path under `plugins/cache/` too - it breaks on every version bump.

## Why the poller exists

The sensor alone was not enough, because a statusLine only exists where something renders one:

- The **Claude desktop app** (session `entrypoint: "claude-desktop"`) never invokes the `statusLine` command at all. Correct wiring, `jq` and the renderer on PATH, a sensor that works under test - and the state file still never updates.
- **Background and headless** sessions (`claude --bg`, cron runners, subagent fleets) render no statusLine either, so a machine running only unattended work went stale even in a terminal.

In both cases the guard could see nothing and the account could sail past its limit. Hooks have none of that dependency: `PostToolUse` and `UserPromptSubmit` fire on every surface, so the poller keeps state fresh wherever Claude Code runs. The sensor stays supported as the free-of-charge path for attended terminal work.

**Multiple profiles / accounts** (separate `CLAUDE_CONFIG_DIR` dirs, e.g. personal + work subscriptions): every part derives its state dir from `CLAUDE_CONFIG_DIR` (falling back to `~/.claude`), which hooks and the statusLine command inherit from the CLI process, so each profile tracks its own usage in its own `<profile>/.usage-guard/`. Credentials follow the same rule *when the profile has its own `.credentials.json`*; profiles that share the login keychain item share one token, so point each profile at its own account with `CLAUDE_USAGE_KEYCHAIN_SERVICE` if the keychain holds separate items. If you also wire the optional sensor, wire it into **each** profile's `settings.json` (for a directory-sourced marketplace the local path *is* the marketplace checkout - point that profile's statusLine there).

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
| `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN` | `15` | minutes before the guard treats the usage state as stale and warns |
| `CLAUDE_USAGE_POLL_INTERVAL_SEC` | `60` | minimum state age before the poller fetches again |
| `CLAUDE_USAGE_POLL_TIMEOUT_SEC` | `3` | hard timeout on the poller's fetch, so a hook never hangs on the network |
| `CLAUDE_USAGE_KEYCHAIN_SERVICE` | `Claude Code-credentials` | keychain item the poller reads the OAuth token from |
| `CLAUDE_USAGE_ENDPOINT` | `https://api.anthropic.com/api/oauth/usage` | usage endpoint (override mainly for tests) |
| `CLAUDE_USAGE_SENSOR_DEFER_SEC` | `90` | state age below which the sensor leaves the file to the poller |
| `CLAUDE_USAGE_RENDER_CMD` | `ccstatusline` | downstream status-line renderer the sensor pipes to |

Keep each `WARN` below its `THRESHOLD` (warn fires on the approach; park fires at the cap).

The sensor defaults to [`ccstatusline`](https://github.com/sirmalloc/ccstatusline) as the renderer. If that command isn't on PATH (or you point `CLAUDE_USAGE_RENDER_CMD` at something missing), it falls back to a minimal built-in line (`5h NN% | wk NN%`) instead of dumping raw JSON.

## Subagents, teammates, and nesting

The hooks fire inside spawned agents too, so the guard stays correct when work fans out:

- It detects a spawned context by the hook payload's `agent_id` (empirically non-empty + unique for every subagent, across all of Claude Code's up-to-5 nesting levels, and for every team teammate; empty only on a root/main session). `agent_type` is deliberately *not* used: a root can report `agent_type: "claude"` with an empty `agent_id`, which would misclassify it.
- **Main/root session:** full WARN -> PARK (STOP + auto-resume cron + push).
- **Subagent or teammate (at any depth):** silent at WARN (keeps the runway; its parent is blocked and can't re-check meanwhile), and at PARK it gets a **wind-down**: finish the step and return, don't start new work or spawn further agents, and *don't* schedule a pause/cron (it can't pause the session). The wind-down cascades up the stack until the main session runs the real park. The main session's WARN also tells it not to *launch* new subagent fleets while near the cap.
- Markers key on `session_id` + `agent_id`, so the main session and every spawned agent fire (and repeat) independently, no cross-muting.

## Source liveness (the guard fails loud, not blind)

The guard only sees what a source writes. Before acting on the state file it checks that something is actually refreshing it, and if not it injects a **one-time-per-session warning** into the root session (spawned agents stay silent; their parent gets the same warning) instead of silently doing nothing:

- **Missing state file**: no source has written yet - usually the plugin's hooks are disabled, or the very first poll has not landed.
- **Stale state file** (older than `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN`): nothing is refreshing usage state. With the poller in place this means its fetches are failing, which is why the warning quotes the poller's own last error.
- **Schema mismatch**: sources stamp `schema: 2` into the state file and the guard refuses anything else, so a source and guard from different plugin versions (a drifted personal clone, a stale versioned cache path) fail loud instead of the guard reading nulls off renamed keys.
- **Unreadable state file** (empty or invalid JSON): the guard retries once after 200ms, then decides by freshness. A *fresh* unreadable file means a source is actively writing and the guard caught a torn read - it skips the cycle silently. A *stale* unreadable file means a source wrote a bad state and stopped - that faults loud like the cases above. (Both sources write atomically - tmp file + rename - and never overwrite good state when their own jq call fails, so this case is a belt-and-braces guard for mixed-version rollouts.)
- **Missing `jq`**: without jq no part can function; the guard warns once per machine (not per session) and points at the fix, and the sensor's built-in status-line fallback prints a visible `usage sensor blind` notice instead of going blank.

Hooks on the same event are not ordered against each other, so on a session's first turn the guard could read state the poller was about to write. Rather than depend on ordering, the guard polls once itself (throttle bypassed) whenever it finds no usable state, and only faults if that fetch also fails - so an "offline" warning always means the source really is broken.

The poller records why its last fetch failed in `<state dir>/poller-last-error` (expired token, no `curl`, HTTP status) and clears it on success; the guard quotes that line in its warning, so the message names the real cause instead of sending you to check wiring. While any fault holds, WARN/PARK cannot fire - the warning says so explicitly. It re-arms if the source recovers and later goes dark again in the same session.

## Notes

- The poller reads **live account data**, so it needs no staleness heuristics. The sensor's `rate_limits`, by contrast, is a snapshot of its session's **last API response**, so an idle session keeps re-rendering a frozen snapshot every statusLine refresh. The sensor refuses to write any snapshot whose 5-hour reset is already past (it provably predates a window rollover), and the guard ignores windows whose reset is past - so a day-old over-limit snapshot from a still-open session can neither poison the state file nor trigger a false park. Side effect of the guard check: repeat reminders stop on their own once a window resets, even if nothing refreshes the state.
- The poller wins over the sensor by design. Both write the same schema, but the sensor's snapshot can be hours old while still inside its window, so writing it over live data would be a downgrade. The sensor therefore skips its write whenever the state file is younger than `CLAUDE_USAGE_SENSOR_DEFER_SEC` (90s, comfortably above the poller's 60s floor) - with the poller healthy the sensor stays quiet, and it takes over automatically if the poller stops.
- The poller costs one small authenticated GET per minute at most, only on turns where a hook fires, with a 3-second timeout so a slow network can never hang a tool call.
- macOS/BSD: the guard uses `date -r <epoch>` for reset-time math and `stat -f %m` for the repeat-throttle clock; the poller uses `stat -f %m` and the login keychain via `security`. On Linux that would need `date -d @<epoch>`, `stat -c %Y`, and a `.credentials.json` for the token.
- Requires `jq` and `awk` on PATH (missing jq fails loud, see above), plus `curl` for the poller.
- State lives at `${CLAUDE_CONFIG_DIR:-~/.claude}/.usage-guard/` (created on first run), not inside the plugin dir, because the statusLine sensor gets no `${CLAUDE_PLUGIN_ROOT}` and every part must derive the same per-profile path. Stale session markers (>7 days) and orphaned tmp files are garbage-collected on prompt-submit.
- Tests: `bash plugins/cc-usage-guard/tests/test-usage-guard.sh` (or `mise run test:usage-guard`); add `--soak` for a concurrent write/read race check.
