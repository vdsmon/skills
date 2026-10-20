# cc-pitstop

Pauses Claude Code before it hits the 5-hour or weekly usage limit, in every session on the machine, and resumes the paused work on its own when the window resets.

It is a mod: a hooks module Claude Code runs inside each session. It reads usage from Claude Code itself, so it needs no login token, no network call, no status line and no `jq`.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-pitstop@vdsmon-skills
```

It replaces `cc-usage-guard`, which is gone. Uninstall that one if you still have it.

## How it works

Claude Code reports both usage windows with each response. After every request, pitstop saves that reading where every session on the machine can read it, so all sessions judge from the newest numbers.

| Tier | 5-hour | Weekly | What happens |
| --- | --- | --- | --- |
| Warn | 90% | 96% | Once per window: a toast, and a note the model reads asking it to land the current work at a clean point. |
| Pause | 97% | 99% | Every session pauses. The model first gets a stop note and a few requests to save its state, then pitstop answers every request itself, with no API call. |

During a pause:

- **Grace.** The main thread may make 2 more requests after it reads the stop note, to commit or write where it is. All subagents share one pool of 3 requests, so a workflow that keeps spawning agents cannot keep spending.
- **Hard stop.** After the grace, each request gets the reply `pitstop: paused ... resets at 04:20` straight from pitstop. Nothing reaches the API.
- **Phone push.** Claude Code sends it only while you are away from the terminal.
- **Resume.** One minute after the window resets, a session whose work was cut off gets the prompt "Continue the work that was paused", and you get a push. A session that was idle just stops being paused.

A pause one session started holds in every other session too, until its window resets.

## Command

| Command | What it does |
| --- | --- |
| `/pitstop` | Shows whether a pause is in force, and both windows with their use, reset time and thresholds |
| `/pitstop go` | Keeps this session working through the current pause, until the window resets |
| `/pitstop off` | Switches pitstop off in this session |
| `/pitstop on` | Switches it back on |

## Settings

Set them in `/config` under the plugin.

| Setting | Default | Meaning |
| --- | --- | --- |
| `warn5h` | 90 | 5-hour % that sends the warn note |
| `park5h` | 97 | 5-hour % that pauses every session |
| `warnWeekly` | 96 | Weekly % that sends the warn note |
| `parkWeekly` | 99 | Weekly % that pauses every session |
| `graceRequests` | 2 | Requests the main thread may still make after the stop note |

## Notes

- Pitstop sees requests that go through Claude Code. A process the model started that calls the API on its own (an Agent SDK run, a `codex exec` loop) is not paused. The stop note tells the model to stop such jobs.
- Usage numbers come from the last response Claude Code got. A session that sent nothing for a while has old numbers, which is why pitstop shares the newest reading between sessions.
- If a pause was saved with lower thresholds, a newer reading of the same window under the current line drops it. Usage never goes down inside a window, so that pause is out of date.

## Tests

`mise run test:pitstop` validates the mod and runs `hooks/pitstop.test.ts` through `claude plugin test`, with a mocked clock and engine. It needs the `claude` CLI, so CI does not run it.
