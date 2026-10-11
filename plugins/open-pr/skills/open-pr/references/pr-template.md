# PR template

```markdown
<Opening, no heading. Two or three sentences: what changes, and why now (the review, decision, bug or run that asked for it). If a reader would expect something this PR does not do, say it here.>

<One line, only when someone must act: who, and what you need from them (a decision, a look at one file, a merge order, a rebase warning).>

## What changes

- <One bullet per thing a reader would notice: a command, a behavior, a folder, a rule. Not one bullet per file.>

## Open questions

- <Only what blocks the merge or the next step, and who decides. Point to the doc that holds the rest.>

## Tested

<The command a reviewer can run again, with its result in one line. Then any real run, in plain words: what ran, where, and what happened.>

<details>
<summary><What is inside, in one line></summary>

<Long tables, logs, path maps.>

</details>
```

Leave out a section that would be empty. A small fix gets the opening and "Tested", nothing more.

## Size

- Size the body to the change. Aim for 150 to 250 words of prose, 300 at most. Code, tables, `<details>` and bot sections do not count. [checked]
- Opening: 60 words at most. Bullets: 6 per section at most, one idea each, one level of nesting. [warned]

## Rules

1. The title is the summary. No "Summary" heading and no bold summary line. [checked]
2. Start with prose, not a heading. [checked]
3. The ask goes near the top, never in a closing "Notes" section, where nobody acts on it. [warned]
4. Bullets describe behavior, not files. [checked: a section fails when half its bullets are "`path`: text"]
5. Point to the README or doc instead of copying it. A detail that a reader needs for one line of code goes in a code comment.
6. No labels in bold, no em or en dashes, no curly quotes or arrows, no semicolons in prose, and no lines wrapped by hand. [checked]
7. No local paths (`/Users/...`, `/home/...`, `~/...`, temp folders) and no attribution footer. [checked]
8. Backticked repo paths exist at HEAD or in the diff. [warned]
9. "I" for your own work, "we" for team decisions. Name a person in plain words, never as an `@handle`: the team hears about a PR through other channels, so a GitHub ping does no work. [checked: an @mention fails]
10. Test counts add nothing: "`<check command>` passes" is enough.

## Variants

- **Experiment or measurement.** The opening gives the result in one sentence, with the number. "What changes" becomes "Result": a small table that includes n. "Tested" becomes "How it ran": command, commit, date, model or settings, n. Add "Limits": what the result does not show.
- **Design change.** Add "Why" after the ask line: before and after, 80 words at most. Link the design doc instead of pasting it. Optional "Decisions": at most 3, one sentence each, only where a reviewer would ask "why not X?".
