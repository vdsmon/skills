---
name: grilling
argument-hint: "[plan, decision, or idea to stress-test]"
description: Grills the user about a plan, decision or idea in rounds. Researches first, asks graded questions with a recommendation and its fact, tries to break each answer and keeps a record. Use to stress-test thinking before acting on it, or on any 'grill' trigger phrase.
when_to_use: Also when the user asks for grill-with-docs, or for a grilling that writes its words into a repo's glossary.
---

Interview the user until you both hold the same understanding. A grilling brings them questions they can decide, and tests their answers instead of only collecting them. It works on you as much as on them: a question you cannot answer for yourself, with the fact behind your answer, is not ready to be asked.

A full session, one first round and a close, is in [round-sample.md](round-sample.md). Follow its format exactly.

## The tree

Map the subject as a **design tree**: every decision branches into the decisions that hang off it. The roots come first: what the thing is for, the cases it must handle, the parts it has and how they link. Questions about files, steps and logistics wait until those are settled.

Work the tree in **rounds**. A round asks every question whose prerequisites are settled. A question that depends on one still open is **waiting**: it belongs to a later round. Each answered round reshapes the tree, so recompute it and ask the next round. If the user asks for one question at a time, every round is a single question.

A grilling is **small** when no question in its tree waits on another. A small grilling has no picture, no record and no reviewer; everything else here applies to it. It stays small when a question comes back after its answer broke. When the tree grows a question that waits on another, start the record there and go on in full.

## Before round one

1. **Research.** Finding facts is your job, never the user's. Read the code, the docs and the decisions already recorded, search the web where the subject reaches outside the repo, and send read-only agents side by side for a wide search. Size it to the subject. A question whose fact is still unchecked waits, like any question with an open prerequisite; never ask the user for something you could find.
2. **Example.** Choose one example for the whole session: a real case from the project when it has one, a made-up one otherwise, plus two or three hard cases to throw at answers later.
3. **Glossary.** When the repo has a glossary (`GLOSSARY.md`, or `CONTEXT.md` in an older repo; a `GLOSSARY-MAP.md` at the root lists one per context), read it. Its words count as agreed. When the user uses a word against it, say so at once: "your glossary defines cancellation as X, you seem to mean Y".
4. **Record**, unless the grilling is small. Run `python3 "${CLAUDE_SKILL_DIR}/scripts/record.py" start <name> "<what the subject is for>"`. It creates `~/.claude/plans/<name>/plan.md`, the one file this session writes into and the plan file later, and prints its path. Write into it the example, what you checked and could not check (under `## What I checked`) and the open questions. If the file cannot be written, say so and wait until the user allows it: a grilling that is not small does not go on without its record.
5. **Fresh read**, unless the grilling is small. Once the record holds the first tree and what you checked, start the crew's reviewer in the background and go on with round one: `"${CLAUDE_PLUGIN_ROOT}/scripts/review.sh" grilling <plan.md>`. Until the record proposes a principle, the script reads it against what the subject is for. Its last line names the answer file; read the file. Exit 3 means the reviewer is out of usage: the last line is then the folder the script prepared, and that folder goes to `cc-crew:reviewer-fallback`.

## A round

In this order:

