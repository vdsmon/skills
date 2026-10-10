# cc-timeline

A side pane that draws each Claude Code turn as a timeline: every tool call is a colored bar on the turn's time axis, so you can see where a turn spent its time.

It is a mod: a hooks module Claude Code runs inside each interactive session.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-timeline@vdsmon-skills
```

## How it works

The mod notes the time before and after each tool call, in the main loop and in every subagent. The pane draws the turn on screen:

```
◀ Turn 7 · 2m14s · 6 calls
“fix the flaky build test”

Read index.ts        ▏                             0.2s
Grep TODO             ▏                            0.4s
Bash Run the tests    █████████                    38s
Agent Scan the repo            ████████████        71s
└ Read a.ts                    ▏                   0.3s
└ Edit a.ts                       ▏                0.5s
                     0s                         2m14s
■ read  ■ edit  ■ shell  ■ agent  ■ mcp  ■ error
```

- Colors group the tools: read and search, edit, shell, agent, MCP. A failed or refused call is red.
- A subagent's calls sit under its Agent row. An Agent row runs to its last subagent call's end, since a background agent returns at once.
- A running call's bar grows once a second while the pane is open. Nothing ticks while it is closed or idle.
- **◀** (`p`) and **▶** (`n`) walk the last 20 turns; **Latest** (`l`) jumps back. A new turn shows itself.

## Limits

- A subagent is matched to its Agent call by the call's description. Two agents started at once with the same description may sit under the wrong row.
- Times are wall-clock time around each call, including the time a permission prompt waits for you.
- `/clear` starts the history over.

## Commands

| Command | What it does |
| --- | --- |
| `/timeline` | Opens the pane, or closes it when it is open |

## Tests

`mise run test:timeline` validates the mod and runs `hooks/timeline.test.ts` through `claude plugin test`, on a mocked clock. It needs the `claude` CLI, so CI does not run it.
