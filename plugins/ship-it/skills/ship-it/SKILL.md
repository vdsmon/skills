---
name: ship-it
description: Push the current branch, open a draft PR, attach default reviewers, then wait on CI and the AI code reviewer in a fix loop until both are green. Ticket-agnostic. Use whenever you have a feature branch ready to ship and want the push, PR creation, CI wait, and code-review feedback loop handled end to end. Supported stack today, Bitbucket Cloud plus bkt CLI plus CodeRabbit.
---

# ship-it

Push branch. Open draft PR. Attach reviewers. Wait on CI plus AI reviewer. Fix until green.

`SKILL_DIR` is the directory containing this file. All paths in the skill are relative to it.

## Pipeline (3 stages)

| # | Stage | Reference | Purpose |
|---|-------|-----------|---------|
| 1 | PUSH | `references/push.md` | Push current branch with the right upstream and refspec |
| 2 | CREATE | `references/create.md` | Detect existing PR or create a draft one. Humanize the body. Attach default reviewers |
| 3 | FEEDBACK | `references/feedback.md` | Wait on CI plus the AI code reviewer. Fix, push, re-verify until green |

There is no ticket dependency. The skill works on any branch with at least one commit ahead of the destination branch.

## Invocation

```
/ship-it                         # Full pipeline on the current branch
/ship-it push                    # Just push
/ship-it create                  # Push if needed, then create or update PR
/ship-it feedback                # Detect PR for current branch, run CI plus review loop
/ship-it --body <path>           # Use a pre-written PR body file
/ship-it --target <branch>       # Override destination branch (default from config or "dev")
/ship-it --ready                 # Open as ready for review instead of draft
```

### Argument parsing

1. **No arguments** -> full pipeline (push, create or update, feedback).
2. **Stage name** (`push`, `create`, `feedback`) -> run only that stage.
3. **Flags**:
   - `--body <path>`: path to a markdown file whose contents become the PR description. If omitted, the skill drafts one from `git log` and `git diff --stat` against the destination branch.
   - `--target <branch>`: destination branch. Falls back to `vcs.default_target` in config, then to `dev`.
   - `--ready` / `--draft`: toggle PR draft state at creation. Default is `--draft`.
   - `--reviewers <uuids>`: comma-separated list of Bitbucket UUIDs. Falls back to default reviewers minus the author.

## Pre-flight: config check

On every invocation, before anything else:

```bash
python3 SKILL_DIR/scripts/load-config.py SKILL_DIR
```

The loader merges user config (`SKILL_DIR/config.toml`) and project config (`.ship-it.toml` in repo root) into a single JSON namespace (`vcs.*`, `reviewers.*`, `reviewer_bot.*`).

- Exit 0: continue.
- Exit 1: a required key is missing. The loader prints which key and which file. Read `references/preflight.md` for setup, then re-run.

Required keys: `vcs.workspace`, `vcs.repo_slug`, `reviewers.user_account_id`. Optional: `vcs.default_target` (default `dev`), `vcs.cli` (default `bkt`, only `bkt` recognized in v0.1), `reviewer_bot.name` (default `coderabbit`, only `coderabbit` recognized in v0.1).

## Stack and adapters

v0.1 hardcodes Bitbucket Cloud plus `bkt` plus CodeRabbit. The config keys `vcs.cli` and `reviewer_bot.name` exist so future adapters (`gh` for GitHub, Sourcery or Greptile for review) drop in without breaking config files. Right now any value other than the defaults exits 1.

If you are on a different stack, the inline cookbook in `references/create.md` and `references/feedback.md` documents what each step does and why, so you can adapt by hand.

## Blocker policy

Stop and surface immediately, do not silently proceed or fall back to a simpler approach, when:

- `bkt` returns an error, empty result where data was expected, or auth failure.
- Push is rejected by the remote (auth, branch protection, non-fast-forward).
- The PR-target sanity check shows a much larger diff than expected.
- CI or CodeRabbit Monitor times out.
- Three fix retry cycles have not turned CI green.

Use `AskUserQuestion` with the exact tool, error, and resource. Do not paraphrase the failure.

## Body humanization gate (MUST)

Before any POST or PUT to Bitbucket that includes a PR body, the body file must contain zero AI-writing tells. The gate, the grep, and the preferred-skill handoff all live in `references/create.md` Step 2.3.

## Loose dependency on humanize-style skills

If a skill whose description mentions rewriting AI-writing tells, em-dashes, AI vocabulary, or "humanize"-style cleanup is available (for example `humanize:humanize`), invoke it on the body file before submitting. If no such skill is installed, fall back to the manual scrub in `references/create.md`. Either path satisfies the gate. ship-it does not hard-depend on humanize.

## State

ship-it is stateless. Every invocation derives state from the working tree plus `bkt pr list`. There is no `.ship-it.json`. Resume across `/clear` works because the next run re-detects the PR for the current branch.

If a parent skill (jira-workflow or similar) needs to capture `pr_id` and `pr_url`, ship-it prints both as the last lines of the CREATE stage:

```
PR_ID=<id>
PR_URL=<url>
```

Parent skills grep stdout for these.

## Completion

After FEEDBACK shows both CI and the reviewer green, print a one-block summary:

```
Branch: <branch>
PR:     <url>
Status: <draft|ready>, CI passed, review clean
Commits: <count>
```

Done.
