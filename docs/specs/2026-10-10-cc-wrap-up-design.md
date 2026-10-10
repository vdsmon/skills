# cc-wrap-up: design

Status: approved in conversation on 2026-10-10. This spec is waiting for review.

## Goal

Make the end of a long session take fewer steps. When the context is getting full, or when the user wants to stop, the mod offers the two ways to wrap up, runs the matching skill, and then finishes the job. The user does not copy or paste anything.

- **Compact:** `/prep-compact` saves state and writes a compact message and a follow-up. The mod compacts with that message, then sends the follow-up.
- **Hand off:** `/prep-exit` saves state and writes `HANDOFF.md`, a memory entry and a resume prompt. The mod delivers the resume prompt to the place the work goes next.

Today the user does this by hand: watch the token count, run the skill, copy the `/compact` block, send it, and paste the follow-up while compaction runs. For a handoff, the user copies the resume prompt and pastes it into a fresh session, another Claude session, Codex, or another machine.

### Why the numbers

An earlier analysis of the user's transcripts found 28 compactions (25 manual, 3 auto) in 13 sessions. The median size before a compaction was about 780k tokens, but the range was 146k to 968k. So 780k describes a habit. It is not the right moment. The right moment is a seam in the work, so a token line only starts the search for a seam. The user chose a start line of 500k and a step of 100k.

### Success criteria

- At a seam past the line, a band offers [Compact] [Hand off] [Later], and two presses take the session from "context is full" to "compacted, follow-up running" or "handed off".
- `/prep-compact` and `/prep-exit` work exactly as before on Codex and without the mod.
- The mod never compacts, clears or sends a message without a press or a command from the user. Watching the context costs no tokens.

## Shape

- A new plugin, `cc-wrap-up`: a mod with no skill. It has `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts` (the `$.state` contract), `hooks/wrap-up.test.ts`, and one `README.md` (allowed for a plugin with no SKILL.md). It starts at version 1.0.0, as cc-keepwarm did.
- One small change to each of `prep-compact` and `prep-exit`: call the mod's tool when it is listed (see "Skill changes"). Each gets a minor bump.
- The two skills stay separate. Their outputs differ for a real reason: a compaction keeps a summary, so its message can be short pointers; a handoff keeps nothing, so every finding goes to a file or memory. Merging them is out of scope.

## Ways in

1. **The cue.** After each turn, the mod checks the context size and decides whether to show the band (see "When the cue shows").
2. **`/wrap-up`.** Opens the band at any context size. A handoff at the end of a day has nothing to do with a full context.
3. **Running a skill directly.** If the user types `/prep-compact` or `/prep-exit` without the band, the skill still calls the mod's tool, and the band opens in its "ready" state.

## When the cue shows

The mod works from main-thread turns only: a `turn.complete` with no `agentId` and with `reason: 'answer'`. It never draws or acts during a running turn, in a `claude -p` or SDK run, or in a subagent.

**Inputs, read after each answered turn:**

- `tokens`: `(await $.session.usage()).context.tokens`. The plain call costs nothing.
- `threshold`: the auto-compact threshold, from `$.session.usage({ breakdown: 'summary' })`, field `breakdown.autoCompactThreshold`. When auto-compaction is off, use `context.window`. The start line depends on it, so read it at the first answered turn and cache it for each model. Read it again after a compaction or a model switch. The `summary` breakdown estimates locally and makes no API call.

**Lines** (each one is a setting, see "Settings"):

- `start = min(startTokens, threshold / 2)`. With the defaults on a 1M window this is 500k. On a 200k-window model it becomes half the threshold, so the cue still fires.
- `urgent = threshold - urgentMarginTokens`.
- `line` begins at `start`. **Later** sets it to the current token count plus `stepTokens`: Later at 530k moves the line to 630k.

**A seam** is an answered turn that ended with either of these:

- a commit made during the turn: a `tool.call` on `Bash` whose command runs `git commit` and whose result is not an error; or
- a clean tree: `git status --porcelain` through `$.process.run` gives no output. Run this only when `tokens >= line`, and at most once per turn.

Outside a git repository there are no seams, so the step fallback below decides.

**Rules, checked in order after each answered turn:**

1. The mod is off for this session, or the phase is `prepping`, `ready-compact` or `ready-handoff`: do nothing.
2. `tokens >= urgent` and the phase is not `urgent`: set the phase to `urgent`. Send `$.ui.notify` only on the first urgent turn after each crossing. A compaction that brings the tokens below `urgent` resets this.
3. The phase is `cue` or `urgent`: keep it.
4. `tokens >= line + stepTokens`: set the phase to `cue`. No seam came inside the step.
5. `tokens >= line` and this turn is a seam: set the phase to `cue`.
6. `tokens >= line`: set the phase to `armed` (watching for a seam). Nothing is drawn.

## The band

The band is an `AbovePrompt` `ui.render` hook, built with `Box`, `Text` and `Button` from `$.ui.resolve(e)`, so it draws on terminal, desktop and mobile. When `e.props.hasSurvey` is set, or the phase has nothing to draw, it calls `next(e)`.

