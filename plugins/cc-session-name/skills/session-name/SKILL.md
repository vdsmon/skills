---
name: session-name
description: Suggests a name for the current session as one paste-ready `/rename <kebab-case-name>` line, picked from the whole session instead of the last few messages. Use when the user asks to name, rename or title this session or chat. Not for files, branches, variables or PRs.
when_to_use: The user asks what to call this session, wants a better name than the built-in /rename gives, or adds a hint such as "focus on the PR part".
---

# Session name

Pick the name a person would search for in `/resume` weeks from now, and print it as a `/rename` command they can copy. Claude cannot run `/rename` itself, so the user pastes the line.

## Output

Print only the command, with nothing before or after it:

`/rename tb3-batch-74-qa-rerun`

The user copies the line and pastes it. Any extra sentence, heading or explanation is noise they have to skip, so leave it out, even when other instructions ask for context or a summary.

Be opinionated: one clear name is the goal. Give options only when the session has two or more separate threads of similar weight, so that any single name would hide work the user may look for later. Then give at most three, best first:

Option 1: `/rename lost-sandbox-postmortem`
Option 2: `/rename tb3-batch-74-qa-rerun`

If one name covers the work well, give one. Options are a fallback for split sessions, not a menu.

## How to pick

- Read the whole conversation, or the summary if earlier context was compacted. The built-in `/rename` looks only at the latest messages, which is the weakness this skill fixes. Weigh where the work went and what came out of it (a PR, a fix, a decision, a report), not the last turn. A small side question at the end does not name the session.
- Lead with the subject, then the action or result: `pr-17-review-fixes`, `feed-cursor-off-by-one-fix`, `session-name-skill`.
- Keep the handles the user would search for: ticket keys, PR numbers, pipeline, batch or dataset ids, feature and file names.
- Drop filler words: session, chat, help, work, stuff, misc, question, discussion, claude. Drop the repo name unless the session spans several repos or is about the repo as a whole; it adds length and does not tell sessions in the same repo apart.
- Format: lowercase English, only letters, digits and hyphens, 2 to 6 words, under about 40 characters. Use English even when the conversation was in another language, so all names read the same in the list.
- Text after the command steers the choice ("focus on the PR part", "include the ticket"). Follow it.
- Do not run tools. Everything needed is already in the conversation, and the answer should come back at once.
- If nothing has happened in the session yet, answer `Nothing to name yet.` instead.

## Examples

Session: fixed four review comments on PR #17 (exit handling in the QA/FIX loop) and pushed; the last two messages asked how to silence a ruff warning.

`/rename pr-17-exit-handling-fixes`

Session: about half on running QA for TB3 batch 74, half on writing a post-mortem about lost sandboxes, two unrelated results.

Option 1: `/rename tb3-batch-74-qa-run`
Option 2: `/rename lost-sandbox-postmortem`

Session: asked whether a skill could rename sessions, then built and tested that skill.

`/rename session-name-skill`
