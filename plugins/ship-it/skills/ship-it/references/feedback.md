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

The script drops threads whose `resolution` is set, so a resolved finding does not re-surface on the post-fix re-fetch. Each remaining finding carries its `comment <id>` (and, with `--json`, an `id` field) so it can be resolved in Step 3.6.5.

**Stale findings**: a finding that was addressed but not yet resolved (you fixed the code but did not POST the resolve) still comes back on re-fetch. Compare against the prior round, skip anything already fixed in a pushed commit, and resolve it in Step 3.6.5 so it stops re-surfacing. Only newly-introduced findings need a code change.

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

## Step 3.6.5: Resolve addressed threads (default)

After the post-fix re-verify shows CI and the reviewer green, resolve every CodeRabbit thread that a pushed commit actually addressed. This is the default, not opt-in: an unresolved thread re-surfaces on every future re-fetch and reads as an open defect to anyone scanning the PR.

Resolve only threads you fixed in code. A thread you disagreed with or intentionally skipped (Step 3.5) does **not** stay silently open — it goes through Step 3.6.6 (reply with reasoning, re-arm the reviewer, act on its response).

Per addressed finding (`<CID>` is the `comment <id>` from Step 3.3):

```bash
WS=<workspace>; RS=<repo_slug>; PR=<pr_id>; CID=<comment_id>
FIX_SHA=$(git rev-parse --short HEAD)   # or the specific commit that addressed it

# 1. Reply pointing at the fix commit (one line, plain ASCII, no em-dash).
bkt api "2.0/repositories/$WS/$RS/pullrequests/$PR/comments" -X POST \
  -d "$(jq -n --arg b "Fixed in $FIX_SHA. <one-line what changed and why>." \
              --argjson pid $CID '{content:{raw:$b},parent:{id:$pid}}')" --json

# 2. Resolve the thread.
bkt api "2.0/repositories/$WS/$RS/pullrequests/$PR/comments/$CID/resolve" -X POST --json
```

Endpoint gotchas (learned the hard way, do not re-derive):

- `POST .../comments/<CID>/resolve` is the resolve endpoint. There is a matching `DELETE` to unresolve. The `links.resolve` rel is often absent from the comment payload, the endpoint still works, do not gate on the rel.
- Success returns a `comment_resolution` object (`{created_on, user, type:"comment_resolution"}`). It has no top-level `resolved:true`. A `jq -r '.resolved'` check misreports this as failure. Judge success by re-fetching the comment and testing `.resolution != null`, not `.resolved`.
- Only resolve a top-level inline comment (`parent == null`). Replies cannot be resolved.

Verify:

```bash
bkt api "2.0/repositories/$WS/$RS/pullrequests/$PR/comments/$CID" --json \
  --jq '.resolution != null'   # true == resolved
```

Skip this step only if the user explicitly asked to leave threads for the maintainer.

## Step 3.6.6: Reasoned-skip threads — reply, re-arm reviewer, act on its response

A thread you did not fix (disagreed, out of scope, intentional skip) is not just left for the maintainer. The reviewer replies to reasoning comments — use that round-trip to drive every actionable thread to a terminal state.

1. **Reply with reasoning** on each skipped thread (one line, plain ASCII, no em-dash): what you are not doing and why. Do not resolve yet. Write the reply in a natural human voice — no AI-writing tells (no em-dash, no rule-of-three, no "it's worth noting", no inflated significance, no sycophancy). Plain, direct, like a maintainer typed it. State this constraint inline; never name or point to a humanizing tool/skill in the reply or the thread.
2. **Re-arm the reviewer Monitor.** Stop the prior reviewer Monitor (Step 3.0), launch a fresh one watching for new reviewer replies under the skipped CIDs. Reviewer replies are async, usually within ~1-3 min of your reply. State-change-only emission, bounded timeout (a reply round-trip, not the full review).
3. **Fetch the reviewer's responses** (fast — one newest page, no full pagination):

```bash
WS=<workspace>; RS=<repo_slug>; PR=<pr_id>
SKIPPED="<cid1>,<cid2>,..."   # comma-separated reasoned-skip CIDs
bkt api "2.0/repositories/$WS/$RS/pullrequests/$PR/comments?sort=-created_on&pagelen=50" --json \
  | jq -r --arg o "$SKIPPED" '($o|split(",")) as $ids | .values[]
      | select(.parent and (.parent.id|tostring|IN($ids[]))
               and (.user.display_name|test("coderabbit";"i")))
      | "p=\(.parent.id) [\(.created_on[0:19])] \(.content.raw|gsub("\n";" ")|.[0:240])"' | sort
```

4. **Classify each reviewer response and act:**
   - **Agrees / withdraws** ("understood", "suggestion withdrawn", "no action needed", or it acknowledges your scope point): resolve the thread (reuse the Step 3.6.5 resolve call + `.resolution != null` verify). No further reply needed.
   - **Pushes back** (restates the finding, counter-argument): reconsider. Re-enter Step 3.5 — if the pushback is right, fix + commit + push + resolve; if you still disagree after weighing it, leave open and escalate to the user with both sides. Do not resolve a contested thread yourself.
   - **Errors / no verdict** (e.g. "Oops, something went wrong"): leave open, note it in the completion summary. At most one re-trigger (a fresh nudge reply), then hand to the maintainer.

Bound: one reviewer round-trip per skipped thread, plus at most one re-trigger on a reviewer error. Do not poll indefinitely waiting for a verdict — a thread with no reviewer verdict after the round-trip is reported open, not chased.

## Step 3.7: Completion

Print the final summary:

```
Branch:  <branch>
PR:      <pr_url>
Status:  <draft|ready>, CI passed
Threads: <N resolved> / <M open>   # open = reviewer pushed back, errored, or gave no verdict — list each with the one-line reason
Commits:
  <git log --oneline>
```

Done. ship-it does not flip the PR from draft to ready, that is a maintainer call after CI is green.

## Next

ship-it pipeline complete.
