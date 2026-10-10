# cc-usage-guard

Pause Claude Code cleanly when you're about to hit a usage limit, then auto-resume when the window resets.

Three parts - one reader, one optional reader, one actor:

- **`hooks/usage-poller.sh`** (primary source): fetches 5-hour + weekly usage from `GET /api/oauth/usage` - the same endpoint the CLI's own `/usage` view uses - and records it to `~/.claude/.usage-guard/usage.json`. The guard runs it first on every hook call, so it works on **every surface**: terminal, the Claude desktop app, headless `-p` runs, background sessions, subagents. Throttled to one fetch per minute; prints nothing.
- **`hooks/usage-sensor.sh`** (optional supplement): a `statusLine` wrapper. `rate_limits` rides along on statusLine stdin (Pro/Max), so where a statusLine renders this refreshes the same state file for free, no network call of its own. Not required, and it cannot run in the desktop app - see [Why the poller exists](#why-the-poller-exists).
- **`hooks/usage-guard.sh`**: the plugin's one hook, on `PostToolUse` + `UserPromptSubmit`. It runs the poller, reads the state, and acts in two tiers, per window:
  - **WARN** (soft, lower threshold): a one-time heads-up nudging the model to land the current thread and reach a clean stopping point. No pause, no cron.
  - **PARK** (hard, higher threshold): injects a STOP, and the model pauses cleanly, schedules a one-shot `CronCreate` to auto-resume just after the limit resets, and fires a `PushNotification` so you learn about the park + resume time even when away. The session and its context stay alive across the limit, so the resume is in-context (no state dump needed).

  Each tier fires in full once per session per window-reset (a WARN that graduates to a PARK re-fires in full), then repeats as a short one-line reminder on a throttled interval until the level changes or the window resets - PARK repeats tighter than WARN, since ignoring a STOP is the worse failure mode.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-usage-guard@vdsmon-skills
```

That wires the guard (and with it the poller) automatically - nothing else is needed, on any surface.

The poller authenticates as you: it reads your Claude subscription OAuth token from the login keychain (item `Claude Code-credentials`), or from `~/.claude/.credentials.json` when that file exists, and sends it to `api.anthropic.com` only. The token is never written to disk or printed. API-key and Bedrock/Vertex sessions have no plan limits to read, so the poller records that and stays quiet.

**That token comes from a terminal login, and only from there** - signing into the desktop app does not create it. If you have never run `claude` in a terminal on this machine, do it once now, or the guard starts blind: see [the fix](#fix-sign-in-from-a-terminal).

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

The desktop app (session `entrypoint: "claude-desktop"`) and background or headless sessions (`claude --bg`, cron runners, subagent fleets) never render a `statusLine`, so the sensor cannot run there. Hooks fire on every surface, so the poller is the only usage source those sessions have.

## Config (env vars)

| Var | Default | Effect |
| --- | --- | --- |
| `CC_USAGE_GUARD_OFF` | unset | set to `1` to turn the guard off without uninstalling (no poll, no warnings) |
| `CLAUDE_USAGE_THRESHOLD_5H` (or `CLAUDE_USAGE_THRESHOLD`) | `97` | 5-hour window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_THRESHOLD_WEEKLY` | `99` | weekly window % that trips the hard PARK (STOP) |
| `CLAUDE_USAGE_WARN_5H` | `90` | 5-hour window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_WARN_WEEKLY` | `96` | weekly window % that trips the soft WARN nudge |
| `CLAUDE_USAGE_RESUME_BUFFER_MIN` | `1` | minutes after reset to schedule the auto-resume cron |
| `CLAUDE_USAGE_REMIND_PARK_MIN` | `1` | minutes between throttled PARK repeat reminders |
| `CLAUDE_USAGE_REMIND_WARN_MIN` | `5` | minutes between throttled WARN repeat reminders |
| `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN` | `15` | minutes before the guard treats the usage state as stale and warns |
| `CLAUDE_USAGE_POLL_INTERVAL_SEC` | `60` | minimum age of the poller's last *attempt* before it fetches again |
| `CLAUDE_USAGE_BACKOFF_FAIL_SEC` | `60` | pause after any failed fetch (timeout, 5xx) before the next attempt |
| `CLAUDE_USAGE_BACKOFF_429_SEC` | `300` | pause after a `429` that carries no usable `Retry-After` |
| `CLAUDE_USAGE_BACKOFF_MAX_SEC` | `3600` | cap on any backoff, so a wild `Retry-After` can't blind the guard for long |
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

The guard only sees what a source writes. Before acting on the state file it checks that something is actually refreshing it, and if not it injects a **one-time-per-session warning** (once per outage for a rate limit, see below) into the root session (spawned agents stay silent; their parent gets the same warning) instead of silently doing nothing:

- **Missing state file**: no source has written yet. The guard polls before it checks, so this means the poller's first fetch failed; the warning quotes why.
- **Stale state file** (older than `CLAUDE_USAGE_SENSOR_MAX_AGE_MIN`): nothing is refreshing usage state. With the poller in place this means its fetches are failing, which is why the warning quotes the poller's own last error.
- **Schema mismatch**: sources stamp `schema: 2` into the state file and the guard refuses anything else, so a source and guard from different plugin versions (a drifted personal clone, a stale versioned cache path) fail loud instead of the guard reading nulls off renamed keys.
- **Unreadable state file** (empty or invalid JSON): the guard retries once after 200ms, then decides by freshness. A *fresh* unreadable file is a torn read, skipped silently; a *stale* one means a source wrote a bad state and stopped, and faults loud like the cases above.
- **Missing `jq`**: without jq no part can function; the guard warns once per machine (not per session) and points at the fix, and the sensor's built-in status-line fallback prints a visible `usage sensor blind` notice instead of going blank.

The guard polls before it judges, in the same process, so an "offline" warning always means the poller really could not produce state - never that it simply had not run yet.

**Rate limits.** The usage endpoint has its own undocumented rate limit. The poller throttles on when it last *tried*, not when it last *succeeded*, and after any failed fetch it waits (`Retry-After` on a `429`, `CLAUDE_USAGE_BACKOFF_FAIL_SEC` otherwise) before trying again; no interval override can skip that wait. A `429` is machine-wide and ends on its own, so its warning comes **once per outage**, not in every new session, and it drops the "fix per the README" pointer because there is nothing to fix. The next good poll re-arms it for the next outage.

The poller records why its last fetch failed in `<state dir>/poller-last-error` (expired token, no `curl`, HTTP status, backoff deadline) and clears it on success; the guard quotes that line in its warning, so the message names the real cause instead of sending you to check wiring. Every failed fetch also adds one line (time, HTTP code, `Retry-After`) to `<state dir>/poller-failures.log`, capped at 100 lines. While any fault holds, WARN/PARK cannot fire - the warning says so explicitly. It re-arms if the source recovers and later goes dark again in the same session.

## Fix: sign in from a terminal

**The poller needs a terminal CLI login.** If the offline warning says `no OAuth token found`, this is the fix, and it is yours to run - open a terminal app (Terminal, iTerm, an IDE terminal) and run:

```
claude /login
```

Sign in at the prompt. It has to be a real terminal: the sign-in opens a browser and waits for you, so no session, hook, or agent can do it on your behalf. One sign-in is enough - the token then keeps refreshing on its own, and the guard works everywhere, including the desktop app.

**Why a terminal, when you are already signed in?** Two separate credential stores. The poller authenticates with the OAuth token from the keychain item `Claude Code-credentials` (or `~/.claude/.credentials.json`) - the store the **terminal CLI** maintains. It cannot use the token of the session it is running inside: Claude Code strips OAuth credentials from every hook subprocess by design, and [the hooks reference](https://code.claude.com/docs/en/hooks) states plainly that no API credentials are passed to hooks. The desktop app keeps its own session state elsewhere and never populates that keychain item, so being signed into the app does not help the poller.

So on a machine used **only** through the desktop app, with no terminal CLI login, the guard has no usage source at all: no statusLine renders, so the sensor cannot run, and the poller has nothing to authenticate with. It fails loud rather than pretending otherwise, and the offline warning gives you the command above instead of sending you to this README.

## Checking the guard's state

One command prints what the guard acts on, so nobody reads the state directory by hand:

```
bash ~/.claude/plugins/marketplaces/vdsmon-skills/plugins/cc-usage-guard/hooks/usage-status.sh
```

It shows the state file and its age, both windows with their resets in local time, the thresholds in effect, the poller's last attempt, error, backoff, and recent failed fetches, and every park or warn marker. `--clear-markers` removes the markers; that is always safe, the next crossing then fires in full instead of as a throttled repeat. A plan upgrade or a window reset needs nothing from you: the next poll, within a minute, replaces the numbers, and a past reset already makes the guard ignore that window.

## Notes

- The sensor's `rate_limits` is a snapshot of its session's **last API response**, not live data. It refuses to write a snapshot whose 5-hour reset is already past, defers to state younger than `CLAUDE_USAGE_SENSOR_DEFER_SEC` (the poller's live numbers win), and the guard ignores any window whose reset is past - so an idle session's old snapshot can neither overwrite live numbers nor trigger a false park.
- The poller costs one small authenticated GET per minute at most, only on turns where a hook fires, with a 3-second timeout so a slow network can never hang a tool call.
- macOS/BSD: the guard uses `date -r <epoch>` for reset-time math and `stat -f %m` for the repeat-throttle clock; the poller uses `stat -f %m` and the login keychain via `security`. On Linux that would need `date -d @<epoch>`, `stat -c %Y`, and a `.credentials.json` for the token.
- Requires `jq` and `awk` on PATH (missing jq fails loud, see above), plus `curl` for the poller.
- State lives at `~/.claude/.usage-guard/` (created on first run), not inside the plugin dir, because the statusLine sensor gets no `${CLAUDE_PLUGIN_ROOT}` and every part must use the same path. Stale session markers (>7 days) and orphaned tmp files are garbage-collected on prompt-submit.
- Tests: `bash plugins/cc-usage-guard/tests/test-usage-guard.sh` (or `mise run test:usage-guard`); add `--soak` for a concurrent write/read race check.
- The guard sees hooks, not processes. A background process the model started that calls the API on its own (an Agent SDK run, an agent fleet under `nohup`) keeps calling after the PARK, and at the limit every call fails. The PARK message therefore tells the model to stop such processes itself; the guard cannot.