| Phase | Shows | Buttons |
| --- | --- | --- |
| `cue` | `612k of 967k · good moment to wrap up` | [Compact] [Hand off] [Later] |
| `urgent` | `948k of 967k · auto-compact is close, and it runs with no audit` | [Compact] [Hand off] [Later] |
| `prepping` | `Preparing to compact…` or `Preparing the handoff…` | none |
| `ready-compact` | The first line of the compact message, plus `1 question still open` when the skill held something back | [Compact now] [Edit] [Not now] |
| `ready-handoff` | `Handoff at <path>`, plus the open-question note | [Fresh session here] [Copy prompt] [Done] |

**Button actions:**

- **Compact:** `$.command.run({ command: 'prep-compact' })`, then the phase becomes `prepping`. When prep-compact is not installed (not in `$.command.list()`), the button changes to plain **Compact now**, which compacts without a message.
- **Hand off:** `$.command.run({ command: 'prep-exit' })`, then the phase becomes `prepping`. When prep-exit is not installed, the button is not shown.
- **Later:** move `line` as described above, and set the phase to `idle`. In the urgent state, Later hides the band until the next answered turn.
- **Compact now:** `$.session.compact({ instructions: message })`. When it resolves without `skip`, send the follow-up with `$.prompt.submit({ text: followUp, asUser: true })` and reset to `idle`, then read the threshold again. On `skip`, show its reason with `$.ui.toast` and keep the `ready-compact` phase.
- **Edit:** `$.prompt.fill({ text: '/compact ' + message })` keeps the follow-up pending. The mod's `session.compact` hook (see below) sends it after the user's own `/compact`.
- **Not now** and **Done:** set the phase to `idle`. Done means the handoff already sits in `HANDOFF.md` and memory, for another machine or a later day.
- **Fresh session here:** keep the resume prompt in a module variable, run `$.command.run({ command: 'clear' })`, then call `$.prompt.submit({ text: resumePrompt, asUser: true })`. A `/clear` keeps the process and the module, starts a new session id, and fires no `session.start`. So the module variable carries the prompt across, and the new session's `$.state` starts empty.
- **Copy prompt:** `$.ui.copy({ text: resumePrompt, surface: e.surface })`. When it gives `isCopied: false`, toast the reason and keep the band, because the prompt is also printed in the transcript.

**A stale payload:** a `ready-*` payload describes the session at the moment the skill ran. On the next `prompt.submit` from the composer (the user's own words, not the mod's follow-up), drop the payload and set the phase to `idle`. A slash command such as the user's `/compact` after Edit does not count as a new prompt.

## The tool: how a skill hands its result to the mod

