---
name: apply-feedback
description: Works through the crew's feedback ledger with the user. Groups the open entries by cause, discusses each group with a recommendation, changes the crew's texts only on the user's ruling, and records in the ledger what became of each entry.
disable-model-invocation: true
---

# apply-feedback

The user wants to act on what was filed about the crew with `/cc-crew:feedback`. This is a session with him: every open entry is discussed, and nothing changes before he rules on it.

Run it in the repository where the crew is built, the one that holds `plugins/cc-crew`. Anywhere else, say so and stop: the crew's texts can only be changed and shipped from there.

## 1. Read the ledger

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/feedback.sh" open
```

It prints every open entry whole, under a line `=== entry <id> ===`; that id is what `close` takes. Read all of them before you propose anything. When nothing is open, say so and stop.

## 2. Group by cause

Group the entries by cause, not by piece: two entries about different pieces can share one cause, and one cause gets one change. For each group, work out:

- **The cause,** in one line, checked against the text as it is now. An entry's own reading of the cause was a guess made in the moment, and the text may have changed since it was filed.
- **The from-scratch test:** would the text we would write from scratch today already carry this?
- **Where it belongs:** which of the crew's texts, or a home outside the crew. Something that holds in any session, not only in the crew's, belongs in the user's own instructions.
- **Your recommendation:** change it (with the sentence you would write, and where), move it (where to), wait for another case, or decline (why).

One entry can be enough for a change: the discussion with him is the check.

## 3. Discuss

Bring him every group in one reply: his words as the entries quote them, the cause, your recommendation and what it would change. Then discuss, and push back with facts. He rules on each group: change, move, wait or decline. When he gives no reason, ask once, and record each ruling with its why where the project keeps its decisions.

Change nothing before his ruling on that group.

## 4. Apply the rulings

- **Change:** write it once per cause, in the place where a text written from scratch would say it, not as a patch added at the end. Show him the new wording, and ship it on his yes. An entry that shows a real failure is a ready test case: add it to the crew's wording test under `evals/cc-crew/`.
- **Move:** write it in its new home only on his yes to the exact text.

Ship the changes the way the repository's guide says.

## 5. Close the entries

Close an entry when its outcome is real: a change after its pull request merges, a move after the text is in its new home, a decline at his ruling.

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/feedback.sh" close <id> "<outcome>"
```

Write an outcome that stands alone: `applied: <what changed>, pull request #<n>`, `moved: <where to>` or `declined: <why>`. An entry that waits is not closed: it stays open and comes back at the next pass, beside any new entry with the same cause.

End by telling him what changed, what moved and what is still open.
