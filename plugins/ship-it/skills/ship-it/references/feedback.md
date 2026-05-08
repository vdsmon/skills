# Stage: FEEDBACK

> Wait on CI plus AI code reviewer. Fix failures, push, re-verify until both green.

Prereqs: PR exists. `PR_ID` known (from Stage 2 stdout, or re-detected via the Stage 2 detection snippet on resume).

## Step 3.0: Monitor hygiene

This stage launches Monitors that can time out, stream-end, or go stale across re-verify loops. Before launching a new Monitor for the same target, stop the prior one:

```
TaskStop(task_id="<previous_ci_monitor_id>")
TaskStop(task_id="<previous_review_monitor_id>")
```

Exactly one active Monitor per target (CI, reviewer) at any time. Multiple stale Monitors clutter the session UI, duplicate notifications, and waste context.

## Step 3.1: Wait for CI

Launch a Monitor that polls `bkt pr checks <PR_ID>` via an inline bash loop. **Emit only on state change**, not every poll iteration. Every stdout line becomes a chat notification, and INPROGRESS phases often span 5+ minutes:

```
Monitor(
  description="CI pipeline for PR #<PR_ID>",
  command='prev=""; while true; do raw=$(bkt pr checks <PR_ID> 2>&1 | grep -iE "Pipeline"); state=$(echo "$raw" | grep -oiE "INPROGRESS|SUCCESSFUL|FAILED|STOPPED|ERROR" | head -1); if [ "$state" != "$prev" ]; then echo "[$(date +%T)] Pipeline: $state"; prev=$state; fi; if echo "$state" | grep -qiE "SUCCESSFUL|FAILED|STOPPED|ERROR"; then break; fi; sleep 60; done',
  timeout_ms=1500000, persistent=false
)
```

Why inline: the pattern is small enough that a dedicated poll script adds maintenance surface without payoff, and can produce false negatives. Trust raw `bkt` output. The `prev` shell variable diff'd against current state suppresses the per-poll notification flood.

**While waiting**, continue other work. Monitor notifications arrive async.

**CI passes** (grep matches `SUCCESSFUL`): continue to Step 3.2.

**CI fails** (grep matches `FAILED`, `STOPPED`, or `ERROR`): open the pipeline URL, inspect failed steps via `bkt api`. Typical fixes:

- Merge conflicts -> `git merge "$DEST"`, resolve, commit, push.
- Lint or format -> run the project's lint/format task, commit, push.
- Test failures -> analyze, fix code, commit, push.
- Lock file out of sync -> regenerate via the project's package manager, commit, push.

After pushing fixes, stop the prior CI Monitor (Step 3.0), re-arm. **Max 3 retry cycles**, stop and ask user after 3.

**Gate before pushing CI fixes**: `AskUserQuestion` -> Approve and push / Show diff first / Skip CI fix.

**If no Pipeline entry ever appears** (`bkt pr checks` shows the reviewer but no `Pipeline` line for >3 min): CI isn't wired for this branch, note it and skip to Step 3.2. Confirm via raw `bkt pr checks <PR_ID>` first, do not assume "no pipeline" from any other signal.

## Step 3.2: Wait for AI code reviewer

The reviewer is configured via `reviewer_bot.name` (default `coderabbit`). Same inline-bash pattern, same state-change-only emission, just grep for the reviewer's display name:

```
Monitor(
  description="<ReviewerName> review for PR #<PR_ID>",
  command='prev=""; while true; do raw=$(bkt pr checks <PR_ID> 2>&1 | grep -iE "<ReviewerName>"); state=$(echo "$raw" | grep -oiE "INPROGRESS|SUCCESSFUL|FAILED|STOPPED|ERROR" | head -1); if [ "$state" != "$prev" ]; then echo "[$(date +%T)] <ReviewerName>: $state"; prev=$state; fi; if echo "$state" | grep -qiE "SUCCESSFUL|FAILED|STOPPED|ERROR"; then break; fi; sleep 60; done',
  timeout_ms=1500000, persistent=false
)
```

Bump `timeout_ms` for very large PRs (500+ lines). If the reviewer never appears for this repo, it's probably not configured, skip this step and proceed to completion.

## Step 3.3: Fetch comments

For CodeRabbit on Bitbucket:

```bash
python3 SKILL_DIR/scripts/fetch_coderabbit_comments.py "$WORKSPACE" "$REPO_SLUG" "$PR_ID"
```

Output: actionable inline findings grouped by file with severity plus line number. Walkthrough summaries are filtered out.

For other reviewers (when an adapter ships): the script slot lives at `SKILL_DIR/scripts/fetch_<bot>_comments.py`. Until that adapter exists, fall back to `bkt pr comments <PR_ID> --json` and parse by hand.

**Stale findings**: on re-fetch after a fix push, the script may return findings from prior rounds that are already resolved. Compare against the prior round, mark already-fixed items stale and skip. Only act on new findings.

## Step 3.4: Parse and classify

- **Actionable**: bug, logic error, security issue, missing edge case, perf concern.
- **Non-actionable**: praise, style already handled by the linter, nitpicks without correctness gain.

Act on actionable only.

## Step 3.5: Fix, commit, push

Per actionable comment: read file plus context, understand the flag, apply fix if it improves the code. Disagree? Note and skip, let the user decide.

Commits should follow the project's existing commit-message convention (the most recent 10-20 commits are the source of truth, do NOT impose a new format). Group fixes logically, no lump "address review" commit.

**Gate before push**: `AskUserQuestion` -> Approve and push / Amend commits. Then `git push`.

## Step 3.6: Re-verify after fix push

After pushing fixes, **must** re-run both CI and reviewer Monitors. The reviewer often adds new findings on fix commits. CI may regress. Don't proceed to completion until both green.

Stop the prior two Monitors (Step 3.0), launch both fresh concurrently (one for CI, one for the reviewer, same inline patterns as 3.1 and 3.2). If CI fails again, re-enter the fix loop (max 3 attempts across all cycles). If the reviewer has new actionable findings, loop Step 3.3-3.5 again.

## Step 3.7: Completion

Print the final summary:

```
Branch:  <branch>
PR:      <pr_url>
Status:  <draft|ready>, CI passed, review clean
Commits:
  <git log --oneline>
```

Done. ship-it does not flip the PR from draft to ready, that is a maintainer call after CI is green.

## Next

ship-it pipeline complete.
