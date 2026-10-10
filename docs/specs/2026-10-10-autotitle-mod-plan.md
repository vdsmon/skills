# cc-autotitle: implementation plan

Builds `docs/specs/2026-10-10-autotitle-mod-design.md`. Branch `worktree-autoname-mod`, one PR. API facts below come from the 2.1.296 mod types.

## Changes to the spec found while planning

1. **Resume.** Atoms (`$.state`) live for one session process and are lost on resume; `$.store` is a JSON file per plugin that persists. Without it, every resumed session would count as named by hand and stop following drift, and you resume often. So `lastSet` and `pinned` are saved in `$.store` under `s:<session id>` with a timestamp. Entries older than 60 days are pruned on `session.start`. `isOff` stays per session process, as the spec says.
2. **Detach the fork.** `turn.complete` starts the check with `$.clock.after(0, …)`, not a bare `void`. The fork is then not tied to the turn whose hook started it (a fork is aborted when that turn is interrupted), and tests can drive it with the mocked clock.

The spec is updated in the same commit as this plan.

## Steps

Tests come before code in each step. Run `claude plugin validate plugins/cc-autotitle` after every change to `register.ts`.

### 1. Scaffold

- `plugins/cc-autotitle/.claude-plugin/plugin.json`: name, version `1.0.0`, description (first sentence 170 chars or fewer, whole 300 or fewer), author block as in cc-keepwarm, `"types": "./types/index.d.ts"`, `userConfig` with `firstAfterTurns` (number, default 3, min 1, max 50) and `recheckEveryTurns` (number, default 10, min 0, max 200).
- `hooks/hooks.json`: `{ "modules": ["./register.ts"] }`.
- `types/index.d.ts`: `Stats` and the `PluginState['cc-autotitle']` declaration (`turns`, `lastCheckTurn`, `compacted`, `pending`, `lastSet`, `lastSeen`, `pinned`, `isOff`, `failures`, `stats`).
- A `register.ts` stub that registers nothing; `claude plugin validate` passes.

### 2. Tests (`hooks/autotitle.test.ts`)

A `world(on)` like cc-keepwarm's: `mock.clock`, `session.start`, `session.id` (answers `sess-1`), `command.register`, `model.fork` (answer picked per test, calls counted, last prompt kept), `command.run` on `rename` (records the args), `classic.UserPromptSubmit` and `classic.PostCompact` bottoms. Helpers: `turn($, agentId?)` raises `$.turn.complete` with `reason: 'answer'`; `prompt($, title?)` raises `$.classic.UserPromptSubmit` and returns the result's `sessionTitle`; `autotitle($, args)`.

Cases (each fails before step 3):

1. No fork before turn 3; one fork after turn 3 (after `clock.advance(0)`); the next prompt returns `sessionTitle` with the forked name.
2. Re-check at turn 13 and not before; with `recheckEveryTurns: 0`, never.
3. A compaction makes the next turn check.
4. A reply equal to the current name applies nothing.
5. Bad replies (`Sure! pr-17-fixes`, one word, 11 parts, 41 chars, upper case) apply nothing, and the next turn forks again; after 3 failures in a row, no fork until the next scheduled check.
6. `api-error`, `empty-reply`, `aborted` count as failures; `nothing-to-fork` resets the count.
7. A prompt whose `session_title` is not `lastSet` pins: no later fork, no `sessionTitle`.
8. `/autotitle` forks at once, runs `rename` with the name and pins; `/autotitle focus on the PR` puts the hint in the fork prompt; with nothing to fork it answers "Nothing to name yet."
9. `/autotitle off` stops checks; `on` resumes them, clears the pin and takes `lastSeen` as `lastSet`, so the next prompt does not pin again.
10. `/autotitle status` shows state, last name, next check turn and counts.
11. A non-interactive session never forks; subagent turns (`agentId` set) do not count; a turn with `reason: 'aborted'` does not count.
12. Resume: a second `session.start` with the store holding `{ lastSet: 'x' }` and a prompt with `session_title: 'x'` does not pin; with `pinned: true` stored, it stays pinned.
13. A second check never starts while one is running.

If the harness does not provide `$.store`, the world mocks `store.get`, `store.set`, `store.keys` and `store.delete` over a `Map`.

### 3. `hooks/register.ts`

In cc-keepwarm's style: atoms plus `read`/`update`, `cfg` set from options in `register`, `isInteractive` and an `inFlight` flag in module memory.

