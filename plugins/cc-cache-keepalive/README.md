# cc-cache-keepalive

Keeps Claude Code's prompt cache warm across idle stretches on Max plans, without paying for pings you didn't need.

Three hooks:

- **`hooks/keepalive.sh`** (`SessionStart`): reads the opt-in flag file, computes a cron expression anchored to the session-start minute, and tells the model to register it with `CronCreate`. The cron's prompt is the literal sentinel `cc-cache-keepalive`; when it fires the model replies `🔄 cache-keepalive` and stops. That bare API turn is the whole point — it reads the cached prefix, and the read resets the 1-hour TTL.
- **`hooks/keepalive-sensor.sh`** (`Stop`): records when the last *real* turn ended, at `${CLAUDE_CONFIG_DIR:-~/.claude}/.cc-cache-keepalive/last-real-turn-<session_id>`. Turns that were themselves keepalive pings don't count.
- **`hooks/keepalive-guard.sh`** (`UserPromptSubmit`): when the incoming prompt is exactly the sentinel, cancels it if that stamp is recent.

## Why cancelling matters

A ping isn't free. Sending it means sending the whole conversation, and even a cache hit bills every token of context at roughly a tenth of the input rate — about 25k token-equivalents on a 250k-token session. If you had a real turn two minutes ago, that turn already reset the TTL and the ping bought nothing.

The cron can't be rescheduled on activity: jobs live in memory in the CLI process, and the next fire time is a pure function of the cron expression plus a per-job jitter — there's no "last activity" input to reset and no file to rewrite. So the guard drops the tick instead. A `decision: block` on `UserPromptSubmit` makes the prompt pipeline return `shouldQuery: false`, so no API request is sent at all. The notice you see is a local `type: "system"` record that the API-request builder filters out, so a cancelled tick costs no tokens and no context.

Net effect: while you're working, ticks are cancelled. While you're away, nothing changes.

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
| `CC_KEEPALIVE_TTL_MIN` | `60` | assumed prompt-cache TTL |
| `CC_KEEPALIVE_SAFETY_MIN` | `15` | margin subtracted from the TTL to absorb cron jitter |
| `CC_KEEPALIVE_OFF` | unset | per-invocation kill switch; disables all three hooks |

Prefer line 2 of the flag file over the env vars for a permanent change: a cron waking a stopped session spawns a fresh process that never saw your shell exports.

## How the cancel window is chosen

```
window = min(interval, TTL - interval - safety)
```

The worst case for going cold is a real turn landing *just after* a tick — that turn is invisible to the tick that just passed, so the cache can go untouched for `window + interval`. The `min` is what bounds it: whichever branch wins, the gap comes out at exactly `TTL - safety`, 45 minutes at the defaults, against a 60-minute TTL.

| Interval | Window | Worst gap between cache touches |
| --- | --- | --- |
| `10m` | 10m | 20m |
| `20m` | 20m | 40m |
| `30m` (default) | 15m | 45m |
| `45m` and above | 0 — never cancels | unchanged |

`safety` is 15 rather than something tighter because jitter is this plugin's documented failure mode: 60-minute intervals dropped the cache hit rate from 99.98% to 0.00% across 10+ consecutive pings (test #5b in cc-tokenomics' `experiments.md`). A cold cache costs a full uncached re-read — roughly ten times the ping it would have saved — so the margin is worth more than the extra cancellations.

Everything fails open. A missing, unreadable, corrupt, or future-dated stamp lets the ping through; so does a session id the hook can't read. The only cost of failing open is a redundant ping.

## Measured, not assumed

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

  Claude Code prepends that first line to every block and pushes the message unconditionally — `suppressOutput` only hides a hook's stdout, not this. The upstream request for a quiet block is [anthropics/claude-code#39499](https://github.com/anthropics/claude-code/issues/39499). Since only the second line is ours, it is kept to one short string; that is also why the tests assert the block/pass boundary rather than the wording. The notice never reaches the API, so it costs no tokens and no context — it is just visible, a few times an hour, in an attended session.
- **`Stop` only, never `SubagentStop`.** They are separate events and `Stop` carries no `agent_id`, so wiring `Stop` alone gives main-agent-only stamping for free. A subagent's or teammate's turn does not refresh the main session's cached prefix, so stamping on one would suppress a ping the main session actually needs.
- **The guard matches strictly, the sensor loosely.** A guard false positive would block a real user prompt, so it matches the whole prompt against the sentinel — and since the payload is JSON, a prompt that merely *mentions* the sentinel arrives with escaped quotes and cannot match. A sensor false positive only wastes one ping, so it matches loosely, which also covers pre-1.3.0 crons whose prompt carried a `[Silent …]` prefix.
- State is per session, keyed by `session_id`, under the profile dir so multiple accounts (`CLAUDE_CONFIG_DIR`) never share stamps. Stale stamps and orphaned temp files are swept during a tick, not on the every-prompt path.
- Tests: `mise run test:cache-keepalive` (offline, no session). `bash plugins/cc-cache-keepalive/tests/live-gate-e2e.sh --live` drives a real background session with a 1-minute cron to confirm the CLI still honours the block — worth re-running after a Claude Code upgrade, since a break there is silent and just costs money.
