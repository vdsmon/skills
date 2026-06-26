---
name: investigate
argument-hint: "[error, incident, or link]"
description: Investigate a reported error or incident end to end, read the report, dig across every reachable system (code in any repo, Airflow, cloud/job logs, databases, Jira, Slack), find the real root cause, and propose a fix. Use when someone reports something is broken, failing, erroring, or behaving wrong, pasted stack traces, Slack threads, Jira links, "X is failing in prod", "a user is seeing this error", "the DAG broke", "why did this job fail", "can you look into this", or when the user runs /investigate. The defining behavior is that it never guesses past a source it can't reach. If access or clarity is missing, it stops and asks the human instead of inferring. Use this for an incident reported by someone else that spans runtime systems where evidence may be unreachable; for a reproducible bug in code you can run and inspect directly, use the systematic-debugging skill instead.
---

# Investigate

Someone reported a problem. Your job: find the *real* root cause from *real* evidence, then propose a fix. Not a plausible cause, but the actual one, traced through logs, state, and code.

The problem can live in any repo or runtime system, not just the one you happen to be in. Follow the evidence wherever it goes.

## Run this in the main thread

This skill must run in the main conversation, not as a subagent. Its one non-negotiable behavior (stop and raise to the human for access) only works when you can talk to the human mid-investigation. A subagent can't; it just returns. You *may* spawn read-only subagents to dig through reachable sources in parallel, but parsing the report, raising blockers, and final synthesis stay with you.

## The Prime Directive: never infer past a missing source

If a piece of evidence you need is unreachable (no access, a link you can't open, an ambiguous reference, a log you can't pull), **STOP and raise it to the human.** Ask for the access or the clarity. Do not fill the gap with a guess.

Inferring past a wall is the single failure this skill exists to prevent. A guessed root cause looks like an answer, sends the human chasing it, and is usually wrong. A raised blocker costs one message and gets the truth. Raise.

**Letter = spirit.** "I'll note it's probably X and move on" is inferring. "Based on the error name it's likely..." without reading the log is inferring. If you're about to write a cause you didn't pull evidence for, stop.

### Rationalization table

| The thought | The reality |
|---|---|
| "The error message makes the cause obvious, I don't need the log." | Error messages name the symptom, not the cause. Pull the log. |
| "I can't reach prod, but it's probably the same as local/dev." | Prod ran with prod data and prod config. Different. Get the prod evidence. |
| "Asking for access is annoying, I'll infer to save a round-trip." | A wrong inference costs far more round-trips than one access ask. |
| "I'm fairly confident, I'll just flag it as a guess." | A flagged guess still gets chased as if real. If it's a guess, you're not done. |
| "The ticket is vague but I'll assume they mean the nightly run." | Assuming the target is inferring. Ask which run/job/date/env. |
| "Most of the evidence points one way, the missing piece won't change it." | Then it's cheap to confirm. If it could change the answer, you must. |
| "The identifiers don't quite match the code, but they're close enough." | Close-enough mappings send people to the wrong code path. Confirm the real identity. |
| "My credentials are expired / SSO is dead, so I'll hand the fetch back to the human." | Giving up on a source you can authenticate into is its own failure. If you can auth (e.g. an SSO login), auth and pull it yourself. Only raise for access you genuinely cannot get. |
| "My local checkout *is* the code that ran." | The deployed image/DAG/job builds from the merged branch (`origin/<branch>`), not your working copy. A checkout even a few commits behind makes `git log`, `git blame`, and local repro reflect different code than what failed. `git fetch` and confirm `HEAD..origin/<branch>` is empty before trusting any of them. |
| "The fix commit is an ancestor of `origin/<branch>`, so my checkout is synced." | Ancestry of one commit ≠ your checkout being current. The commits between your HEAD and `origin/<branch>` may touch the very files you're about to read. Run `git rev-list --count HEAD..origin/<branch>` and confirm `0`; a `merge-base --is-ancestor` check does not. |

If you catch yourself writing a cause sentence not backed by something you actually read, STOP. That's the directive firing.

## Step 1: Parse the report

Read what you were handed (pasted text, Slack link, Jira key, stack trace). Extract:
- **The symptom:** exact error, failing job/DAG/task/endpoint, what the reporter observed.
- **Every referenced system:** job/DAG/run ids, storage paths, table names, ticket keys, threads, log groups, commit/PR refs, repos.
- **What you don't know yet:** which run, which date, which environment, whose account, which repo.

