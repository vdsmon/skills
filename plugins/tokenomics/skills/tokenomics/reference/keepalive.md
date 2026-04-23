# Cache Keepalive

Automation that keeps the prompt cache warm across idle periods. The tokenomics plugin does **not** ship the keepalive itself — it lives in the separate `cache-keepalive` plugin from the same marketplace.

## Contents
- Why 30 minutes is the only viable interval on Max
- How the plugin works
- Installing + opting in
- Silent-mode rule
- Cost per poll

## Why 30 minutes is the only viable interval on Max

Max plan cache TTL is 1 hour. Scheduler jitter can add several minutes to any given cron firing. 60-min intervals therefore consistently miss the TTL window — verified in test #5b (`experiments.md`): switching from 30-min to 60-min dropped cache hit from 99.98% to 0.00% on every ping, 10+ consecutive misses.

Cron's minute granularity is 1 minute. Intervals that divide 60 cleanly: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30. Anything between 30 and 60 can't be expressed without falling back to `*/N * * * *`, which lands every user on the fleet-peak minutes :00/:30 — which the plugin explicitly avoids by anchoring the cron to the session-start minute.

Net: 30 min is the sweet spot. Shorter works but wastes poll overhead.

## How the plugin works

Three files, no skill:

- `hooks/keepalive.sh` — runs at SessionStart. Reads the flag file, computes an anchored cron expression, emits a `<cache-keepalive>` directive telling the model to call `CronCreate` with that cron + a silent-prefix prompt.
- `scripts/keepalive-noop.sh` — literal `exit 0`. The cron fires this every interval.
- `.claude-plugin/plugin.json` — registers the SessionStart hook.

Why a no-op script warms the cache: each cron firing is a fresh Bash tool call, which is an API turn against the cached prefix. The turn reads the cache; that read resets the 1-hour TTL. The script's output is irrelevant.

## Installing + opting in

```
/plugin marketplace add /Users/victordsm/repos/personal/claude-skills
/plugin install cache-keepalive@vdsmon-skills
touch ~/.cache-keepalive
```

Flag file opt-in is required — the hook short-circuits if `~/.cache-keepalive` is absent, so every user's default state is zero side effects.

To override the interval, put a single line like `15m` or `1h` at the top of the flag file. Format: `<digits><s|m|h|d>`. Invalid values fall back to 30m.

## Silent-mode rule

Every cron firing carries a user-prompt prefix: `[Silent cache-keepalive — run Bash tool only. No text output, no acknowledgment, no summary.]`. That directive alone is sufficient — the model reads it and runs Bash without narrating. The tokenomics skill does not need any silent-mode rule of its own.

## Cost per poll

Verified in test #6b (`experiments.md`): each poll = ~26k input tokens, ~200 uncached. Over 120+ consecutive pollings, plan 5h usage moved from 9% to 14% across 2 hours, most of that from unrelated work. At the recommended 30-min interval, a 60-hour session barely moves the needle.