- `session.start`: set `isInteractive`, register `/autotitle` (`argumentHint: '[hint|off|on|status]'`), load `s:<id>` from the store into `lastSet` and `pinned`, prune entries older than 60 days.
- `turn.complete`: skip unless main thread, `reason === 'answer'`, interactive. Count the turn. If `due()` and not `inFlight`, `$.clock.after(0, () => void check($))`. Wrap the bookkeeping in try/catch and always `return next(e)`.
- `due()`: not off, not pinned; `failures < 3`; and either (no `lastSet` and `turns >= firstAfterTurns`) or `compacted` or (`recheckEveryTurns > 0` and `turns - lastCheckTurn >= recheckEveryTurns`). After 3 failures, set `lastCheckTurn = turns` and reset `failures`, so the next try is the next scheduled check.
- `check($, hint?)`: fork with `prompt(current, hint)`; parse; on success set `pending` (if it differs from the current name), `lastCheckTurn = turns`, `compacted = false`, `failures = 0`; on failure `failures += 1`; on `nothing-to-fork` reset `turns` to 0. Returns the name or a reason, for the command.
- `parse(text)`: trim, strip one pair of backticks, no case folding (a capital letter fails), match `^[a-z0-9]+(-[a-z0-9]+){1,9}$`, 40 characters at most.
- `classic.UserPromptSubmit`: store `lastSeen = e.session_title`. If `e.session_title` is set and is not `lastSet`: set `pinned`, save, drop `pending`, return `next(e)`. Else, if `pending` differs from `e.session_title`: set `lastSet = pending`, save, clear `pending`, return `{ ...(await next(e)), sessionTitle: name }`.
- `classic.PostCompact` (main thread): set `compacted`.
- `session.end` with `reason: 'clear'`: reset `turns`, `lastCheckTurn`, `pending`.
- `command.run` on `autotitle`: `off`, `on`, `status` as in the spec; anything else is a hint. Run `check($, hint)`, then `$.command.run({ command: 'rename', args: name })`, set `lastSet` and `pinned`, save, answer `Named this session <name>.` If `$.command.run` is refused inside a command hook (checked in step 6), fall back: set `pending` and a `pinOnApply` flag, so the prompt hook pins right after it applies the name, and answer `Renames to <name> with your next message.`

The fork prompt (a constant, like cc-keepwarm's `PROMPT`):

```
[autotitle] Automated request from the cc-autotitle plugin, not a message from the user. Do not continue the conversation and do not think. Reply with one session name and nothing else.

Name this whole session the way a person would search for it in /resume weeks from now. Weigh where the work went and what came out of it (a PR, a fix, a decision, a report), not the last turn.
- Lead with the subject, then the action or result: pr-17-review-fixes, feed-cursor-off-by-one-fix.
- Keep the handles a person searches for: ticket keys, PR numbers, batch, pipeline or dataset ids, feature and file names.
- Drop filler words (session, chat, help, work, stuff, misc, question, claude) and the repo name.
- Lowercase English, only letters, digits and hyphens, 2 to 6 words, at most 40 characters, even when the conversation is in another language.
```

plus, when set, `The session is now named <current>. If that name still fits the main work, reply with it unchanged.` and `The user asks: <hint>`.

### 4. Measure the prompt

Reuse `evals/session-name/` as `evals/autotitle/` (git mv): the same three fixtures, the prompt above in place of the skill call, and `grade.py` changed to expect one bare name per run. The `split` case passes when the name covers either thread. Run each case 3 times with `claude -p --model opus` over the fixture text. Goal: 9 of 9 valid names, `drift` names the feed cursor fix, `portuguese` keeps `rev-2210` and `uv`. Change the wording until it passes, and keep the result as experiments row #22.

### 5. Repo wiring

- Remove `plugins/cc-session-name/` and its marketplace entry; add the `cc-autotitle` entry (`source: ./plugins/cc-autotitle`).
- `mise.toml`: `test:autotitle` = `claude plugin validate plugins/cc-autotitle && claude plugin test plugins/cc-autotitle`.
- `CLAUDE.md`: name `test:autotitle` beside `test:keepwarm`.
- `plugins/cc-autotitle/README.md` in cc-keepwarm's shape: what it does, install (it replaces cc-session-name), how it works, the command, settings, tests.
- `mise run sync`, then `mise run verify` and `mise run test:autotitle` pass.

### 6. Live check

Load the plugin with `--plugin-dir` in an interactive Haiku session in tmux, as in the spike, in a scratch folder:

- Turn 3 gives a `custom-title` record and the name in the prompt box border.
- `/autotitle` with a hint renames at once (confirms `$.command.run` inside a command hook, or the step 3 fallback is used).
- `/rename` by hand, then 15 more turns: no rename.
- Quit and `--resume`: an auto name keeps following drift; a pinned one stays pinned.
- Nothing in the transcript or context from the auto path (grep the JSONL for `autotitle`).

Delete the scratch session's transcript folder afterwards.

### 7. Ship

Commit, push, and open the PR with the `open-pr` skill. Add the spike and prompt rows to `docs/experiments.md` if not already there. After merge, install from the marketplace, run it for a day of real sessions, and compare its names with the ones you would pick (spec, Testing).

## Done when

- `mise run verify` and `mise run test:autotitle` pass.
- The prompt eval passes 9 of 9.
- The live check in step 6 passes, with each item seen in the transcript JSONL.
