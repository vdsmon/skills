# cc-crew wording test

Does the way a brief is written change whether a builder catches a wrong sentence in it? Two briefs ask for the same ten steps, word for word. Step 4 is flawed: it gives the tracker's judge no way to see what changed, so it would report old news again on every later change. The flaw is real; it was in the brief sent on 2026-11-12, and the builder that day built it as written.

- `tracker-brief-cold.md`: the brief as it was sent. Orders and prohibitions.
- `tracker-brief-team.md`: the same work in the crew's brief shape. What the work is for, limits with their reasons, and the section every brief carries, which says what to do when the plan is wrong.
- `score-prompt.md`: what the scorer is told.

## Running it

1. Start one builder per run: Opus at medium effort, in an isolated worktree of this repository. Its whole first message names the brief file and a branch name. Both briefs start from commit `7a3883e`, the plugin before trackers existed.
2. For each run, save the report it hands back as `report.md`, and `git diff 7a3883e <branch> -- plugins/cc-quiet-watch/hooks/register.ts plugins/cc-quiet-watch/types/index.d.ts` as `diff.patch`.
3. Put each pair in a folder named `run-A`, `run-B` and so on, in shuffled order, and keep the key elsewhere.
4. Give a reviewer that folder and `score-prompt.md`, read-only. The author of the briefs does not score them.
5. Check that no run read the commits after `7a3883e`, where the real fix lives.

## First round, 2026-11-12

Six runs, scored by GPT-6 Astra without the key. None read the later commits.

| Brief | Caught the flaw | How |
| --- | --- | --- |
| Team | 3 of 3 | All three fixed it in the code and reported it first |
| Cold | 1 of 3 | Reported it and left the code as briefed; the other two missed it |

A fourth cold run, the real one that morning, missed it too. All six filled the brief's silent gaps and listed them, and none stopped to ask. The team runs also did more than asked (two fixed a timer bug in shared code), each reported first.

What this does not show: which ingredient did it. The briefs differ in tone and in saying outright what to do when the plan is wrong. Three runs per brief on one task is a small sample; a difference this large shows at that size, a subtle one would not.

## The ladder and the page

`ladder/` holds what measured cc-crew 0.12.0 (rows 62 to 65 of `docs/experiments.md`). Each script takes the plugin's folder and spends tokens.

- `preapproval-quoted.sh`, `preapproval-second-turn.sh`, `preapproval-after-wake.sh`: short Haiku sessions with user settings off. They show how far the role's `allowed-tools` reach: both quotings of a script's path, a second message, and not past a wake by a background task.
- `trial.sh <plugin-dir> <result-dir>`: one Fable session, about half an hour, that takes a settled design to a plan file and a page. Read the plan file it leaves for its ladder and its "Done when" lines, and its folder for `page.html`.
- `sequence.py <out.jsonl>`: the order of a print-mode session's tool calls, each allowed or denied, with the system events between them.

Run the three short ones again after an upgrade of Claude Code: what they measure is the harness, not the crew's text.

## The advisor rule

`advisor-rule.sh [plugin-dir] [runs]` checks that the role text still keeps the chief engineer from calling the advisor (DEC33). Each run is one short Fable session with the advisor on, given a one-line fix; the script prints the advisor calls of each run, and of one control run on a copy of the plugin with the rule's line removed. Every run should print 0 and the control should not: a control at 0 means the advisor was not there to call, and the script says the result is void. Run it after any reword of that line or of the role text around it; the first measurement is row 51 of `docs/experiments.md`.
