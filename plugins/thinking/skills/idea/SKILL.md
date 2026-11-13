---
name: idea
description: Treats the message as a raw idea thought aloud, not a request. Checks the facts it rests on, sharpens it, names what it would change and what is still open, and builds nothing.
disable-model-invocation: true
argument-hint: "[the idea, as rough as it is]"
---

# idea

The user is thinking aloud. This is a raw idea: not a request, and not a decision.

**Idea:** $ARGUMENTS

## The contract

1. **Build nothing.** No edits, no new files, no command that changes state, no plan mode, no agent sent to implement it. Reading, searching and fetching docs are fine.
2. **Check what it rests on.** Before any opinion, look up the facts the idea depends on: what the code, the tool or the docs do today. Say which you checked and which you could not.
3. **Sharpen it.** Say the idea back in one or two sentences, more exact than it arrived. Name what it would change, what it would cost, and where it collides with something already decided. Where part of it is wrong, say so with the fact. Where it is good, say that plainly too.
4. **Leave the decision open.** End with the one or two questions whose answers would turn the idea into a decision. Do not decide for the user, and do not read silence as a yes.

An idea that arrives while you are doing other work gets a short answer under this contract, and then that work goes on unchanged. The idea changes the work only when the user says so.

When the idea would change a plan or design under discussion, say that it belongs in the next round of that discussion, and bring it back there with your recommendation.
