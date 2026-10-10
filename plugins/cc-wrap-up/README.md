# cc-wrap-up

Offers to wrap up a long Claude Code session at a natural break, then does the last step for you: it compacts with `prep-compact`'s message, or it hands the work off with `prep-exit`'s resume prompt. You do not copy or paste anything.

It is a mod: a hooks module that Claude Code runs inside each session. It reads the context size after each turn at no cost, and it acts only when you press a button or run `/wrap-up`.

## Install

```
/plugin marketplace add vdsmon/skills
/plugin install cc-wrap-up@vdsmon-skills
/plugin install prep-compact@vdsmon-skills
/plugin install prep-exit@vdsmon-skills
```

The two skills are optional. Without `prep-compact`, Compact compacts at once with no message. Without `prep-exit`, there is no Hand off button.

## When it offers a wrap-up

The mod assumes a 1M context window.

- **From 500k tokens**, it watches for a natural break: a turn that made a git commit, or a turn that ended with a clean tree. At the first one, a band above the prompt offers **[Compact] [Hand off] [Later]**.
- **If no break comes within 100k**, the band shows anyway.
- **Later** hides the band until the context grows another 100k.
- **From 920k**, the band turns urgent and sends one notification. Auto-compaction runs at 967k, and it runs with no audit.

It never shows during a running turn, in a subagent, or in a `claude -p` run.

## What the buttons do

**Compact** runs `/prep-compact`. The skill saves what would be lost and hands its message to the mod. The band then offers:

- **Compact now**: compacts with the message, then sends the follow-up as your next prompt.
- **Edit**: puts `/compact <message>` in the prompt box for you to change. The follow-up is still sent after compaction.
- **Not now**: closes the band.

**Hand off** runs `/prep-exit`. The skill writes `HANDOFF.md`, a memory entry and a resume prompt. The band then offers:

- **Fresh session here**: runs `/clear`, then sends the resume prompt as the first message.
- **Copy prompt**: copies the resume prompt, for Codex or another host.
- **Done**: closes the band. `HANDOFF.md` and the memory entry are enough for another machine or a later day.

If you send a prompt of your own after the skill finishes, the mod drops the result, because it no longer matches the session. The one exception is the answer to a question the skill held back.

## Commands

| Command | What it does |
| --- | --- |
| `/wrap-up` | Opens the band now, at any size, even when the cue is off |
| `/wrap-up off` | Stops the cue in this session |
| `/wrap-up on` | Starts it again |
| `/wrap-up send <name>` | Sends the ready resume prompt to another running Claude session |

## Settings

Set them in `/config` under the plugin.

| Setting | Default | Meaning |
| --- | --- | --- |
| `startTokens` | 500000 | Where the mod starts watching for a natural break |
| `stepTokens` | 100000 | How far Later moves the line, and how long the mod waits for a break before it offers anyway |
| `urgentTokens` | 920000 | Where the offer turns urgent and notifies |

## What it costs

Nothing until you press. Reading the context size makes no API call. Past the line, the mod runs `git status --porcelain` once per turn, and only until it finds a break. Compact and Hand off run the skills, which spend tokens the same as when you type them.

## Tests

`mise run test:wrap-up` validates the mod and runs `hooks/wrap-up.test.ts` through `claude plugin test`. It needs the `claude` CLI, so CI does not run it.