## Step 2: Build the access ledger, then batch-raise (hybrid)

List every system Step 1 says you'll need and mark each **reachable** or **blocked**. Resolve the blocked ones **as one batch** with a single question to the human before you start digging (one interruption, not ten). New blockers found mid-dig get raised just-in-time (Step 4).

For *what's reachable in this environment and how*, and which blockers are chronic (e.g. prod orchestrator logs), read `references/access-map.md`. Authenticate anything you can authenticate yourself (don't raise for an auth you can perform); only raise for access you genuinely cannot obtain.

When you raise, be **specific**: name the exact log / run / table you need and *why it changes the answer*. Not "I might need more info", but instead "paste the log for `job_x` run `2026-06-15`, task `transform`; it'll tell us whether the OOM was data volume or a config regression." Use `AskUserQuestion` if your host has it; otherwise just ask directly.

## Step 3: Dig wide across reachable sources

Pursue several angles at once; an incident usually leaves evidence in more than one place:
- **Code** (sync first, because the deployed system runs the *merged* branch, not your checkout): `git fetch`, then **run exactly `git rev-list --count HEAD..origin/<branch>` and confirm it prints `0`.** That checks *your checkout is current*, but it is NOT the same as confirming the fix merged (`git merge-base --is-ancestor <fix> origin/<branch>` can say yes while your HEAD is still commits behind; that substitution has produced wrong root causes). If the count is not `0` you are behind: `git pull` (or dig from a detached worktree at `origin/<branch>`) **before reading any source file**, because `Read`/`Grep`/`sed` read your working tree, not `origin/<branch>`, so until the count is `0` every file you open may be code that never ran. If you won't sync the tree, read deployed code with `git show origin/<branch>:<path>` instead. Then `git log` / `git blame` around the failing code, recent changes/PRs that could regress it, the actual function in the stack trace, across whatever repo owns it, not just the current one.
- **Runtime logs**: cloud/job logs for the real exception and surrounding context.
- **State**: query the databases for what the job actually saw: row counts, nulls, schema drift, the specific records.
- **History**: tickets for prior occurrences/linked issues; chat threads for what people already noticed.
- **Domain**: domain-knowledge sources for business/format logic when relevant.

Form **falsifiable hypotheses** before chasing them: "if X is the cause, then the log will show Y / the table will have Z." Rank them, then let evidence confirm or kill each. Change one variable at a time when you probe.

Parallelize reachable, independent digs with read-only subagents and synthesize their findings yourself. Subagents dig; they do **not** raise, and if one hits a wall, it reports the wall and *you* raise it.

Keep an **evidence trail**: for each system, what you checked and what you found (or that it was clean, since clean findings rule things out). This is half the deliverable.

### When it reproduces locally

If the failure can be reproduced outside prod, build a fast pass/fail loop (failing test, CLI fixture, replay) and bisect, which beats log-reading. Reproduce -> hypothesise -> instrument -> fix. The access-gating discipline still applies the moment you need a source you can't reach.

**Reproduce the code that actually ran, not the code you happen to have checked out.** A repro on a stale checkout proves nothing about the deployed failure, so `git fetch` and reproduce on the exact ref the failing system built from (e.g. a detached worktree at `origin/<branch>`). A repro of commits-behind code once yielded a wrong "stale image" root cause that the user had to overturn; the merged branch already contained the regression.

## Step 4: Raise new blockers just-in-time

If the dig surfaces a system you didn't know you'd need (a second job, a table you're not connected to, an ambiguous owner), raise it the moment you hit it. Same rule as Step 2: stop, ask, don't infer.

## Step 5: Deliver: root-cause report + proposed fix

1. **Root cause:** the actual cause, each claim tied to specific evidence (this log line, this commit, this row count). If you couldn't reach certainty, say exactly what's still unconfirmed and what evidence would close it, and do not round up to a conclusion.
2. **Evidence trail:** per system: checked -> found. Include the clean ones (they rule things out).
3. **Proposed fix:** a concrete diff or step plan. **Do not apply it.** The human decides.
4. *(optional)* a drafted reply to the reporter / ticket comment, if useful.

If the Prime Directive left something unresolved (the human never provided a blocked source), the report says so plainly instead of papering over it.
