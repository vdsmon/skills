---
name: open-pr
argument-hint: "[PR number to rewrite]"
description: Writes a short, plain pull request description, checks it with a script, shows it to the user, and only after a yes pushes and opens or updates the PR with gh.
when_to_use: >-
  Use when the user asks to open, create, raise or draft a pull request, says a
  branch is ready for review, or asks to write, rewrite, shorten or fix a PR
  description ("open a PR for this", "update the PR body", "this PR reads like
  AI"). Not for reviewing someone else's PR, replying to review comments, or
  merging.
---

# open-pr

A PR description has one reader: a teammate with a minute to spare. They want to know what changes, why now, and what they must do. The diff, the Files tab and any review bot already list the files, so the body does not repeat them. Many readers are not native English speakers, so the body is short and plain.

## 1. Check the branch

1. Stop on the default branch or a shared one (`main`, `master`, `dev`, `develop`). A PR needs its own branch.
2. Find the base: the existing PR's base (`gh pr view --json baseRefName`), else the remote's default branch. Run `git fetch`, then read `git log --oneline <base>..HEAD` and `git diff --stat <base>...HEAD`.
3. Find the repo's check command in `AGENTS.md` or `CLAUDE.md`, else in `.github/workflows/`. Run it. If it fails, stop and report: a good description does not fix red code.
4. Updating a PR (a number was given, or the branch already has one): read the current body with `gh pr view <n> --json body`. A section between `<!-- NAME -->` and `<!-- /NAME -->` markers belongs to a bot, such as a review summary. Keep it byte for byte at the end of the new body.

## 2. Ask only what the diff cannot show

Most of the story is in the conversation and the commits. In one message, ask the user only for what is still missing: what asked for this change (a review, a decision, a bug, a run result), what stays open and who decides it, and whether someone needs a heads-up. Do not ask what you already know.

## 3. Write the title and the body

Read `references/pr-template.md` (under this skill's base directory) and follow it. Write the body to a temporary file, never inline in a shell command.

- Title: what changes, in plain words, 72 characters at most. Use a type prefix (`feat:`, `fix:`) only when the repo's recent PR titles do (`gh pr list --state merged --limit 10`).
- Compare with the base branch, never with your own earlier drafts or local history. Words like "no longer" or an internal version number only make sense to someone who saw the drafts.
- Use the repo's own words for things (grep the code and docs). A term you coined gets a short definition, or it goes.

## 4. Run the check

```bash
python3 "<skill-base-dir>/scripts/pr_body_check.py" <body-file> --base <base>
```

`<skill-base-dir>` is this skill's base directory. Run it from the repo. Fix every FAIL and run it again until it passes. Read each WARN and fix the ones that are right. A WARN can be wrong, for example a path that exists only at run time.

## 5. Read it cold

1. Reread the prose for AI tells: filler openers ("This PR introduces"), inflated words, lists of three, labels in bold, restating the diff. If the `humanize` skill is installed, use its pattern list as the checklist, but not its advice on voice (opinions, long chained sentences, asides). A PR body wants short sentences that a non-native reader gets on the first pass.
2. If you can start a subagent, give it only the title and the body, with no diff and no repo access, and ask: what changes, why, what must I do, what is unfinished, and which sentences did you read twice. Fix what it got wrong or found hard. Skip this for a body under about 100 words.
3. Run the check again after any edit.

## 6. Show it, then publish

Show the user the title and the body exactly as they will appear. List every `@mention` separately: a mention notifies that person as soon as the PR is visible, drafts included. Write names without `@` unless the user wants the ping.

Wait for a clear yes. That yes covers this push and this PR, nothing more.

- New PR: `git push -u origin <branch>`, then `gh pr create --draft --title "<title>" --body-file <file>`. Open it as a draft unless the user says otherwise.
- Existing PR: `gh pr edit <n> --body-file <file>`, plus `--title` if it changed. Push new commits only if the user asked for that too.

Report the PR URL in one line.

## Not this skill's job

- Review loops, CI polling, merging and auto-merge. Other tools do those.
- Attribution: no "Generated with" line, session link or AI footer, in the body or in commits.
