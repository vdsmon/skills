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

## The advisor rule

`advisor-rule.sh [plugin-dir] [runs]` checks that the role text still keeps the chief engineer from calling the advisor (DEC33). Each run is one short Fable session with the advisor on, given a one-line fix; the script prints the advisor calls of each run. Every run should print 0. Run it after any reword of that line or of the role text around it; the first measurement is row 51 of `docs/experiments.md`.
