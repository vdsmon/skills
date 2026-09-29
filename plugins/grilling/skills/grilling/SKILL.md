---
name: grilling
argument-hint: "[plan, decision, or idea to stress-test]"
description: Grill the user relentlessly about a plan, decision, or idea. Use to stress-test thinking before acting on it, or on any 'grill' trigger phrase.
---

Interview the user relentlessly until you reach a shared understanding. Map the subject as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round. If the user asks for one question at a time, make every round a single question.

Format a round like so:

```
**Q1. <question title>**: <question body, possibly several paragraphs or a list of choices>

Recommended: <your recommended answer>

---

**Q2. <question title>**: <question body>

Recommended: <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (files, tools, docs), look it up, or dispatch a sub-agent for a longer search; never ask the user for anything you could find yourself. Don't block the round on it: a running lookup is an unsettled prerequisite, so only the questions downstream of it wait; ask the rest of the frontier now. The _decisions_ are the user's: put each one to them and wait for their answer.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
