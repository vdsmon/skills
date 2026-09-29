---
name: domain-modeling
argument-hint: "[domain area or term]"
description: Build and sharpen a project's domain model. Use when pinning down codebase terminology or a ubiquitous language, or when writing or editing a GLOSSARY.md.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` for vocabulary is not this skill, since that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Find the glossary before you start:

- If a `GLOSSARY-MAP.md` exists at the root, the repo has several contexts. Read the map to find each context's `GLOSSARY.md`, and work out which context the current topic belongs to. If unclear, ask.
- Otherwise the repo has one context: a single `GLOSSARY.md` at the root, with ADRs in `docs/adr/`.
- A repo that already uses the older names `CONTEXT.md` and `CONTEXT-MAP.md` keeps them. Read and write those files everywhere this skill says `GLOSSARY.md` or `GLOSSARY-MAP.md`; don't rename them.

In a multi-context repo, ADRs split the same way as the glossaries:

```
/
├── GLOSSARY-MAP.md
├── docs/
│   └── adr/                          <- system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── GLOSSARY.md
│   │   └── docs/adr/                 <- context-specific decisions
│   └── billing/
│       ├── GLOSSARY.md
│       └── docs/adr/
```

Create files lazily, only when you have something to write. If no `GLOSSARY.md` exists, create one at the root when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `GLOSSARY.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update GLOSSARY.md inline

When a term is resolved, update `GLOSSARY.md` right there. Don't batch these up. Capture them as they happen. Use the format in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).

`GLOSSARY.md` should be totally devoid of implementation details. Do not treat `GLOSSARY.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Offer an ADR only when all three criteria in [ADR-FORMAT.md](./ADR-FORMAT.md) hold, and write it in that format.
