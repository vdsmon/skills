---
name: systematic-debugging
argument-hint: "[bug or failure to debug]"
description: Use for a reproducible bug, test failure, or unexpected behavior in code you can run and inspect, before proposing fixes. For an incident in systems you cannot run, use flow's investigate instead.
---

# Systematic Debugging

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes. This holds most of all when the issue seems simple, when you are under time pressure, and when earlier fixes failed: that is when guessing is most tempting.

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read error messages carefully.** Don't skip past errors or warnings; they often contain the exact solution. Read stack traces completely. Note line numbers, file paths, error codes.
2. **Reproduce consistently.** Can you trigger it reliably? What are the exact steps? Does it happen every time? If not reproducible -> gather more data, don't guess.
3. **Check recent changes.** What changed that could cause this? Git diff, recent commits, new dependencies, config changes, environmental differences.
4. **Gather evidence in multi-component systems.** WHEN the system has multiple components (CI -> build -> signing, API -> service -> database), add diagnostic instrumentation BEFORE proposing fixes. At each component boundary, log what data enters and exits, and check that environment and config propagate. Run once to see WHERE it breaks, then investigate that component. Example for a signing failure:
   ```bash
   echo "workflow: IDENTITY ${IDENTITY:+SET}${IDENTITY:-UNSET}"  # layer 1: CI workflow
   env | grep IDENTITY || echo "build: IDENTITY not in env"     # layer 2: build script
   security find-identity -v                                     # layer 3: signing keychain
   codesign --sign "$IDENTITY" --verbose=4 "$APP"                # layer 4: the failing step
   ```
   This shows which layer fails (secrets -> workflow OK, workflow -> build FAILS).
5. **Trace data flow.** WHEN the error is deep in the call stack: where does the bad value originate? What called this with the bad value? Keep tracing up until you find the source, and fix at the source, not at the symptom. Full technique: `root-cause-tracing.md`.

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find working examples.** Locate similar working code in the same codebase.
2. **Compare against references.** If implementing a pattern, read the reference implementation COMPLETELY. Don't skim; read every line.
3. **Identify differences.** List every difference between working and broken, however small. Don't assume "that can't matter".
4. **Understand dependencies.** What other components, settings, config, and environment does this need? What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Form a single hypothesis.** State it clearly and write it down: "I think X is the root cause because Y". Be specific, not vague.
2. **Test minimally.** Make the SMALLEST possible change to test the hypothesis. One variable at a time.
3. **Verify before continuing.** Did it work? Yes -> Phase 4. No -> form a NEW hypothesis. DON'T add more fixes on top.
4. **When you don't know,** say "I don't understand X". Don't pretend to know. Ask for help or research more.

### Phase 4: Implementation

**Fix the root cause, not the symptom:**

1. **Create a failing test case.** Simplest possible reproduction: an automated test if a framework exists, a one-off test script if not. You MUST have it before fixing. Run it and watch it fail.
2. **Implement a single fix.** Address the root cause identified. ONE change at a time. No "while I'm here" improvements, no bundled refactoring.
3. **Verify the fix.** Test passes now? No other tests broken? Issue actually resolved? Run the checks fresh and read their output before claiming success.
4. **If the fix doesn't work,** STOP and count how many fixes you have tried. Fewer than 3: return to Phase 1 and re-analyze with the new information. 3 or more: go to step 5. DON'T attempt fix #4 without an architectural discussion.
5. **If 3+ fixes failed, question the architecture.** Signs of an architectural problem: each fix reveals new shared state, coupling, or a problem in a different place; fixes require "massive refactoring"; each fix creates new symptoms elsewhere. Ask: is this pattern fundamentally sound? Are we sticking with it through sheer inertia? Should we refactor the architecture instead of fixing symptoms? **Discuss with your human partner before attempting more fixes.** This is NOT a failed hypothesis; this is a wrong architecture.

## Red Flags: STOP and Return to Phase 1

| If you catch yourself thinking | Reality |
|--------|---------|
| "Quick fix for now, investigate later" / "Just try this first" | The first fix sets the pattern. Do it right from the start. |
| "Just try changing X and see if it works" | That is guessing. Form one hypothesis and test it minimally. |
| "Add multiple changes, run tests" | You can't isolate what worked, and you cause new bugs. |
| "Skip the test, I'll manually verify" / "I'll write the test after the fix works" | Untested fixes don't stick. The failing test comes first. |
| "It's probably X, let me fix that" / "I see the problem, let me fix it" | Seeing symptoms is not understanding the root cause. |
| "I don't fully understand but this might work" | Say what you don't understand. Research or ask. |
| "Pattern says X but I'll adapt it" / "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "Issue is simple, don't need process" | Simple issues have root causes too. The process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is faster than guess-and-check thrashing. |
| "Here are the main problems: [fixes, before any tracing]" | Proposing solutions before tracing data flow skips Phase 1. |
| "One more fix attempt" (after 2+ failures), or each fix reveals a new problem elsewhere | 3+ failures means a wrong architecture. Go to Phase 4, step 5. |

**Your human partner's signals that you're doing it wrong:** "Is that not happening?" (you assumed without verifying), "Will it show us...?" (you should have gathered evidence), "Stop guessing" (you're proposing fixes without understanding), "Ultra-think this" (question fundamentals, not just symptoms), "We're stuck?" (your approach isn't working). When you see these: STOP. Return to Phase 1.

## When the Process Reveals "No Root Cause"

If systematic investigation shows the issue is truly environmental, timing-dependent, or external, you have completed the process. Document what you investigated, implement appropriate handling (retry, timeout, error message), and add monitoring or logging for future investigation. **But:** most "no root cause" cases are incomplete investigation.

## Supporting Techniques

These live in this skill's directory:

- **`root-cause-tracing.md`:** trace bugs backward through the call stack to the original trigger, and find which test pollutes shared state (`find-polluter.sh`)
- **`defense-in-depth.md`:** add validation at multiple layers after finding the root cause
- **`condition-based-waiting.md`:** replace arbitrary timeouts with condition polling
