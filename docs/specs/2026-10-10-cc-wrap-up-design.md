# cc-wrap-up: design

Status: approved on 2026-10-10. Updated the same day with the probe results (`docs/experiments.md` #21 to #25) and the decision to assume a fixed 1M window.

## Goal

Make the end of a long session take fewer steps. When the context is getting full, or when the user wants to stop, the mod offers the two ways to wrap up, runs the matching skill, and then finishes the job. The user does not copy or paste anything.

- **Compact:** `/prep-compact` saves state and writes a compact message and a follow-up. The mod compacts with that message, then sends the follow-up.
- **Hand off:** `/prep-exit` saves state and writes `HANDOFF.md`, a memory entry and a resume prompt. The mod delivers the resume prompt to the place the work goes next.

Today the user does this by hand: watch the token count, run the skill, copy the `/compact` block, send it, and paste the follow-up while compaction runs. For a handoff, the user copies the resume prompt and pastes it into a fresh session, another Claude session, Codex, or another machine.

### Why the numbers

An earlier analysis of the user's transcripts found 28 compactions (25 manual, 3 auto) in 13 sessions. The median size before a compaction was about 780k tokens, but the range was 146k to 968k. So 780k describes a habit. It is not the right moment. The right moment is a seam in the work, so a token line only starts the search for a seam. The user chose a start line of 500k and a step of 100k.

The mod assumes a 1M window, the window the user works in. Auto-compaction runs at 967k there (experiment #24). Fixed numbers keep the mod simple: it reads no threshold and does not scale for other windows.

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

**Input:** `tokens`, read after each answered turn as `(await $.session.usage()).context.tokens`. The plain call costs nothing. It is null until a session's first response (experiment #24); then the turn is skipped.

**Lines** (each one is a setting, see "Settings"):

- `line` begins at `startTokens` (500k). **Later** sets it to the current token count plus `stepTokens` (100k): Later at 530k moves the line to 630k.
- `urgentTokens` (920k) is a fixed line about 50k below where auto-compaction runs.

**A seam** is an answered turn that ended with either of these:

- a commit made during the turn: a `tool.call` on `Bash` whose command runs `git commit` and whose result has no `isError` and no `deny`; or
- a clean tree: `git status --porcelain` through `$.process.run` gives no output with exit code 0. Run this only when `tokens >= line`, and at most once per turn.

Outside a git repository there are no seams, so the step fallback below decides.

**Rules, checked in order after each answered turn:**

1. The mod is off for this session, or the phase is `prepping`, `ready-compact` or `ready-handoff`: do nothing.
2. `tokens >= urgentTokens` and the phase is not `urgent`: set the phase to `urgent`. Send `$.ui.notify` only on the first urgent turn after each crossing. A compaction that brings the tokens below `urgentTokens` resets this.
3. The phase is `cue` or `urgent`: keep it.
4. `tokens >= line + stepTokens`: set the phase to `cue`. No seam came inside the step.
5. `tokens >= line` and this turn is a seam: set the phase to `cue`.
6. `tokens >= line`: set the phase to `armed` (watching for a seam). Nothing is drawn.

After a compaction or a `/clear`, the tokens drop below every line. The phase goes back to `idle` and `line` back to `startTokens`.

## The band

The band is an `AbovePrompt` `ui.render` hook, built with `Box`, `Text` and `Button` from `$.ui.resolve(e)`, so it draws on terminal, desktop and mobile. When `e.props.hasSurvey` is set, or the phase has nothing to draw, it calls `next(e)`.

| Phase | Shows | Buttons |
| --- | --- | --- |
| `cue` | `612k tokens · good moment to wrap up` | [Compact] [Hand off] [Later] |
| `urgent` | `948k tokens · auto-compact runs at 967k, with no audit` | [Compact] [Hand off] [Later] |
| `prepping` | `Preparing to compact…` or `Preparing the handoff…` | none |
| `ready-compact` | The first line of the compact message, plus `1 question still open` when the skill held something back | [Compact now] [Edit] [Not now] |
| `ready-handoff` | `Handoff at <path>`, plus the open-question note | [Fresh session here] [Copy prompt] [Done] |

**Skill commands.** A plugin skill's command is namespaced (`prep-compact:prep-compact`, experiment #24). The mod finds each one in `$.command.list()` as the entry named `prep-compact` (or `prep-exit`) or ending in `:prep-compact` (or `:prep-exit`).

**Button actions:**

- **Compact:** `$.command.run` with the prep-compact command, then the phase becomes `prepping`. When prep-compact is not installed, the button changes to plain **Compact now**, which compacts without a message.
- **Hand off:** `$.command.run` with the prep-exit command, then the phase becomes `prepping`. When prep-exit is not installed, the button is not shown.
- **Later:** move `line` as described above, and set the phase to `idle`. In the urgent state, Later hides the band until the next answered turn.
- **Compact now:** `$.session.compact({ instructions: message })` (experiment #22). The mod's own `session.compact` hook does not see this call, so the mod acts on the call's result. When it resolves without `skip`, send the follow-up with `$.prompt.submit({ text: followUp, asUser: true })` and reset. On `skip`, show its reason with `$.ui.toast` and keep the `ready-compact` phase.
- **Edit:** `$.prompt.fill({ text: '/compact ' + message })` keeps the follow-up pending. The mod's `session.compact` hook (see below) sends it after the user's own `/compact`.
- **Not now** and **Done:** set the phase to `idle`. Done means the handoff already sits in `HANDOFF.md` and memory, for another machine or a later day.
- **Fresh session here:** keep the resume prompt in a module variable, run `$.command.run({ command: 'clear' })`, then call `$.prompt.submit({ text: resumePrompt, asUser: true })`. Experiment #21 confirmed this: the module lives across `/clear`, no `session.start` fires, and the submit runs as the new session's first turn. The new session's `$.state` starts empty.
- **Copy prompt:** `$.ui.copy({ text: resumePrompt, surface: e.surface })`. When it gives `isCopied: false`, toast the reason and keep the band, because the prompt is also printed in the transcript.

**A stale payload:** a `ready-*` payload describes the session at the moment the skill ran. When the user sends a prompt of their own (a `prompt.submit` with origin `composer` or `bridge`), drop the payload and set the phase to `idle`. The mod's own submits never reach its own hook, and a slash command such as `/compact` arrives as `command.run`, not as a prompt (experiments #22 and #24), so neither one drops it.

## The tool: how a skill hands its result to the mod

In `session.start`, the mod registers one tool with `$.tool.register`. The model sees it as `mcp__cc-wrap-up__ready`. It is deferred (`isDeferred: true`), so it costs nothing in the prompt until it is used; a deferred plugin tool is listed by name, and the model loads and calls it (experiment #23). The mod answers it in a `tool.call` hook with the matcher `{ tool: 'mcp__cc-wrap-up__ready' }`. The input fields arrive as properties of `e` (`e.kind`, `e.message`, and so on).

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

The hook checks the fields for the given `kind`. On success, it stores the payload, sets the phase to `ready-compact` or `ready-handoff`, and returns `{ result }` with one line: "The wrap-up band now offers this to the user. Print your usual blocks too." With a missing field, it returns `{ deny }` with a text that names the field.

If a `prepping` turn ends without a tool call (an old skill version, or the model skipped the call), the mod sets the phase to `idle` and shows the toast `prep finished without handing its result to wrap-up; use the printed blocks`.

## The session.compact hook

The hook runs only for the main loop (no `agentId`). The mod's own `$.session.compact` never reaches it.

- **`manual`** (the user's own `/compact`): when a `ready-compact` payload is pending and `e.instructions` is empty, call `next({ ...e, instructions: message })`. When the result is not a `skip` and a follow-up is pending, send the follow-up with `$.prompt.submit({ text: followUp, asUser: true })`, then reset.
- **`precompute`**: while the phase is `prepping` or `ready-compact`, return `{ skip: 'cc-wrap-up: a prep result is pending' }`. This keeps a summary computed without the prep's instructions from standing in for the real one. The probe could not make a precompute fire, so this guard is a precaution (experiment #25).
- **Any other trigger:** pass it on with `next(e)`. After an `auto` compaction that is not skipped, reset the cue (see "When the cue shows").

## Commands

The mod registers `/wrap-up` in `session.start`. It has these forms:

- `/wrap-up`: open the band in the `cue` phase at the current size, even when the mod is off.
- `/wrap-up off` and `/wrap-up on`: stop or resume the cue in this session. The repo's rules for hooks require an off switch.
- `/wrap-up send <name>`: send the pending resume prompt to another running Claude session with `$.session.send({ to: name, text })`. A mod cannot list other sessions, so the user types the name. With no pending handoff, it says so.

## Settings

The settings are `userConfig` values in `plugin.json`, read in `register` the way cc-keepwarm reads them:

| Setting | Default | Meaning |
| --- | --- | --- |
| `startTokens` | 500000 | The context size where the mod starts watching for a seam. |
| `stepTokens` | 100000 | How far Later moves the line, and how long the mod waits for a seam before it shows the cue anyway. |
| `urgentTokens` | 920000 | The context size where the cue becomes urgent. Auto-compaction runs at 967k on a 1M window. |

## State

One `$.state` atom for each session, `wrap`, declared in `types/index.d.ts`. One atom keeps every change a single write. Its fields:

- `phase`: `'idle' | 'armed' | 'cue' | 'urgent' | 'prepping' | 'ready-compact' | 'ready-handoff'`.
- `line`: number in tokens, or null for the start line.
- `tokens`: the context size after the last answered main-thread turn, or null.
- `payload`: the last tool input, or null.
- `prepKind`: `'compact' | 'handoff'` while prepping, or null.
- `isOff`: boolean.
- `isNotified`: boolean, true after the urgent notify of the current crossing.

Module variables hold only what the mod needs for one turn: the commit seen in this turn. During Fresh session here, the press handler's closure holds the resume prompt across `/clear`.

## Failure direction

- **When unsure, the cue stays silent.** A band with wrong numbers is noise. When `$.session.usage()` gives no `tokens` or a call fails, skip that turn. The next answered turn checks again.
- **Only the user acts.** The mod compacts, clears, submits or sends only after a button press, a `/wrap-up` command, or the user's own `/compact`. A failed compaction or a failed copy keeps the payload and the band, so the user can try again or use the printed blocks.
- **Hooks fail open.** Every hook that can block (`tool.call`, `prompt.submit`, `session.compact`, `command.run`) gets a `.catch` that calls `next(e)` when `next` has not run yet. A bug in the mod must never block a tool call, a prompt or a compaction.

## Interactions

- **cc-keepwarm:** a compaction or a `/clear` ends the old cache prefix, and keepwarm already plans again from the next request. Compact now runs right after the prep turn, while the cache is still warm, so the summary request reads the long history from cache.
- **Precomputed compaction:** the user has `precomputeCompactionEnabled: true`. See the `precompute` guard above.

## Skill changes

Add one short rule at the end of each skill's output step. Both skills stay portable: the rule names a tool and needs no Claude Code feature, so `check.py` accepts it.

- **prep-compact** (step 3): "If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it with `kind: compact`, the focus message without the `/compact ` prefix, the follow-up, and `openQuestion`. Print both blocks as usual."
- **prep-exit** (step 4): "If a tool named `mcp__cc-wrap-up__ready` is listed (load it first if it is deferred), call it with `kind: handoff`, the resume prompt, the absolute `HANDOFF.md` path, and `openQuestion`. Print the hand-over as usual."

## Testing

- `hooks/wrap-up.test.ts`, run with `claude plugin test`. The test's `world()` answers the engine calls the mod makes. The tests cover:
  - the cue rules: below the line; armed with no seam; seam by commit; seam by clean tree; the step fallback; urgent with one notify per crossing; Later moving the line; reset after a compaction; subagent, aborted, `-p` and null-token turns ignored;
  - the tool: a valid compact payload, a valid handoff payload, and a missing field;
  - each button's calls, including a `skip` from compaction and a failed copy;
  - the `session.compact` hook: it fills empty instructions, sends the follow-up only after a manual compaction that is not skipped, and skips `precompute` while a prep result is pending;
  - a stale payload dropped on the user's next prompt;
  - `/wrap-up`, `/wrap-up off`, `/wrap-up on` and `/wrap-up send`.
- A `mise` task `test:wrap-up`, like `test:keepwarm`: `claude plugin validate plugins/cc-wrap-up && claude plugin test plugins/cc-wrap-up`. CI does not have the `claude` CLI, so it does not run this task.
- A manual run in a real session, with lowered `startTokens` and `stepTokens`, through both the compact path and the fresh-session path.

## Shipping

The change ships as one pull request:

- `plugins/cc-wrap-up/` at 1.0.0, plus its marketplace entry.
- `prep-compact` and `prep-exit`, each with a minor bump.
- `mise run sync`, so the README table and the generated files are updated.
- The `test:wrap-up` task.
- `docs/experiments.md` rows #21 to #25.

## Out of scope

- Windows other than 1M. A user on another window sets the three token settings.
- Merging prep-compact and prep-exit into one skill.
- Running an audit without a press.
- A list for picking a peer session; `/wrap-up send <name>` takes a name.
- Changing what auto-compaction does when it runs with no audit. The urgent cue is the only guard.
