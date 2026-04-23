---
name: converge
description: Run a prompt or slash command in a loop until changes converge (no new edits) or start churning (same files flip-flopping). Use when user says "converge", "run until stable", "keep running until done", "repeat until clean", or passes a skill/prompt to apply iteratively. Also triggers on "run /simplify until it stops finding things" or "keep improving until there's nothing left".
---

# converge

Run a prompt or slash command in a loop. Stop when codebase stable. Prevents under-iteration (stopping too early) and over-iteration (churning).

## Usage

```
/converge <prompt or /skill>
```

Examples:
- `/converge /simplify`
- `/converge /claude-md-improver`
- `/converge "review and fix type errors"`
- `/converge "run biome check --write and fix any remaining issues"`

## Stop conditions

| Condition | Report |
|---|---|
| No files changed this pass | `Converged` |
| ≥50% file overlap with a previous pass | `Churning detected` |
| Max passes reached (10) | `Max passes reached` |
| Prompt/skill reports "no issues found" | `Converged` |

## Loop

Before starting:

1. Parse user input for the prompt/skill to repeat.
2. Print: `Starting convergence loop: "<prompt>"`.

**Critical: each pass runs in a fresh `general-purpose` Agent subagent via the Agent tool.** Fresh context per iteration = impartial review, no self-bias from prior edits. Parent handles snapshot + diff + decide. Subagent handles execution only.

Per pass N:

1. `git diff --stat` → save as `before_files`.
2. Spawn a new `general-purpose` Agent. Pass the prompt:
   - **Slash-command input** (e.g. `/humanize`, `/simplify`) → instruct subagent to invoke via the Skill tool. Do NOT paraphrase or inline the skill's instructions — sub won't see the skill's reference files otherwise.
   - **Freeform input** → pass text directly.
   - Always include target file paths.
   - Every pass = new Agent call. Never SendMessage to a prior one.
3. `git diff --stat` → save as `after_files`. Compute `changed_this_pass` = files new in `after_files`, OR files whose diff content changed.
4. Print: `Pass N: X file(s) changed — file1, file2, ...`.
5. Decide:
   - `changed_this_pass` empty → **STOP** (`Converged`).
   - `changed_this_pass` overlaps ≥50% with any prior pass's set → **STOP** (`Churning on: ...`). Revert the churning files via `git checkout -- <files>` so working tree stays at last stable state.
   - N ≥ 10 → **STOP** (`Max passes reached`).
   - Else record `changed_this_pass`, continue.

## Final summary

```
## Convergence Summary

Passes: N
Reason: Converged | Churning detected | Max passes reached
Files modified across all passes: file1, file2, ...
Churning files (if any): file3 (passes 1, 3)
```

## Edge cases

- **Pass 1 no changes** — Report `Converged after 1 pass`, stop.
- **Prompt errors** — Don't retry. Stop, report error. User fixes + re-runs.
- **Mixed churning** — Revert only the churning files. Report both sets.
- **Pre-existing uncommitted changes** — Fine. Snapshot captures per-pass state; pre-existing diff is baseline.