1. **What I checked**, in round one and whenever you looked something up since: what you read and where, with the number or the line that matters, and what you could not check. The record holds the same lines under `## What I checked`, so the reviewer and a later session can tell a checked fact from an assumed one; add what you look up later.
2. **New words.** The user can only decide a question worded in terms they hold. A word they have not used or agreed to, whether it comes from the code, a teammate, a document or you, goes into a table first: the word, where it comes from, what it means, and alternatives when you picked the word yourself or it reads as tricky (your pick is the first column). The questions that need the word wait for the user's yes to it; word every other question in plain words. A round with no new word says `New words: none`. Never leave the line out.
3. **The picture**: the tree as a mermaid flowchart. Settled questions fold into one node, open ones show by number, waiting ones point from what they wait on. Under it, the count line that `record.py check` prints.
4. **The questions**, graded. **Sure** when the facts settle it, **leaning** when it is a judgement call with a clear favourite, **coin flip** when it turns on something only the user knows or prefers. Questions carried over from earlier rounds come first, in number order; new ones follow from most sure to least. Every recommendation shows the fact it rests on, and each question is worded so that "yes" accepts it.
   - Sure questions share one block headed `Sure: any objection?`: one line each, with the fact that settles it.
   - A leaning question gets its body, then a list with one item per line: something concrete (`Example:` from the session's example, or the real thing itself when the question is about that), `Recommended (leaning):`, and `Would flip it:`, the preference or fact that only the user holds. A flip you could look up, you look up.
   - A coin flip gets its options side by side in the same shape, each with what it costs, then `Forced:` with the one you would pick. No recommendation to nod at.
   - `What a yes starts:` goes under a question only when a yes sets off money, someone else's agreement, or something outward or hard to undo.
   - `Reviewer:` goes under a question the fresh read objected to, in the reviewer's own words.
5. **Waiting** and **Set aside**, every round. Waiting lists what cannot be asked yet and what it waits on. Set aside lists each point the user parked ("let's keep it in mind") until it is settled or dropped.

Number questions across the whole session, never per round: Q3 names one question for good. A question asked again, reworded or not, keeps its number, and new ones continue from the highest number used.

## After the answers

1. **Attack each answer before it counts.** Build one case meant to break every answer that is not plainly safe; the hard cases of the example are for this. An answer that breaks comes back in the next round under its own number, with the case. An answer given to a block of sure questions by raising no objection counts, and is confirmed at the close.
2. **Weigh what the reviewer sent.** An objection that a fact settles gets one line naming the fact. Every other one becomes a question, or a `Reviewer:` line under the question it bears on.
3. **Write the record**, by hand, one list item per entry, then run `python3 "${CLAUDE_SKILL_DIR}/scripts/record.py" check <plan.md>` and fix what it refuses. It prints the count line, the next question number and the agreed words; print the `New words` line it asks for. After a compaction, run it and re-read the file before anything else.

```
## Terms
- **<word>** (<where it comes from>): <what it means>. Agreed by the user on <YYYY-MM-DD>. For the glossary.
## Decisions
- **Q<n>. <Title.>** <what was decided, and by whom>. Why: <the reason, in the user's words when they gave one>. Also applies to: <where else the same mechanism lives>.
## Open
- **Q<n>. <Title.>** <one line>. Waits on Q<m>.
## Set aside
- <point>
```

`For the glossary.`, `Also applies to:` and `Waits on` appear only where they are true; `Waits on` names a question, a word still to be agreed or a lookup still running. A numbered question never leaves the record: one you drop moves to Decisions as dropped, with its why, so its number is never used again. Mark a word for the glossary only when it names a thing in the project; a label of this one plan is not a glossary word. A decision needs its why: when the user overruled your recommendation and gave no reason, ask once.

## The close

When nothing is open or waiting:

1. **Propose the principle**: one sentence for the whole, short enough to remember: the idea the decisions follow from, not a list of them. Build a case against each "every", "only" and "never" in it and reword until it survives. Write it into the record.
2. **Second fresh read**, unless small: the same command, which now reads the record against the principle you wrote into it. Weigh what comes back as above; what survives is a last round.
3. **Show only what the user did not actively decide**, in this order: the points set aside (each settled, dropped or carried into the plan); what was settled by no objection, one line each, as a last call; a words table that got no answer; a decision with no why, asked once; the principle, as a question, with the cases it survived. Do not repeat what they answered by number.
4. **The glossary.** When the repo has one, write the words marked for it in one change, shown as one diff, in the format of [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md), on the branch the work will use when a plan follows. Offer a decision record only when the three conditions in [ADR-FORMAT.md](ADR-FORMAT.md) hold. Never create a glossary unasked.
5. **The stamp**, once all of that is answered: the final picture, then `🔥 Grilled: <n> settled · 0 open · <m> set aside`.

Do not act on the result until the user confirms you have reached a shared understanding. When work follows, the plan skill takes the record as the plan file.
