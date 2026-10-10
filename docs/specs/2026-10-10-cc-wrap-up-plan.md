# cc-wrap-up: implementation plan

This plan implements `docs/specs/2026-10-10-cc-wrap-up-design.md`. All work happens on branch `feat/cc-wrap-up`, and everything ships in one pull request.

Each task ends green and with a commit. Tasks 2 to 8 use TDD: first write the failing tests in `plugins/cc-wrap-up/hooks/wrap-up.test.ts`, then write the code, then run `mise run test:wrap-up`. The tests drive the engine the way `plugins/cc-keepwarm/hooks/keepwarm.test.ts` does. A `world(on)` function answers the engine calls the mod makes (`session.usage`, `process.run`, `command.run`, `session.compact`, `prompt.submit`, `ui.copy`, `ui.notify`, `session.send`). It records each call, so the test can check them.

Before writing an API call, look up its declaration in the types file that the plugin-authoring skill gives you. Do not guess shapes.

## Task 0: probes (spike, throwaway)

This task answers the spec's four checks before any mod code exists. The probe mod lives in `$CLAUDE_JOB_DIR/tmp/wrapup-probe/` and is never committed.

1. Write a probe mod, `wrapup-probe`. It has:
   - in `session.start`: register `/probe`, and register a deferred tool `ready` with the spec's input schema;
   - a `tool.call` hook for `mcp__wrapup-probe__ready` that logs the input;
   - a `session.compact` hook that logs `trigger`, `instructions`, whether `usage` is set in the result of `next(e)`, and the first 300 characters of the summary message;
   - `/probe list`: log the `$.command.list()` entries whose name contains `prep` or `clear`;
   - `/probe clear`: run `$.command.run({ command: 'clear' })`, then `$.prompt.submit({ text: 'Reply with the single word CLEARED-OK', asUser: true })`;
   - `/probe compact`: run `$.session.compact({ instructions: 'End the summary with the word PINEAPPLE-7.' })` and log the result.

   All logs are lines appended with `$.fs` to `$CLAUDE_JOB_DIR/tmp/wrapup-probe/log.txt`.
2. Run `claude plugin validate` on the probe.
3. Start `claude --plugin-dir <probe> --model claude-haiku-5-5` in a tmux session. Drive it with `tmux send-keys` and read the log:
   - **Check 3:** `/probe list`. Write down the exact command names of prep-compact, prep-exit and clear.
   - **Check 4:** prompt: "Is a tool whose name ends in `__ready` in your deferred tool list? If yes, load it and call it with kind compact and message test." The log must show the tool input.
   - **Check 1:** `/probe clear`. Then `/probe list` again, which must log, and the transcript must show `CLEARED-OK` as the first turn of the new session.
   - **Check 2:** restart with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`, and read large files until the context is near 80k, so that precompute can run. Watch the log for a `precompute` trigger. Then run `/probe compact`. If the summary ends with `PINEAPPLE-7`, the instructions were used. If `usage` is absent, a precomputed summary was reused.
4. Add one row per check to `docs/experiments.md`, in the existing table format.
5. Update the spec where a check changed the design:
   - check 1 fails: Fresh session here uses its fallback (fill `/clear`, then submit on the next prompt);
   - check 2 shows reuse: the mod's `session.compact` hook returns `{ skip }` for the `precompute` trigger while the phase is `prepping` or `ready-compact`; if precompute never fired, apply this guard anyway and note why;
   - check 3: use the exact command names;
   - check 4 fails: register the tool with `isDeferred: false`.
6. Commit the experiments rows and the spec edits.

## Task 1: scaffold the plugin

1. Create `plugins/cc-wrap-up/` with these files:
   - `.claude-plugin/plugin.json`: name, version `1.0.0`, description, author block and links as in cc-keepwarm, `"types": "./types/index.d.ts"`, and `userConfig` for `startTokens`, `stepTokens` and `urgentMarginTokens` with the spec's defaults. The first sentence of the description must stand alone in 170 characters or fewer, and the whole description must be 300 characters or fewer.
   - `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
   - `types/index.d.ts`: types `Phase`, `Payload` and `PrepKind`, plus `PluginState['cc-wrap-up']` with `phase`, `line`, `payload`, `prepKind` and `isOff`.
   - `hooks/register.tsx`: a `register` that only reads the options and calls `next(e)` on `session.start`.
   - `hooks/wrap-up.test.ts`: `world()` and `start()` helpers, and one test that the module loads.
2. Add the marketplace entry to `.claude-plugin/marketplace.json` with `source: ./plugins/cc-wrap-up`.
3. Add a `test:wrap-up` task to `mise.toml`, next to `test:keepwarm`.
4. Run `mise run sync`, `mise run verify` and `mise run test:wrap-up`.
5. Commit.

## Task 2: the cue

**Tests:**
- Below the line: no phase change.
- Past the line with no seam: `armed`, and nothing is drawn.
- A seam by commit: a `Bash` `tool.call` running `git commit -m x` succeeds in the turn, so the phase becomes `cue`.
- A seam by a clean tree: `process.run` gives empty output, so the phase becomes `cue`.
- `git status` runs only past the line, and at most once per turn.
- The step fallback: past `line + step` with no seam, the phase becomes `cue`.
- Urgent: the phase becomes `urgent`, with one notify. Later followed by another urgent turn does not notify again. After the tokens drop below urgent and cross it again, it notifies again.
- Later sets `line` to the tokens plus the step.
- With a 200k threshold, the start line is 100k.
- Turns that do not count: a turn with an `agentId`, a turn with `reason: 'aborted'`, a non-interactive session, the mod switched off, and a missing `tokens`.
- The threshold is read once for each model. It is read again after a compaction and after a model switch.

