# cc-autotitle

Names each Claude Code session on its own, so you stop typing `/rename`. The name is the kind you search for in `/resume` weeks later: short, kebab-case, English, with the handles you remember (ticket keys, PR numbers, batch ids), picked from the whole session instead of the last few messages.

It is a mod: a hooks module that Claude Code runs inside each session. Once installed it is on in every interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-autotitle@vdsmon-skills
```

It replaces `cc-session-name`, which is gone. Uninstall that one if you still have it.

## How it works

- After turn 3, the mod asks the session's own model, with `$.model.fork`, for a name. The fork reads the whole cached conversation and adds nothing to it.
- The name lands with your next prompt, as that prompt's session title. It is the same record `/rename` writes, and it adds nothing to the model's context.
- Every 10 turns, and after a compaction, it checks again. The model keeps the current name if it still fits the main work and gives a new one if the work moved.
- A reply that is not a bare kebab-case name of at most 40 characters is dropped, and the next turn tries again. After 3 failed tries in a row it waits for the next scheduled check. When unsure, it keeps the current name: a wrong name costs more than an old one.

When it leaves the name alone:

- **You named the session.** A `/rename`, a rename from another surface, or a name the session already had is yours: the mod stops naming that session. `/autotitle on` lets it follow the work again from that name.
- **Not interactive.** `claude -p` and SDK runs are never named.
- **Subagents.** Their turns do not count.

A resumed session keeps its state: the mod saves the last name it set and whether the session is pinned, per session, and forgets entries older than 60 days.

## What it costs

One fork per check: the cached conversation plus the prompt, and about 10 output tokens. On a Max plan cache reads do not count toward quota, so a check is close to free. A 30-turn session has about 3 checks.

## Command

| Command | What it does |
| --- | --- |
| `/autotitle` | Names the session now, and pins that name |
| `/autotitle <hint>` | Same, steered by the hint ("focus on the PR part") |
| `/autotitle off` / `on` | Pauses or resumes automatic names in this session; `on` also unpins |
| `/autotitle status` | The state, the last name set, the next check, and this session's counts |

## Settings

Set them in `/config` under the plugin.

| Setting | Default | Meaning |
| --- | --- | --- |
| `firstAfterTurns` | 3 | The turn after which the session gets its first name |
| `recheckEveryTurns` | 10 | Turns between checks; 0 names a session once |

## Tests

`mise run test:autotitle` validates the mod and runs `hooks/autotitle.test.ts` through `claude plugin test`, with a mocked clock, fork and store. It needs the `claude` CLI, so CI does not run it. `evals/autotitle/run.sh <out-dir>` measures the naming prompt itself and spends tokens.
