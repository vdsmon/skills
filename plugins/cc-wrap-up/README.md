# cc-wrap-up

Wraps up a long Claude Code session. The plugin ships three skills and a mod:

- `/better-compact` saves what compaction would lose, then compacts with a focus message and resumes with a follow-up.
- `/handoff` saves what only the conversation knows and leaves `HANDOFF.md`, a memory entry and a resume prompt for a fresh session.
- `/close` saves for good when no session will pick the work up, and stops a background session.
- The mod offers a wrap-up at a natural break, then does the last step for you: it compacts with `better-compact`'s message, or it hands the work off with `handoff`'s resume prompt. You do not copy or paste anything.

The mod is a hooks module that Claude Code runs inside each session. It reads the context size at no cost. It acts when you press a button, run `/wrap-up` or run `/better-compact` or `/handoff`, and once by itself: at 800k tokens, inside a turn that is still running.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-wrap-up@vdsmon-skills
```

## When it offers a wrap-up

The mod assumes a 1M context window.

- **From 500k tokens**, it watches for a natural break: a turn that made a git commit, or a turn that ended with a clean tree. At the first one, a band above the prompt offers **[Compact] [Hand off] [Later]**.
- **If no break comes within 100k**, the band shows anyway.
- **Later** hides the band until the context grows another 100k.
- **From 750k**, the band turns urgent and sends one notification: at 800k the mod wraps up by itself (below). With that off, it warns of auto-compaction, which runs at 967k with no audit.

It never shows during a running turn, in a subagent, or in a `claude -p` run.

## When it wraps up by itself

A long turn can run past every cue with nobody there: answers get worse as the context grows, and auto-compaction, when it comes, runs with no audit. So **from 800k tokens, inside a running turn**, the mod stops the turn before its next model request and runs `/better-compact --unattended`. The skill saves what would be lost, asks nothing, and hands over a message and a follow-up; the mod compacts when the skill's turn ends, and the follow-up resumes the stopped task.

- It happens once per crossing: after it ran, the context must drop under the line before it can run again. If no compaction follows (the skill hands nothing over, or the compaction is refused), the mod sends one prompt to carry on with the task, and auto-compaction stays the guard.
- It leaves subagents and `claude -p` runs alone.
- `/wrap-up off` stops it in the session; `autoTokens` 0 turns it off for good.
- A turn that ends past 800k still gets the band; the next turn is stopped at its first request.

## What the buttons do

**Compact** runs `/better-compact`; typing the command yourself works the same. The skill saves what would be lost and hands its message to the mod, which compacts as soon as the skill's turn ends, then sends the follow-up as your next prompt. A prompt you send before that calls it off.

When the skill held back a question, or advises against compacting, the band waits instead and offers:

- **Compact now**: compacts with the message, then sends the follow-up as your next prompt.
- **Edit**: puts `/compact <message>` in the prompt box for you to change. The follow-up is still sent after compaction.
- **Not now**: closes the band.

**Hand off** runs `/handoff`. The skill writes `HANDOFF.md`, a memory entry and a resume prompt. The band then offers:

- **Fresh session here**: runs `/clear`, then sends the resume prompt as the first message.
- **Copy prompt**: copies the resume prompt, for Codex or another host.
- **Done**: closes the band. `HANDOFF.md` and the memory entry are enough for another machine or a later day.

If you send a prompt of your own after the skill finishes, the mod drops the result, because it no longer matches the session. The one exception is the answer to a question the skill held back.

## Commands

| Command | What it does |
| --- | --- |
| `/wrap-up` | Opens the band now, at any size, even when the cue is off |
| `/wrap-up off` | Stops the cue and the automatic wrap-up in this session |
| `/wrap-up on` | Starts them again |
| `/wrap-up send <name>` | Sends the ready resume prompt to another running Claude session |

## Settings

Set them in `/config` under the plugin.

| Setting | Default | Meaning |
| --- | --- | --- |
| `startTokens` | 500000 | Where the mod starts watching for a natural break |
| `stepTokens` | 100000 | How far Later moves the line, and how long the mod waits for a break before it offers anyway |
| `urgentTokens` | 750000 | Where the offer turns urgent and notifies, ahead of the automatic wrap-up |
| `autoTokens` | 800000 | Where the mod stops a running turn and runs `better-compact` by itself; 0 turns it off |

## What it costs

Nothing until you press a button, run one of the skills, or a turn crosses `autoTokens`, where the mod runs `better-compact` once. Reading the context size makes no API call. Past the line, the mod runs `git status --porcelain` once per turn, and only until it finds a break. Compact and Hand off run the skills, which spend tokens the same as when you type them.

## Tests

`mise run test:wrap-up` validates the mod and runs `hooks/wrap-up.test.ts` through `claude plugin test`. It needs the `claude` CLI, so CI does not run it. The skills' scripts have offline suites in `tests/`, which `mise run test` and CI run.