**Code:**
- Hooks:
  - `turn.complete`: the main thread with an answer runs the rules from the spec.
  - `tool.call` on `Bash`: after `next(e)`, note a commit seen in this turn.
  - `prompt.submit`: reset the commit flag at the start of each turn.
  - `session.compact`: after a compaction that is not skipped, reset the threshold cache and the urgent-notify flag.
- Write the decision as one pure function, `decide(state, inputs)`. It returns the next phase, the line and whether to notify. The hooks only gather the inputs and apply the result.

Commit.

## Task 3: the tool and the payload

**Tests:**
- A valid `compact` payload sets the phase to `ready-compact`.
- A valid `handoff` payload sets the phase to `ready-handoff`.
- A missing `message`, `followUp`, `resumePrompt` or `handoffPath` gives an error that names the field, and the phase stays the same.
- A `prepping` turn that ends without a tool call: the phase becomes `idle`, with the toast.
- A stale payload: a composer `prompt.submit` drops it. The mod's own follow-up submit does not drop it, and neither does a slash command.

**Code:**
- `$.tool.register` in `session.start`, deferred unless check 4 said otherwise.
- The `tool.call` hook for `mcp__cc-wrap-up__ready`.
- The stale rule, in `prompt.submit`.

Commit.

## Task 4: the band and the compact path

**Tests:**
- Each phase renders its text and buttons. `idle` and `armed` call `next(e)`, and so does `hasSurvey`.
- Compact runs the prep-compact command and sets `prepping`. When prep-compact is missing from `command.list`, the button is plain Compact now.
- Compact now calls `session.compact` with the message, then `prompt.submit` with the follow-up and `asUser`. A `skip` gives a toast, keeps the phase, and submits nothing.
- Edit fills `/compact <message>` and keeps the payload.
- Not now sets the phase to `idle`.
- The `openQuestion` note renders.

**Code:**
- An `AbovePrompt` `ui.render` hook with a `Box`, `Text` and `Button` tree for each phase.
- Button handlers that call the `$` methods from the spec.

Commit.

## Task 5: the handoff path

**Tests:**
- Hand off runs the prep-exit command. When prep-exit is missing, the button is not shown.
- Fresh session here runs `clear`, then `prompt.submit` with the resume prompt. If check 1 failed, test the fallback instead.
- Copy prompt calls `ui.copy` with the surface. `isCopied: false` gives a toast and keeps the band.
- Done sets the phase to `idle`.

**Code:** the handlers, and a module variable that carries the resume prompt across `/clear`.

Commit.

## Task 6: the session.compact hook

**Tests:**
- A `manual` trigger with a `ready-compact` payload pending and empty instructions passes the message as the instructions.
- A `manual` trigger with the user's own instructions keeps them.
- The follow-up is submitted only after a compaction that is not skipped.
- The `auto` and `plugin` triggers pass through unchanged.
- The precompute guard, if Task 0 added it.

**Code:** the hook from the spec, plus any guard from Task 0.

Commit.

## Task 7: commands

**Tests:**
- `/wrap-up` opens the band in `cue`, also when the mod is off.
- `off` and `on` change `isOff`, and the cue stops and resumes.
- `send <name>` calls `session.send` with the resume prompt. With no pending handoff, or with no name, it replies with a message and sends nothing.

**Code:** `$.command.register` in `session.start`, and a `command.run` hook for `wrap-up`.

Commit.

## Task 8: skill changes

1. Add the one-line rule to `plugins/prep-compact/skills/prep-compact/SKILL.md`, step 3, and to `plugins/prep-exit/skills/prep-exit/SKILL.md`, step 4, worded as the spec gives it.
2. Run `mise run bump prep-compact minor` and `mise run bump prep-exit minor`.
3. Run `mise run test:prep-exit` and `mise run verify`. `check.py` must accept the tool name in portable skills.
4. Commit.

## Task 9: README, verification, pull request

1. Write `plugins/cc-wrap-up/README.md` in the format of cc-keepwarm's README. It covers what the plugin does, install, how the cue decides, the band, the commands, the settings, what it costs (nothing until you press), and the tests.
2. Run `mise run sync`, `mise run verify`, `mise run test` and `mise run test:wrap-up`.
3. Manual run: install from the local marketplace in a real session. Grow the context past 500k, or lower `startTokens` for the run. Then:
   - make a commit, and check that the cue appears;
   - go through Compact, Compact now and the follow-up;
   - in a second session, go through Hand off and Fresh session here.

   Record what happened in the PR description.
4. Open the pull request with the open-pr skill.

## Risks

- The `claude-code/testing` harness may not answer some engine calls (for example `session.usage` or `process.run`) the way the tests need. If so, answer them in `world()` as keepwarm does with `model.fork`. If a call cannot be mocked at all, move that check to the manual run and say so in the PR.
- The mod's API is new, and a Claude Code upgrade can change it. `mise run test:wrap-up` is the guard, as `test:keepwarm` is for keepwarm.
