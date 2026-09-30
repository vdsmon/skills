---
name: start-work
argument-hint: "[repo] [what the job is]"
description: Starts a job in its own git worktree, based on a fresh fetch of the remote, then enters it and runs the repo's setup. The main checkout is never switched.
when_to_use: >-
  Use when the user asks to start a new piece of work in a worktree, or to start
  work on something in a named repo ("start work on X in <repo>", "spin up a
  worktree for this", "new worktree for this job", "set up an experiment at
  commit abc123"). Also when project instructions say each job gets its own
  worktree. Not for switching branches in place, or for cleaning worktrees up.
---

# start-work

One job, one worktree. The main checkout keeps whatever it has open, the new work starts from what is on the remote now (not from a stale local branch), and ignored files the job needs, such as `.env`, come along.

## 1. Pick the repo and the name

- The repo: the one the user named, or the current one. If the session sits in a folder that holds several repos and the request does not say which, ask once.
- A new job gets a new branch. Follow the repo's branch names (`git -C <repo> branch -r --sort=-committerdate | head`), for example `feat/<slug>` or `fix/<slug>`, with a slug of two or three words.
- To continue a branch that exists locally or on origin, use its name as is.
- An experiment at a fixed commit gets a detached worktree and a name such as `exp-<slug>`.

## 2. Make the worktree

The script lives at `scripts/start_work.sh` under this skill's base directory:

```bash
bash "<skill-base-dir>/scripts/start_work.sh" <repo> <branch>
bash "<skill-base-dir>/scripts/start_work.sh" <repo> --detach <commit> <name>
```

It fetches origin, puts the worktree in `<repo>/.claude/worktrees/<name>`, bases a new branch on origin's default branch, and copies ignored files that match `.worktreeinclude`. If nothing ignores `.claude/worktrees/`, it adds that line to `.git/info/exclude`, which stays on this machine. Pass its `WARN` and `note` lines on to the user.

If the repo has ignored files the job needs (an `.env`, local config) and no `.worktreeinclude`, say which files were not copied. Do not copy secrets on your own.

## 3. Enter it

- In Claude Code, call `EnterWorktree` with the `path` the script printed. This works from a parent folder that holds several repos. From then on, run git as plain single commands inside the worktree. For work in another repo, call `ExitWorktree` with `keep` first.
- In other hosts, work in that path, or tell the user to open a session there.

## 4. Set it up

Run the setup the repo documents in `AGENTS.md`, `CLAUDE.md` or the README (for example `mise run sync`, `uv sync`, `npm ci`). If the repo documents a check command and it is quick, run it once, so a later failure is known to be new. Report one line: branch, path, base commit, and the check result.

## While the job runs

- Stay inside the job's scope. Note other things you find, do not fix them here.
- Commit in the repo's style, with the why in the body.
- Do not push until the user asks. Publishing is a separate step (the `open-pr` skill, if installed).

## Not this skill's job

Pushing, pull requests, and removing worktrees when the job is done (`git-cleanup`).
