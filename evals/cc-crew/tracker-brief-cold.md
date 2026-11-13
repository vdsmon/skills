You are a builder: a subagent that implements one brief. The design below is fixed. Build it; do not redesign it.

## Principle

A tracker is a watch that only the user ends: it wakes the session each time something worth telling happens and keeps watching. A job watch stays exactly as it is today.

## Where

- Repository: the git worktree you start in (a checkout of `vdsmon/skills`). First command: `git switch -c <branch> 7a3883e`, with the branch name from your first message (that commit is the plugin before trackers existed). All work goes on that branch, in this worktree.
- Plugin: `plugins/cc-quiet-watch` — `hooks/register.ts` (the whole mod, about 300 lines), `types/index.d.ts`, `hooks/quietwatch.test.ts`, `README.md`, `.claude-plugin/plugin.json`.
- Read first: the repo's `CLAUDE.md` (sections "Hooks", "Checks and tests", "Shipping a change"), then the five files above in full.

## Work, in order

1. **Types.** `Watch` gains `keep: boolean`. A saved watch without the field (written by 1.0.0) loads as `keep: false`.
2. **Arming.** The `watch` tool input gains `keep?: boolean`. `everyMinutes` stays the only interval field. For a tracker (`keep: true`): default 2, floor 0.5 (30 seconds), fractions allowed. For a job watch: default 10, floor 2, rounded, exactly as today. `stuckAfterMinutes` is ignored for a tracker.
3. **Arming a tracker.** Run the check once as today (a failed check denies as today, with the same allow-rule hint). Make no judge call at arming: store the first output's hash as the baseline and an empty line. Result text says: tracking "<name>", checked every N (seconds when under a minute), it wakes you when what the goal asks for happens, it keeps running until the user stops it with `/watches stop <name>`, end your turn and do not poll.
4. **Judging a tracker.** A tracker has its own judge system prompt and statuses: `{"status": "quiet" | "tell", "line": "<one short line>"}`. "tell": the change is something the goal says the user wants to hear about. "quiet": anything else (edits, reactions, noise, nothing new that the goal asks for). `JUDGE_SYSTEM` and the job statuses stay untouched.
5. **Checking a tracker.**
   - Same hash: reset errors, schedule the next check. A tracker is never "stuck".
   - Changed, verdict "tell": wake the session (state "has news", the line, the output), then keep the tracker: store the new hash, time and line, schedule the next check. The wake prompt ends with one line saying the tracker keeps running and only the user stops it.
   - Changed, verdict "quiet": store the new hash, time and line, schedule. No wake.
   - Changed, no verdict: keep the old hash and retry at the next check, as today. At the third judge failure in a row, wake once with the raw output ("changed, but could not be judged"), then store the hash so the same output is not sent again, reset the count, keep the tracker.
   - Check failed: at the third failure in a row wake once ("cannot be checked", with the error) and keep the tracker. Do not wake again for failures until one check succeeds; a success resets this.
   - If sending a wake prompt fails for a tracker, leave the stored hash unchanged so the next check tries again.
   - `wake` today cancels the timer and removes the watch. Split it so sending is shared and removal happens only for job watches.
6. **Stopping and listing.** `unwatch` and `/watches stop <name>` work for both kinds. The `unwatch` description says a tracker is stopped only when the user asks for it. The `/watches` list marks trackers, and shows the interval in seconds when under a minute.
7. **Tool description and schema.** Add `keep` to the `watch` schema: true makes a tracker, for something with no end (a Slack thread or channel, a pull request's comments, a page); it wakes the session each time the goal's kind of news appears and runs until the user stops it; use it when the user asks to track, follow or keep an eye on something. Update the `everyMinutes` description. Keep the description compact: it is listed to the model in every session.
8. **Tests**, in the existing style of `hooks/quietwatch.test.ts`: a tracker wakes on "tell", is still listed, and wakes again on a later change; a "quiet" change does not wake; unchanged output calls no model; three failed checks wake once, the tracker survives, further failures do not wake, a success resets; the interval floors (0.5 for a tracker, 2 for a job watch); a saved watch without `keep` behaves as a job watch. Every existing test passes unmodified.
9. **Docs.** README: a short "Trackers" section and the affected table rows. `plugin.json` description: add one sentence about trackers; the first sentence must still stand alone in 170 characters or fewer, the whole in 300 or fewer, with no host note.
10. **Ship files.** `mise run bump cc-quiet-watch minor`, then `mise run sync`, and commit what they change together with the plugin files.

Commits: one for the code and tests (items 1 to 8), one for docs, bump and generated files (items 9 and 10). Plain commit messages, each paragraph on one line, no attribution lines.

## Limits

- Job-watch behaviour and its judge prompt do not change. If an existing test would have to change, leave that item and report it.
- Nothing beyond what is named here: no new tools, commands or files, no adaptive interval, no Slack-specific code, `MAX_WATCHES` unchanged.
- Follow the file's code style. Comments only for a non-obvious why.
- Never push and never open a pull request.
- Run only `mise run test:quiet-watch` (the mod's validate and tests through the `claude` CLI) and `mise run verify`. No other suites.
- The lines of the user's global `CLAUDE.md` about asking the user, pull requests, merges, memory and subagent limits are for the main session, not for you.
- You may start a helper (a Sonnet subagent, or Haiku for a trivial lookup) for work that needs none of your context. You answer for what it returns. For this brief you probably need none.
- Where this brief is silent on something local to these files, decide it and list it in your report. Where filling a gap would change the tool's interface beyond what is written here, or job-watch behaviour, leave that item and report it.
- If something here contradicts the code or a test: when it touches one item, do the rest and report that item; when it breaks the premise of the brief, stop and report.

## Report

- The branch and the commit hashes.
- The last lines of `mise run test:quiet-watch` and `mise run verify`, as printed.
- "Decided without asking": every choice you made where the brief was silent.
- Anything that looked wrong or odd, and any place where the repo's docs and its code disagree.
- What you did not do.
