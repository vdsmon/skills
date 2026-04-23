---
name: skill-polish
description: >-
  Post-mortem for any skill. Scans the current conversation for friction
  (corrections, skipped steps, rejected tool calls, validated surprises),
  traces each signal to the responsible skill file, and applies concrete
  edits so the same friction doesn't recur. Works on any installed skill,
  not just its own.
when_to_use: >-
  Use when the user says "skill-polish", "polish the skill", "improve
  the skill", "that should have been automatic", "you skipped X", "close
  the gaps", "why did you not use the skill here", or signals that a
  skill's flow felt rough this session. Invoked proactively after a
  noticeably clumsy run of any skill to lock in a fix.
disable-model-invocation: true
allowed-tools:
  - Read
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Skill Polish

Just watched skill execute this conversation. Something not smooth. Job: find what wrong, trace to skill's instructions, fix instructions so not happen again. ultrathink when scanning — the friction signals are often subtle and buried across many turns.

Not about code written — about *skill itself*. Skill's reference files, SKILL.md, workflow descriptions. Improve tool, not output.

## Why this matters

Skills invoked thousands of times. Small friction — vague instruction misinterpreted, missing mandatory step, "should" that needed "must" — compounds across every future invocation. Fix skill file = high-leverage: one edit prevents same mistake every future conversation.

## How to find friction

Scan conversation history for these signals, ordered most obvious to most subtle:

1. **User corrections** — "why did you skip X", "no, do Y first", "that should have been automatic". Direct instructions skill failed to encode.

2. **Rejected tool calls** — User blocked tool use and gave guidance. Skill's instructions led to action user not want.

3. **Manual interventions** — User had to step in and do something skill should have handled. Look for moments user gave commands or info skill should have produced on own.

4. **Wrong sequence** — Steps wrong order, or step skipped that should have run. Skill's flow control ambiguous.

5. **Wasted work** — Agent did something unnecessary, then backtracked. Skill's instructions sent down dead end.

6. **Validated surprises** — Agent did unexpected thing user *liked*. ("that's brilliant, add that to the skill"). Techniques worth codifying.

Each signal, note:
- What happened (friction)
- What should have happened (desired behavior)
- Which skill file responsible (trace it)

## How to trace friction to skill files

1. **Identify the skill** — Which skill active when friction occurred? Check `SKILL.md` frontmatter for skill name, look at which reference files read during conversation.

2. **Find the responsible file** — Read skill's directory structure. Match friction to stage/step/section governing agent's behavior that moment. Common locations:
   - `SKILL.md` — main workflow, stage summaries, pipeline flow
   - `references/<stage>.md` — detailed stage instructions
   - Frontmatter `description` — triggering issues

3. **Read the current text** — Always re-read file with `Read` tool before proposing edits. Skill files may have changed since loaded earlier (by user, another session, or prior `/skill-polish` run this conversation). Never rely on memory — file on disk is source of truth. Read exact passage that led to incorrect behavior. Understand *why* agent misinterpreted. Common root causes:
   - **Too vague** — "check the project docs" instead of "run /test-form"
   - **Too soft** — "auto-advance" when needed "immediately continue, no pause"
   - **Missing entirely** — Desired behavior not mentioned at all
   - **Wrong default** — Fallback behavior wrong for this case
   - **Buried** — Instruction existed but lost in wall of text

## How to fix

Each friction point, produce concrete edit — not suggestion, actual change to file. Follow these principles:

- **Scripts over instructions.** Everything COULD be script SHOULD be script. If skill describes deterministic sequence (check X, then run Y, then verify Z), sequence belongs in shell script or mise task — not prose agent interprets at runtime. Scripts reproducible, testable, eliminate entire class of agent misinterpretation. Find inline command sequences in skill, propose extracting into scripts and have skill reference script instead. Single highest-leverage improvement.
- **Be specific over general.** "Run `/test-form` for form task types" beats "consider running task-type-specific tests."
- **Explain the why.** Don't just add rule — explain why matters. Agent reading skill is smart; understand reasoning = handle edge cases rule doesn't cover.
- **Match the weight to the risk.** Skipped step that silently produces wrong output = bold formatting + explicit "do NOT skip" language. Minor sequence preference = gentle note.
- **Don't over-correct.** Skill worked 90% and failed on one edge case = add handling for edge case. Don't rewrite whole section.
- **Codify validated techniques.** Agent improvised something good = write into skill with enough detail for future agents to reproduce.

## Workflow

### Step 1: Identify the skill(s) used

List which skills invoked this conversation. If user specified one, focus that. Otherwise, identify primary skill with friction.

### Step 2: Gather friction signals

Scan conversation systematically. Present findings as numbered list:

```
1. SKIPPED STEP — Form testing was skipped, went straight to commit
   Should have: Run /test-form or fake-data Spark test
   Responsible: references/testing.md, Step 4.2

2. PREMATURE STOP — Stopped after PR instead of auto-advancing to feedback
   Should have: Immediately continued to Stage 9
   Responsible: references/pr.md "Next" section + SKILL.md Stage 8 summary

3. VALIDATED TECHNIQUE — Fake-data Spark test was improvised and worked well
   Should be: Documented as a named technique in references/testing.md
```

### Step 3: Propose edits

Each friction signal, show:
- File path
- Current text (quoted)
- Proposed replacement
- Why this fixes issue

Present all edits together for review. Don't apply yet.

### Step 4: Apply with approval

Use `AskUserQuestion` to present picker with these options:
- **"Apply all"** — apply every proposed edit
- **"Apply selected"** — let user specify which numbered edits to apply (follow up asking which)
- **"Skip"** — don't apply, note for later

After applying, also save relevant learnings as feedback memories if contain insights that generalize beyond specific skill.

### Step 5: Summary

Show what changed, which files modified, one-line note on how this improves future runs.