# cc-cache-keepalive

Keeps Claude Code's prompt cache warm across idle stretches on Max plans, without paying for pings you didn't need.

Three hooks:

- **`hooks/keepalive.sh`** (`SessionStart`): reads the opt-in flag file, computes a cron expression anchored to the session-start minute, and tells the model to register it with `CronCreate`. The cron's prompt is the literal sentinel `cc-cache-keepalive`; when it fires the model replies `🔄 cache-keepalive` and stops. That bare API turn is the whole point — it reads the cached prefix, and the read resets the 1-hour TTL.
- **`hooks/keepalive-sensor.sh`** (`Stop`): records when the last turn ended, under `${CLAUDE_CONFIG_DIR:-~/.claude}/.cc-cache-keepalive/`. Two stamps per session: `last-real-turn-<session_id>` for turns you typed, and `last-turn-<session_id>` for any turn the API answered, pings included. A turn that ended in an API error (offline, rate-limited, logged out) writes neither — it never touched the cache.
- **`hooks/keepalive-guard.sh`** (`UserPromptSubmit`): when the incoming prompt is exactly the sentinel, cancels it if the real-turn stamp is recent (the cache is already warm) **or** if the newest stamp of either kind is older than the TTL (the cache is already gone — see [When the machine slept](#when-the-machine-slept)).

## Why cancelling matters

A ping isn't free. Sending it means sending the whole conversation, and even a cache hit bills every token of context at roughly a tenth of the input rate — about 25k token-equivalents on a 250k-token session. If you had a real turn two minutes ago, that turn already reset the TTL and the ping bought nothing.

The cron can't be rescheduled on activity: jobs live in memory in the CLI process, and the next fire time is a pure function of the cron expression plus a per-job jitter — there's no "last activity" input to reset and no file to rewrite. So the guard drops the tick instead. A `decision: block` on `UserPromptSubmit` makes the prompt pipeline return `shouldQuery: false`, so no API request is sent at all. The notice you see is a local `type: "system"` record that the API-request builder filters out, so a cancelled tick costs no tokens and no context.

Net effect: while you're working, ticks are cancelled. While you're away for less than the TTL, ticks keep the cache alive. Once you've been away longer than that, ticks are cancelled again — there is nothing left to keep alive.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-cache-keepalive@vdsmon-skills
touch ~/.cc-cache-keepalive
```

The flag file is the opt-in. Without it all three hooks short-circuit on their first line — one `stat(2)`, no output, no state, no side effects.

## Config

`~/.cc-cache-keepalive` doubles as the config file:

| Line | Meaning | Default |
| --- | --- | --- |
| 1 | Cron interval, `<digits><s\|m\|h\|d>` (e.g. `15m`, `1h`) | `30m` |
| 2 | Cancel window, same format, or bare minutes; `0` = never cancel | derived (below) |

Environment overrides, highest precedence first:

| Var | Default | Effect |
| --- | --- | --- |
| `CC_KEEPALIVE_WINDOW_MIN` | derived | cancel window in minutes; `0` disables cancelling |
| `CC_KEEPALIVE_TTL_MIN` | `60` | assumed prompt-cache TTL; also the default cold threshold |
| `CC_KEEPALIVE_SAFETY_MIN` | `10` | margin subtracted from the TTL when deriving the cancel window |
| `CC_KEEPALIVE_COLD_MIN` | `= TTL` | age of the newest turn beyond which a tick is held as cold; `0` disables the cold gate |
| `CC_KEEPALIVE_OFF` | unset | per-invocation kill switch; disables all three hooks |

Prefer line 2 of the flag file over the env vars for a permanent change: a cron waking a stopped session spawns a fresh process that never saw your shell exports.

## How the cancel window is chosen

```
window = min(interval, TTL - interval - safety)
```

The worst case for going cold is a real turn landing *just after* a tick — that turn is invisible to the tick that just passed, so the cache can go untouched for `window + interval`. The `min` is what bounds it: whichever branch wins, the gap comes out at exactly `TTL - safety`, 50 minutes at the defaults, against a measured 60-minute TTL.

| Interval | Window | Worst gap between cache touches |
| --- | --- | --- |
| `10m` | 10m | 20m |
| `20m` | 20m | 40m |
| `30m` (default) | 20m | 50m |
| `45m` | 5m | 50m |
| `50m` and above | 0 — never cancels | unchanged |

`safety` is 10 because the TTL is 60 and that number is measured (below), not folklore. What the margin actually covers is the two things the arithmetic can't see: a machine that slept, and a tick queued behind a long turn.

It deliberately does **not** cover cron jitter. Jitter is `hash(job_id) × fraction × period`, constant for the life of the job — it shifts every tick by the same amount and never widens the gap between consecutive ticks. An earlier version of this file blamed jitter for needing a wide margin, citing the 60-minute-interval failure in cc-tokenomics' `experiments.md` (#5b). That experiment fails for a simpler reason: a 60-minute spacing against a 60-minute TTL misses by construction, jitter or no jitter.

Widening further buys little. During active work every tick is already inside the window and cancelled, so a larger window only catches the first tick or two after you stop — a few per day. Against that, one cache miss makes the next real turn pay the write rate (1.25×) instead of the read rate (0.1×), so **a miss costs about twelve pings**. 10 minutes of headroom against a measured cliff is the point where that trade stops paying.

Everything fails open. A missing, unreadable, corrupt, or future-dated stamp lets the ping through; so does a session id the hook can't read. The only cost of failing open is a redundant ping.

## When the machine slept

The cron lives inside the CLI process, so closing the lid or losing the network does not stop it — it goes dormant and fires the moment the machine is back. By then the cache expired hours ago, and the tick that fires into it is the worst case this plugin can produce: a full uncached re-read of the entire conversation, to warm a session nobody is sitting at, after which every later tick keeps it warm for no one until the session is closed. On a 250k-token session that first tick alone costs about 300k token-equivalents at the write rate; the same session left open over a weekend used to pay it every morning.

So the guard has a second gate. It reads the newer of the two stamps — the last real turn, or the last ping the API actually answered — and if that is older than the TTL (60 minutes at the defaults) the tick is held:

```
UserPromptSubmit operation blocked by hook:
cc-cache-keepalive: cache cold, holding for a real turn
```

Held ticks stay held: they refresh nothing, so the stamps keep ageing and every later tick sees the same dead cache. Your next real turn pays the cold read once — you were going to pay that anyway to continue the conversation — the sensor stamps it, and the warm chain restarts. A tick that arrives *before* the cliff still fires: waking after 55 minutes is exactly the case a keepalive exists for, and the cold threshold is the TTL itself rather than `TTL - safety` so that a live cache is never abandoned on purpose.

The offline case is covered by the sensor side. A tick that fires with no network ends in a synthetic assistant record (`API Error: Unable to connect to API (ENOTFOUND)`); stamping it would call a dead cache warm, so turns that end in an API error write no stamp at all, and the age keeps counting from the last turn that really reached the API.

Two limits worth knowing. Sessions from before 1.6 have only the real-turn stamp until their next `Stop`; the cold gate uses that alone in the meantime, which is right for a sleeping machine and merely fails open for a session that was being kept warm purely by pings. And the state directory is swept of stamps older than 7 days, so a session left open and untouched for over a week fails open once, pays one cold read, and then holds again for another week — the price of keeping the sweep.

## Measured, not assumed

### Where the cache actually expires

The 1-hour TTL is widely repeated but was never checked here, and the whole safety margin hangs off it. Eight throwaway sessions were seeded, left in total silence for a controlled interval, then made to take exactly one turn via a one-shot cron. Idle time is measured from the last record of the seed turn to the probe reply:

| True idle | `cache_read` | `cache_creation` | |
| --- | --- | --- | --- |
| 6.0 min | 41,464 | 1,402 | hit |
| 44.1 min | 41,786 | 1,076 | hit |
| 51.0 min | 41,885 | 952 | hit |
| 56.0 min | 41,454 | 1,408 | hit |
| **57.9 min** | **42,585** | **15** | **hit** |
| **60.8 min** | **0** | **42,853** | **miss** |
| 64.8 min | 0 | 42,876 | miss |
| 70.8 min | 0 | 42,875 | miss |

So the cliff is between 57.9 and 60.8 minutes — 60 minutes, and it is a cliff rather than a slope: the misses read exactly zero from cache and rewrite the whole prefix.

Two traps if you repeat this. `claude -p --resume` **cannot** measure it: a resumed print-mode turn rewrites the conversation block every time (`cache_read` covers only the shared system prefix), so it reports a miss at two minutes and a "hit" that is really someone else's cache. Use a real `--bg` session driven by a cron, which is the path the plugin actually uses. And count *API records*, not turns, when checking the idle window was silent — one seed turn with two tool calls produces three assistant records, which looks like contamination and isn't.

### That a block really skips the request

Cancelling only helps if Claude Code really skips the request, and that is not documented anywhere — it is behaviour of the prompt pipeline. `tests/live-gate-e2e.sh` measures it: it runs a real background session with a 1-minute cron and flips one stamp file to arm the gate for exactly one tick. Observed on 2.1.220:

| Tick | Gate | Injected prompt recorded | Assistant turns | Tokens |
| --- | --- | --- | --- | --- |
| 1 | allow | yes | 1 | 35,902 |
| 2 | **block** | **no** | **0** | **0** |
| 3 | allow | yes | 1 | 35,919 |

The blocked tick still fired — the scheduler's `scheduled_task_fire` record is there — but nothing reached the API. The two allowed ticks either side are the controls: they rule out "the session was simply dead" as an explanation for the silence.

### The cron has to actually get created

A second thing that fails silently: the `SessionStart` hook only *asks* the model to register the cron. If the model doesn't act on that instruction, no cron exists, nothing errors, and the plugin does nothing whatsoever for the whole session.

The wording is therefore measured, not guessed. `tests/live-directive-compliance.sh` scores it:

| Directive | Print mode | Real `--bg` session |
| --- | --- | --- |
| "Immediately, silently, call the CronList tool…" (through 1.4.0) | 0/8 | 0/2 |
| "REQUIRED SETUP — do this before anything else…" (1.4.1) | 8/8 | 3/3 |

A model handed an ordinary first prompt just answers it; the instruction has to be ordered explicitly ahead of the user's request to survive. Adding a "why it matters" paragraph on top made it *worse* (2/3) — the imperative gets diluted. If you reword that block, re-measure it.

### Notes for re-running after a CLI upgrade

Two details worth knowing. A cancelled tick leaves no user record in the transcript at all, because the block branch discards the pending message rather than appending to it — so assert on the *absence* of an assistant reply, not on finding a user record. And the reply does not chain directly to the injected prompt: attachment records sit between them, so follow `parentUuid` several hops rather than expecting a direct link.

## Notes

- **A cancelled tick prints a local notice** and there is no way to switch it off:

  ```
  UserPromptSubmit operation blocked by hook:
  cc-cache-keepalive: already warm
  ```

  (or `cc-cache-keepalive: cache cold, holding for a real turn` for the cold gate). Claude Code prepends that first line to every block and pushes the message unconditionally — `suppressOutput` only hides a hook's stdout, not this. `suppressOutput: true` was tested and changes nothing. [anthropics/claude-code#39499](https://github.com/anthropics/claude-code/issues/39499) asked for a quiet block and was closed by the inactivity bot with no maintainer reply; [#81818](https://github.com/anthropics/claude-code/issues/81818) re-raises it with a repro. Since only the second line is ours, it is kept to one short string; that is also why the tests assert the block/pass boundary rather than the wording. The notice never reaches the API, so it costs no tokens and no context — it is just visible, a few times an hour, in an attended session.
- **`Stop` only, never `SubagentStop`.** They are separate events and `Stop` carries no `agent_id`, so wiring `Stop` alone gives main-agent-only stamping for free. A subagent's or teammate's turn does not refresh the main session's cached prefix, so stamping on one would suppress a ping the main session actually needs.
- **The guard matches strictly, the sensor loosely.** A guard false positive would block a real user prompt, so it matches the whole prompt against the sentinel — and since the payload is JSON, a prompt that merely *mentions* the sentinel arrives with escaped quotes and cannot match. A sensor false positive only wastes one ping, so it matches loosely, which also covers pre-1.3.0 crons whose prompt carried a `[Silent …]` prefix.
- State is per session, keyed by `session_id`, under the profile dir so multiple accounts (`CLAUDE_CONFIG_DIR`) never share stamps. Stale stamps and orphaned temp files are swept during a tick, not on the every-prompt path.
- Tests: `mise run test:cache-keepalive` (offline, no session). `bash plugins/cc-cache-keepalive/tests/live-gate-e2e.sh --live` drives a real background session with a 1-minute cron to confirm the CLI still honours the block — worth re-running after a Claude Code upgrade, since a break there is silent and just costs money.
