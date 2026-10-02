# cc-cache-keepalive

Keeps Claude Code's prompt cache warm across idle stretches on Max plans, without paying for pings you didn't need.

You arm it per session, only in sessions you expect to keep for a long time: type `/cc-cache-keepalive`. Nothing arms itself at session start.

- **`/cc-cache-keepalive`** (skill): runs `skills/cc-cache-keepalive/scripts/keepalive.sh`, which computes a cron expression anchored to the current minute, and tells the model to register it with `CronCreate` (once: it checks `CronList` first). The cron's prompt is the sentinel `cc-cache-keepalive`, followed by the arguments you gave (see [Config](#config)); when it fires the model replies `🔄 cache-keepalive` and stops. That bare API turn is the whole point: it reads the cached prefix, and the read resets the 1-hour TTL.

Two hooks keep the armed cron cheap:

- **`hooks/keepalive-sensor.sh`** (`Stop`): records when the last turn ended, under `~/.claude/.cc-cache-keepalive/`. Two stamps per session: `last-real-turn-<session_id>` for turns you typed, and `last-turn-<session_id>` for any turn the API answered, pings included. A turn that ended in an API error (offline, rate-limited, logged out) writes neither, because it never touched the cache.
- **`hooks/keepalive-guard.sh`** (`UserPromptSubmit`): when the incoming prompt is exactly a tick (the sentinel plus its optional arguments), cancels it if the real-turn stamp is recent (the cache is already warm) **or** if the newest stamp of either kind is older than the TTL (the cache is already gone - see [When the machine slept](#when-the-machine-slept)). Any other prompt passes untouched.

## After a resume

Cron jobs live in the CLI process, so `claude --resume` (or a restart after a usage-limit stop) comes back without the keepalive. Run `/cc-cache-keepalive` again if you still want it.

A model must never guess the cron expression from memory or from old transcripts: the anchor minute is what keeps the ticks off the fleet peaks. The skill always computes it fresh.

## Why cancelling matters

A ping isn't free. Sending it means sending the whole conversation, and even a cache hit bills every token of context at roughly a tenth of the input rate: about 25k token-equivalents on a 250k-token session. That price is in API dollars; on a Max plan, [experiment #1](https://github.com/vdsmon/skills/blob/main/docs/experiments.md) found that cache reads do not count toward quota. Either way, if you had a real turn two minutes ago, that turn already reset the TTL and the ping bought nothing.

The cron can't be rescheduled on activity: jobs live in memory in the CLI process, and the next fire time is a pure function of the cron expression plus a per-job jitter - there's no "last activity" input to reset and no file to rewrite. So the guard drops the tick instead. A `decision: block` on `UserPromptSubmit` makes the prompt pipeline return `shouldQuery: false`, so no API request is sent at all. The notice you see is a local `type: "system"` record that the API-request builder filters out, so a cancelled tick costs no tokens and no context.

Net effect: while you're working, ticks are cancelled. Once you stop, ticks keep the cache alive, and every answered ping counts as a touch, so an idle session stays warm until you close it. Only a machine that sleeps or goes offline for longer than the TTL lets the cold gate trip (see [When the machine slept](#when-the-machine-slept)). There is no idle cap yet: whether idle pings cost Max-plan quota must be re-measured first ([pending test #19](https://github.com/vdsmon/skills/blob/main/docs/experiments.md#pending-tests)).

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-cache-keepalive@vdsmon-skills
```

Installing turns the hooks on. They are cheap in a session with no keepalive: the guard passes every prompt that is not the sentinel, and the sensor writes two small stamp files per turn. `CC_KEEPALIVE_OFF=1` switches both off.

## Config

Pass settings as arguments when you arm it. They ride in the cron prompt, so the guard reads them from each tick and there is no config file.

```
/cc-cache-keepalive               # every 30m, derived cancel window
/cc-cache-keepalive 15m           # every 15m
/cc-cache-keepalive 30m 0         # every 30m, never cancel a warm tick
```

| Arg | Meaning | Default |
| --- | --- | --- |
| 1 | Cron interval, `<digits><s\|m\|h\|d>` (e.g. `15m`, `1h`) | `30m` |
| 2 | Cancel window, same format, or bare minutes; `0` = never cancel | derived (below) |

A bad argument arms nothing and says why. Running the command again with other arguments replaces the old cron.

Advanced environment overrides for the guard:

| Var | Default | Effect |
| --- | --- | --- |
| `CC_KEEPALIVE_TTL_MIN` | `60` | assumed prompt-cache TTL; also the default cold threshold |
| `CC_KEEPALIVE_SAFETY_MIN` | `10` | margin subtracted from the TTL when deriving the cancel window |
| `CC_KEEPALIVE_COLD_MIN` | `= TTL` | age of the newest turn beyond which a tick is held as cold; `0` disables the cold gate |
| `CC_KEEPALIVE_OFF` | unset | per-invocation kill switch; disables both hooks |

A cron that wakes a stopped session spawns a fresh process that never saw your shell exports, so set these in your Claude Code `env` settings, not only in the shell.

## How the cancel window is chosen

```
window = min(interval, TTL - interval - safety)
```

The worst case for going cold is a real turn landing *just after* a tick: that turn is invisible to the tick that just passed, so the cache can go untouched for `window + interval`. The `min` is what bounds it: whichever branch wins, the gap comes out at exactly `TTL - safety`, 50 minutes at the defaults, against a measured 60-minute TTL.

| Interval | Window | Worst gap between cache touches |
| --- | --- | --- |
| `10m` | 10m | 20m |
| `20m` | 20m | 40m |
| `30m` (default) | 20m | 50m |
| `45m` | 5m | 50m |
| `50m` and above | 0 - never cancels | unchanged |

`safety` is 10 because the TTL is 60 and that number is measured ([experiment #16](https://github.com/vdsmon/skills/blob/main/docs/experiments.md)), not folklore. What the margin actually covers is the two things the arithmetic can't see: a machine that slept, and a tick queued behind a long turn. It does not need to cover cron jitter, which shifts every tick of a job by the same amount.

Widening further buys little. During active work every tick is already inside the window and cancelled, so a larger window only catches the first tick or two after you stop - a few per day. Against that, one cache miss makes the next real turn pay the write rate (1.25x) instead of the read rate (0.1x), so at API prices **a miss costs about twelve pings**. 10 minutes of headroom against a measured cliff is the point where that trade stops paying.

Everything fails open. A missing, unreadable, corrupt, or future-dated stamp lets the ping through; so does a session id the hook can't read. The only cost of failing open is a redundant ping.

## When the machine slept

The cron lives inside the CLI process, so closing the lid or losing the network does not stop it: it goes dormant and fires the moment the machine is back. By then the cache expired hours ago, and the tick that fires into it is the worst case this plugin can produce: a full uncached re-read of the entire conversation, to warm a session nobody is sitting at, after which every later tick keeps it warm for no one until the session is closed. On a 250k-token session that first tick alone costs about 300k token-equivalents at the write rate; the same session left open over a weekend used to pay it every morning.

So the guard has a second gate. It reads the newer of the two stamps - the last real turn, or the last ping the API actually answered - and if that is older than the TTL (60 minutes at the defaults) the tick is held:

```
UserPromptSubmit operation blocked by hook:
cc-cache-keepalive: cache cold, holding for a real turn
```

Held ticks stay held: they refresh nothing, so the stamps keep ageing and every later tick sees the same dead cache. Your next real turn pays the cold read once (you were going to pay that anyway to continue the conversation), the sensor stamps it, and the warm chain restarts. A tick that arrives *before* the cliff still fires: waking after 55 minutes is exactly the case a keepalive exists for, and the cold threshold is the TTL itself rather than `TTL - safety` so that a live cache is never abandoned on purpose.

The offline case is covered by the sensor side. A tick that fires with no network ends in a synthetic assistant record (`API Error: Unable to connect to API (ENOTFOUND)`); stamping it would call a dead cache warm, so turns that end in an API error write no stamp at all, and the age keeps counting from the last turn that really reached the API.

The state directory is swept of stamps older than 7 days. So once a session has been held cold (or its machine asleep) for over a week, its next tick finds no stamps, fails open, and pays one cold read; the answered ping then restarts the warm chain.

## Measured, not assumed

The two facts this plugin rests on are measured, and the data lives in [docs/experiments.md](https://github.com/vdsmon/skills/blob/main/docs/experiments.md):

- **#16**: the cache TTL is a 60-minute cliff, not a slope. The window math and the cold gate hang off it.
- **#17**: a `decision: block` on a cron tick really skips the API request (0 tokens). `tests/live-gate-e2e.sh` measures it.

## Notes

- **A cancelled tick prints a local notice** and there is no way to switch it off:

  ```
  UserPromptSubmit operation blocked by hook:
  cc-cache-keepalive: already warm
  ```

  (or `cc-cache-keepalive: cache cold, holding for a real turn` for the cold gate). Claude Code prepends that first line to every block and pushes the message unconditionally - `suppressOutput` only hides a hook's stdout, not this. `suppressOutput: true` was tested and changes nothing. [anthropics/claude-code#39499](https://github.com/anthropics/claude-code/issues/39499) asked for a quiet block and was closed by the inactivity bot with no maintainer reply; [#81818](https://github.com/anthropics/claude-code/issues/81818) re-raises it with a repro. Since only the second line is ours, it is kept to one short string; that is also why the tests assert the block/pass boundary rather than the wording. The notice never reaches the API, so it costs no tokens and no context - it is just visible, a few times an hour, in an attended session.
- **Silencing turn-end sounds on pings.** The cron prompt always starts with `cc-cache-keepalive`, so your own `Stop` hooks (sounds, notifications) can match on it and skip ping turns.
- **`Stop` only, never `SubagentStop`.** They are separate events and `Stop` carries no `agent_id`, so wiring `Stop` alone gives main-agent-only stamping for free. A subagent's or teammate's turn does not refresh the main session's cached prefix, so stamping on one would suppress a ping the main session actually needs.
- **The guard matches strictly, the sensor loosely.** A guard false positive would block a real user prompt, so it matches the whole prompt against the sentinel - and since the payload is JSON, a prompt that merely *mentions* the sentinel arrives with escaped quotes and cannot match. A sensor false positive only wastes one ping, so it matches loosely, which also covers pre-1.3.0 crons whose prompt carried a `[Silent ...]` prefix.
- State is per session, keyed by `session_id`, under `~/.claude/.cc-cache-keepalive/`. Stale stamps and orphaned temp files are swept during a tick, not on the every-prompt path.
- Tests: `mise run test:cache-keepalive` (offline, no session). One live test spends tokens and is worth re-running after a Claude Code upgrade, since a break is silent and only shows up on the bill: `mise run test:keepalive-live` drives a real background session with a 1-minute cron to confirm the CLI still honours the block.
