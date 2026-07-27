# Cache Keepalive

Automation that keeps the prompt cache warm across idle periods. The tokenomics plugin does **not** ship the keepalive itself, it lives in the separate `cc-cache-keepalive` plugin from the same marketplace.

## Contents
- Why 30 minutes is the only viable interval on Max
- How the plugin works
- Installing + opting in
- Cancelling ticks a real turn already paid for
- Cost per poll

## Why 30 minutes is the only viable interval on Max

Max plan cache TTL is 1 hour. Scheduler jitter can add several minutes to any given cron firing. 60-min intervals therefore consistently miss the TTL window, verified in test #5b (`experiments.md`): switching from 30-min to 60-min dropped cache hit from 99.98% to 0.00% on every ping, 10+ consecutive misses.

Cron's minute granularity is 1 minute. Intervals that divide 60 cleanly: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30. Anything between 30 and 60 can't be expressed without falling back to `*/N * * * *`, which lands every user on the fleet-peak minutes :00/:30, which the plugin explicitly avoids by anchoring the cron to the session-start minute.

Net: 30 min is the sweet spot. Shorter works but wastes poll overhead.

## How the plugin works

Three hooks, no skill:

- `hooks/keepalive.sh`: runs at SessionStart. Reads the flag file, computes an anchored cron expression, emits a `<cc-cache-keepalive>` directive telling the model to call `CronCreate` with that cron and the bare sentinel prompt `cc-cache-keepalive`.
- `hooks/keepalive-sensor.sh`: runs at Stop. Records when the last real turn ended.
- `hooks/keepalive-guard.sh`: runs at UserPromptSubmit. Cancels a tick whose work was already done by a recent real turn.

Why the ping warms the cache: each cron firing injects a prompt, and answering it is an API turn against the cached prefix. The turn reads the cache; that read resets the 1-hour TTL. No tool call is needed — the reply is a bare `🔄 cache-keepalive`, and the turn itself is the whole mechanism.

## Installing + opting in

```
/plugin marketplace add /Users/victordsm/repos/personal/skills
/plugin install cc-cache-keepalive@vdsmon-skills
touch ~/.cc-cache-keepalive
```

Flag file opt-in is required because the hook short-circuits if `~/.cc-cache-keepalive` is absent, so every user's default state is zero side effects.

To override the interval, put a single line like `15m` or `1h` at the top of the flag file. Format: `<digits><s|m|h|d>`. Invalid values fall back to 30m. Line 2 overrides the cancel window below.

## Cancelling ticks a real turn already paid for

A ping is not free. Answering it means sending the whole conversation, and even a cache hit bills every token of context at roughly a tenth of the input rate — ~26k input tokens per poll at the measured sizes below. If a real turn happened minutes ago, that turn already reset the TTL and the ping bought nothing.

The cron cannot be rescheduled on activity: jobs are in-memory in the CLI process, and the next fire time is a pure function of the cron expression plus a per-job jitter — no activity input exists to reset. So the guard cancels the tick instead. A `decision: block` on `UserPromptSubmit` makes the prompt pipeline return `shouldQuery: false`, so no API request is sent at all; the notice it leaves is a local `type: "system"` record that the API-request builder filters out, costing no tokens and no context.

The cancel window is `min(interval, TTL - interval - safety)` — 15 min at the default 30-min interval, 0 (never cancel) above 45 min. The `min` bounds the worst case: a real turn landing just after a tick is invisible to it, so the cache can go untouched for `window + interval`, which comes out at exactly `TTL - safety` = 45 min either way. `safety` is 15 rather than tighter precisely because of the jitter measured in #5b above.

Net: pings you were awake for stop being billed; pings you were away for behave exactly as before.

## Cost per poll

Verified in test #6b (`experiments.md`): each poll = ~26k input tokens, ~200 uncached. Over 120+ consecutive pollings, plan 5h usage moved from 9% to 14% across 2 hours, most of that from unrelated work. At the recommended 30-min interval, a 60-hour session barely moves the needle.
