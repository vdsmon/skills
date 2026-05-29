# Stage: e2e

## Purpose

Run the project's end-to-end / integration / smoke suite and surface any failures.
This stage is opt-in: the default handler is `none`, so it normally does nothing.
A workspace enables it by wiring `e2e` to `subagent:*` or `skill:*` in `workspace.toml [pipeline.handlers]`.
This doc is the instruction set for the handler that runs when it is enabled.

e2e sits AFTER `code_review` so cheap inline review catches obvious issues before a slow end-to-end run burns time.
By the time you run, the implement diff has already passed review.

## Inputs

- `.flow/runs/<KEY>/ticket.json` — ticket context (helps target which flow the
  e2e suite should exercise).
- The current repository, including the implement-stage changes in the working
  tree.
- The project's e2e/integration harness — you detect it (see Steps).

## Steps

1. Detect the e2e harness. Look for, in rough order:
   - `playwright` config (`playwright.config.{ts,js}`) → `npx playwright test`.
   - `cypress` config (`cypress.config.*`) → `npx cypress run`.
   - a pytest e2e marker / dir (`pytest.ini` or `pyproject` with an `e2e`
     marker, a `tests/e2e/` tree) → `pytest -m e2e` or `pytest tests/e2e`.
   - a `make e2e` / `make integration` target in the Makefile.
   - an `e2e` / `test:e2e` script in `package.json`.
   - any CI workflow that names an e2e job — mirror its command.

2. Resolve the run command from what you found.
   Prefer the project's own declared command (Makefile target, package script, CI step) over a guessed invocation, so you match how the suite actually runs.

3. Run the suite.
   Let it complete; e2e suites are slow but the stage timeout is sized for that.

4. Surface the result:
   - All green → report the suite name, the command run, and the pass summary.
   - Failures → report which scenarios failed, the command, and the relevant
     failure output. e2e failures are real regressions; do not return success
     on red.

5. Return the run result as your response.

## Outputs

- The e2e run result (command, pass/fail summary, failure detail on red),
  returned as your stage report. The do-loop captures it to
  `<ticket-dir>/stages/e2e.out`; you do not write that file yourself.

## Errors

- Suite runs and fails → report the failing scenarios and return with the
  stage unfinished. A failing e2e suite is a failed stage.
- No harness detectable but the handler is opt-in (not `none`) → this is a
  workspace misconfiguration: e2e was enabled without an installed suite.
  Report that no e2e harness was found and what you searched for, so the user
  can either install one or set the handler back to `none`.

## Skip conditions

- Stage handler is `none` (the default). The do-loop's `none` branch
  short-circuits the stage before this doc is ever read. e2e runs ONLY when a
  workspace opts in via `subagent:*` or `skill:*`.
