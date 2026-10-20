# cc-keepwarm

Keeps Claude Code's prompt cache warm while you are away, so the first message after a long break reads the conversation from cache instead of writing it again.

It is a mod: a hooks module that Claude Code runs inside each session. Once installed it is on in every interactive session, with nothing to arm and no setup.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-keepwarm@vdsmon-skills
```

It replaces `cc-cache-keepalive`, which is gone. Uninstall that one if you still have it.

## How it works

- Every main-thread request touches the cached prefix. The mod notes when the last one started.
- 55 minutes later, if nothing else touched the cache, it sends one ping with `$.model.fork`: the session's last request again, plus a one-line prompt asking for the word `ok`. The API serves the whole prefix from cache, and that read restarts the cache's 1-hour lifetime.
- The ping never enters the conversation: no turn, no notice, no `Stop` hook, no sound. Each ping then plans the next one, so an idle session stays warm until it closes.

When it does not ping:

- **The cache is already gone.** A timer that fires 60 minutes or more after the last touch (the Mac slept) holds instead of paying a full rewrite to warm a session nobody is at. Your next real request restarts the chain.
- **The prefix changed.** After a compaction, a `/clear` or a model switch, the old prefix is dead. The next request plans again.
- **Pings keep missing.** Two pings in a row that found the cache gone and wrote it again stop the chain: the cache lives shorter than the ping interval.
- **Not interactive.** `claude -p` and SDK runs never plan a ping, so a pending timer cannot hold them open.

A ping that fails (API error, empty reply) retries every 2 minutes while a retry can still land inside the cache lifetime.

## What it costs

Measured on Opus 5.5 with a ~480k-token session (`docs/experiments.md` #20): each ping read the whole prefix from cache and wrote about 4 output tokens. On a Max plan cache reads do not count toward quota (experiment #1), so a ping is close to free there. At API prices a ping on a 480k prefix is about $0.10, against about $3.80 to write that prefix again after it expires.

## Command

| Command | What it does |
| --- | --- |
| `/keepwarm` | Shows the state (warm, next ping time, or why it stopped) and this session's pings, cached tokens read, output tokens, rewrites, cold holds and failures |
| `/keepwarm off` | Pauses it in this session |
| `/keepwarm on` | Resumes it |

## Settings

Set them in `/config` under the plugin.

| Setting | Default | Meaning |
| --- | --- | --- |
| `pingAfterMinutes` | 55 | Minutes after the last touch before the ping |
| `ttlMinutes` | 60 | Cache lifetime; past it the cache counts as gone |
| `maxIdleHours` | 0 | Stop after this many hours without a request of yours; 0 = never |

## Tests

`mise run test:keepwarm` validates the mod and runs `hooks/keepwarm.test.ts` through `claude plugin test`, with a mocked clock and fork. It needs the `claude` CLI, so CI does not run it.
