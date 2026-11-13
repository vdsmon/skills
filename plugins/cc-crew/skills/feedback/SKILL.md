---
name: feedback
description: Files feedback about the crew itself (the chief engineer role, a builder, a review, a plan or its page) in a local ledger, with the session, the piece concerned and what was wanted instead. Use when the user asks to file crew feedback, or says yes when asked.
argument-hint: "[what you want changed in the crew]"
---

# feedback

The user wants something about the crew itself changed: how the chief engineer, a builder, a helper, a review, a plan or a page behaved. File it so it can be acted on later, from the repository where the crew is built. Fix nothing now.

**His words:** $ARGUMENTS

## 1. Work out the entry

Take it from the conversation; you were there.

- **Piece:** role text, builder, helper, reviewer, plan skill, page, brief, or other.
- **What happened:** two or three sentences, with what was being done at that moment.
- **His words:** quoted as he said them.
- **What he wanted instead:** write it when the conversation makes it plain. When it does not, ask him one question. If he does not say, write your best guess and mark it "guess".
- **Your reading of the cause:** one line, marked as yours.

## 2. File it

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/feedback.sh" file "<piece>" "${CLAUDE_SESSION_ID}" <<'EOF'
<the entry>
EOF
```

The script adds the time and the repository, and writes the entry as its own file under `~/.claude/.cc-crew/feedback/open/`.

## 3. Say so and go on

Tell him in one line that it is filed, then carry on with the work in hand. It is discussed and acted on later, in `/cc-crew:apply-feedback`.