In `session.start`, the mod registers one tool with `$.tool.register`. The model sees it as `mcp__cc-wrap-up__ready`. It is deferred (`isDeferred: true`), so it costs nothing in the prompt until it is used. The mod answers it in a `tool.call` hook with the matcher `{ tool: 'mcp__cc-wrap-up__ready' }`.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "kind": { "enum": ["compact", "handoff"] },
    "message": { "type": "string", "description": "compact: the focus message, without the /compact prefix" },
    "followUp": { "type": "string", "description": "compact: the next action, sent as a prompt after compaction" },
    "resumePrompt": { "type": "string", "description": "handoff: the first message for the next session" },
    "handoffPath": { "type": "string", "description": "handoff: absolute path of HANDOFF.md" },
    "openQuestion": { "type": "boolean", "description": "true when a question was held back for the user" }
  },
  "required": ["kind"]
}
```

The hook checks the fields for the given `kind`. On success, it stores the payload, sets the phase to `ready-compact` or `ready-handoff`, and returns a one-line result: "The wrap-up band now offers this to the user. Print your usual blocks too." With a missing field, it returns an error that names the field.

If a `prepping` turn ends without a tool call (an old skill version, or the model skipped the call), the mod sets the phase to `idle` and shows the toast `prep finished without handing its result to wrap-up; use the printed blocks`.

## The session.compact hook

The hook uses the matcher `{ trigger: 'manual' }` and runs only for the main loop (no `agentId`):

- A `ready-compact` payload is pending, and `e.instructions` is empty: call `next({ ...e, instructions: message })`.
- A follow-up is pending: after `next(e)` resolves without `skip`, send it with `$.prompt.submit({ text: followUp, asUser: true })`, then reset to `idle`.

For any other trigger, the hook only passes the event on with `next(e)`.

## Commands

The mod registers `/wrap-up` in `session.start`. It has these forms:

- `/wrap-up`: open the band in the `cue` phase at the current size, even when the mod is off.
- `/wrap-up off` and `/wrap-up on`: stop or resume the cue in this session. The repo's rules for hooks require an off switch.
- `/wrap-up send <name>`: send the pending resume prompt to another running Claude session with `$.session.send({ to: name, text })`. A mod cannot list other sessions, so the user types the name. With no pending handoff, it says so.

## Settings

The settings are `userConfig` values in `plugin.json`, read in `register` the way cc-keepwarm reads them:

| Setting | Default | Meaning |
| --- | --- | --- |
| `startTokens` | 500000 | The context size where the mod starts watching for a seam. It is capped at half the auto-compact threshold. |
| `stepTokens` | 100000 | How far Later moves the line, and how long the mod waits for a seam before it shows the cue anyway. |
| `urgentMarginTokens` | 50000 | How far below the auto-compact threshold the cue becomes urgent. |

## State

These are `$.state` atoms for each session, declared in `types/index.d.ts`:

- `phase`: `'idle' | 'armed' | 'cue' | 'urgent' | 'prepping' | 'ready-compact' | 'ready-handoff'`.
- `line`: number, in tokens.
- `payload`: the last tool input, or null.
- `prepKind`: `'compact' | 'handoff'` while prepping, or null.
- `isOff`: boolean.

Module variables hold only what the mod needs for one turn or across a `/clear`: the commit seen in this turn, the threshold cached for each model, and the resume prompt during Fresh session here.

## Failure direction

- **When unsure, the cue stays silent.** A band with wrong numbers is noise. When `$.session.usage()` gives no `tokens` (a new session, or just after a compaction) or a call fails, skip that turn. The next answered turn checks again.
- **Only the user acts.** The mod compacts, clears, submits or sends only after a button press or a `/wrap-up` command. A failed compaction or a failed copy keeps the payload and the band, so the user can try again or use the printed blocks.
- **Urgent fails toward showing.** If the cached threshold is missing, use `context.window` as the threshold. A wrong urgent cue costs a dismissal. A missed one lets auto-compaction run with no audit.

## Interactions

- **cc-keepwarm:** a compaction or a `/clear` ends the old cache prefix, and keepwarm already plans again from the next request. Compact now runs right after the prep turn, while the cache is still warm, so the summary request reads the long history from cache.
- **Precomputed compaction:** the user has `precomputeCompactionEnabled: true`. The engine may already hold a summary computed without instructions. See check 2.

## Checks before implementation

Each check is a short probe in a scratch session. Record the results as rows in `docs/experiments.md`.

1. Can `$.command.run({ command: 'clear' })` run `/clear` from a button press? Does `$.prompt.submit` then start the first turn of the new session? If not, Fresh session here fills the box with `/clear` and keeps the resume prompt for the next `prompt.submit` from the composer.
2. With precompute on, does `$.session.compact({ instructions })` use the instructions, or does it reuse a precomputed summary without them? If it reuses one, the mod must skip the `precompute` trigger while a `ready-compact` payload is pending, or document the limit.
3. Does `$.command.run({ command: 'prep-compact' })` resolve the plugin skill's name (it may need `prep-compact:prep-compact`)? Use `$.command.list()` to find the exact name.
4. Does a deferred plugin tool show in the deferred-tools list, so that the skill's rule can find it by name?

## Skill changes

Add one short rule at the end of each skill's output step. Both skills stay portable: the rule names a tool and needs no Claude Code feature, so `check.py` accepts it.

- **prep-compact** (step 3): "If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it with `kind: compact`, the focus message without the `/compact ` prefix, the follow-up, and `openQuestion`. Print both blocks as usual."
- **prep-exit** (step 4): "If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it with `kind: handoff`, the resume prompt, the absolute `HANDOFF.md` path, and `openQuestion`. Print the hand-over as usual."

## Testing

- `hooks/wrap-up.test.ts`, run with `claude plugin test`. Mock `$.session.usage`, `$.process.run`, `$.command.run`, `$.session.compact`, `$.prompt.submit` and `$.ui.copy`. The tests cover:
  - the cue rules: below the line; armed with no seam; seam by commit; seam by clean tree; the step fallback; urgent with one notify per crossing; Later moving the line; subagent and `-p` turns ignored;
  - the tool: a valid compact payload, a valid handoff payload, and a missing field;
  - each button's calls, including a `skip` from compaction and a failed copy;
  - the `session.compact` hook: it fills empty instructions and sends the follow-up only after a compaction that is not skipped;
  - a stale payload dropped on the user's next prompt;
  - `/wrap-up off`, `/wrap-up on` and `/wrap-up send`.
- A `mise` task `test:wrap-up`, like `test:keepwarm`: `claude plugin validate plugins/cc-wrap-up && claude plugin test plugins/cc-wrap-up`. CI does not have the `claude` CLI, so it does not run this task.
- A manual run in a real session past 500k, with a commit as the seam, through both the compact path and the fresh-session path.

## Shipping

The change ships as one pull request:

- `plugins/cc-wrap-up/` at 1.0.0, plus its marketplace entry.
- `prep-compact` and `prep-exit`, each with a minor bump.
- `mise run sync`, so the README table and the generated files are updated.
- The `test:wrap-up` task.
- `docs/experiments.md` rows for the four checks.

## Out of scope

- Merging prep-compact and prep-exit into one skill.
- Running an audit without a press.
- A list for picking a peer session; `/wrap-up send <name>` takes a name.
- Changing what auto-compaction does when it runs with no audit. The urgent cue is the only guard.
