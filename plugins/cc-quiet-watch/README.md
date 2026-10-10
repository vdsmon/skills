# cc-quiet-watch

Watches long jobs for Claude Code without waking the session for every check. A scheduled tick or a Monitor wakes the main model with its whole context just to learn "still running". This mod runs the check itself, asks Haiku only when the output changed, and wakes the session only when the job needs it.

It is a mod: a hooks module Claude Code runs inside each interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-quiet-watch@vdsmon-skills
```

## How it works

The model gets a `watch` tool, listed from the start. It arms a watch with:

- a **check**: an MCP read tool (`server`, `mcpTool`, `args`, for example `revelo-pipelines` `get_batch_run`), or a command as an argv array that prints the current status (for example `["gh", "pr", "checks", "57"]`)
- the **goal** in words: what done and what failed look like
- `everyMinutes` (default 10, at least 2), and optionally `stuckAfterMinutes` and `onWake` (what to do when woken)

Arming runs the check once at once, so a check that cannot run fails there, not quietly later. Then, at each interval:

1. The mod runs the check. Timestamps are ignored when comparing outputs.
2. Same output as last time: nothing else happens, and no model is called.
3. Changed output: one Haiku 5.5 call reads it against the goal and returns a status and a one-line summary.
4. The session gets a new prompt only when the job is done, failed, waiting for you, stuck, or cannot be checked any more. The prompt holds the summary line, the goal, `onWake` and the latest output.

Every failure ends with the main model back in charge:

| What fails | What happens |
| --- | --- |
| Arming | The tool returns the reason, and its description tells the model to fall back to CronCreate or Monitor |
| The check, 3 times in a row | The session is woken: "not checkable any more" |
| The Haiku judgment, 3 times in a row | The session is woken with the raw output to judge itself |
| Sending the wake prompt | The watch is kept and tried again at the next check |

Watches are saved per session, so they survive a hot reload and come back after a restart. A session holds at most 10.

## MCP checks need an allow rule

A mod's MCP call goes through Claude Code's permission check. In auto mode the classifier gives no verdict for a call that no request of yours asked for, so the call is refused unless `permissions.allow` names the tool, for example:

```json
"mcp__revelo-pipelines__get_batch_run"
```

Command checks need no rule.

## Commands

| Command | What it does |
| --- | --- |
| `/watches` | Lists this session's watches with their last line and next check |
| `/watches check <name>` | Runs one check now |
| `/watches stop <name>` | Stops a watch |

The model can also stop one with the `unwatch` tool.

## Tests

`mise run test:quiet-watch` validates the mod and runs `hooks/quietwatch.test.ts` through `claude plugin test`, with a mocked clock and engine. It needs the `claude` CLI, so CI does not run it.
