---
name: pre-goal
description: Interrogates a rough objective into a tight, verifiable `/goal` completion condition before the user hands it to the native /goal autonomous loop. Grills to pin down what the goal actually is, then emits a short paste-ready `/goal` line. Use when the user says "pre-goal", "sharpen this goal", "turn this into a goal", "write a /goal for X", "what should my goal be", "help me set a goal", or hands you a loose objective destined for the /goal loop. Run it whenever a goal is vague, compound, or has no obvious done-signal — a bad goal sends an hours-long, token-heavy loop down the wrong path.
argument-hint: "<the rough goal / objective>"
allowed-tools:
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git branch *)
  - Bash(grep *)
  - Bash(ls *)
  - Bash(find *)
---

# Pre-Goal

`/goal` runs an autonomous loop: after each turn a fast evaluator checks the completion condition and re-fires if unmet. It can run for hours and burn a lot of tokens. The leverage is almost entirely in the goal: a sharp one finishes; a vague or wrong one chases the wrong target for hours before anyone notices. **The job of this skill is to get the goal right before that spend starts.** The output is a short `/goal` line — but the value is the interrogation that produces it.

## Two facts about the evaluator that shape everything

1. **It only sees what Claude surfaces in the conversation.** It does not run commands or read files itself. So the proof of "done" must be something Claude *prints* each turn — a pasted test summary, a command's exit status, a count. "The code is correct" is unverifiable; "`pytest tests/x` output shows 0 failures, pasted" is.
2. **It optimizes the literal condition (Goodhart).** A long loop will find the cheap path to satisfy the words. If "tests pass" is the bar, deleting a failing test passes it. The condition must fence off the cheat.

## Method: grill first, emit last

Pin the goal by interrogation, grilling-style — **one question at a time, each with your recommended answer**, so a confident user just says "yes, yes, go." Explore the codebase to answer your own questions instead of asking (find the test command, the entry file, the call sites). Stop grilling the moment these five are nailed; don't pad.

Ground first (silent, no recap):

```bash
git status --short && git branch --show-current
```

The five things to pin:

1. **The real WHAT.** Is the stated goal the actual goal, or a proxy for it? "Make the parser robust" — robust against what, measured how? Narrow until there's one end-state, not a vibe. This is the highest-value question; most wasted loops die here.
2. **The proof.** What observable signal, surfaced by Claude each turn, demonstrates the end-state? Prefer a command's output (`exits 0`, a count, an empty grep) over prose. Name the exact command.
3. **The fence.** What may change, and what must *not*. Autonomous turns wander into adjacent code; bound them.
4. **The forbidden cheat.** Given the proof, what's the cheapest way to satisfy the words without doing the work (delete the test, stub the function, hardcode the output)? Forbid it explicitly.
5. **The cap.** A turn ceiling so a stuck loop stops burning. Default: suggest one (`stop after N turns`).

If the objective is genuinely compound ("migrate, add OAuth, write docs"), **don't fuse it** — the evaluator checks one condition and stalls on the slowest sub-part. Recommend splitting into sequential `/goal` runs and sharpen the first.

## Output

One tight block. The condition is one to three sentences: end-state, then proof, then fence + cap. Not a paragraph.

```
**Goal** — paste and send:
```text
/goal [end-state]. Done when [the check Claude surfaces each turn]. Don't [the forbidden cheat]; touch only [scope]. Stop after [N] turns.
```
```

No rubric recap, no "why this is better" essay. If grilling is unresolved, ask the next single question instead of emitting.

## Examples

Raw: *"fix the parser, it breaks on nested quotes"* → after pinning proof + cheat:

```text
/goal The tokenizer parses nested quotes correctly. Done when you paste `pytest tests/test_tokenizer.py` output showing 0 failures, including a new test for input `"a \"b\" c"`. Don't weaken or delete existing assertions; touch only src/tokenizer.py and its test. Stop after 15 turns.
```

Raw: *"clean up the forms module"* → too vague, grill the WHAT first (one question):

```
Before I write this, "clean up" is too open for a multi-hour loop — it'll wander. What's the actual end-state? My guess: every file in src/forms/ off the deprecated `legacy_client` and onto `ApiClient`, with typecheck clean. Is that it, or did you mean something narrower (dead-code removal, formatting, splitting a big file)?
```

Raw: *"migrate everything and add the new export feature"* → compound, refuse to fuse:

```
That's two goals — the evaluator checks one condition and would stall on whichever half lags. Run them sequentially. First: [sharpened migration goal]. I'll sharpen the export goal once the migration loop closes.
```

## Notes

- This skill **outputs** a `/goal` line; it doesn't run `/goal` (native, user-driven). User pastes it.
- Bias every proof toward a command output over prose — `exits 0` is unambiguous, "works" is not.
- Short goal beats complete goal. The fewer words the loop can game, the better.
