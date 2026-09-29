---
name: brainstorming
argument-hint: "[what to design]"
description: Use before any creative work, including new features, components, or behavior changes (not bug fixes). Explores intent, requirements, and design before implementing.
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by classifying how much process the request needs, then work through your path: understand the context, refine the idea, present a design, and get your human partner's approval.

## Establish Shared Understanding

The outcome of brainstorming is an understanding your human partner can recognize and correct, grounded in what they want to accomplish.

1. **Discover intent.** Use the request and available context to identify the intended outcome, who it is for, and what success looks like. When that information is missing, ask one focused question about purpose or intended use before proposing features or an approach. Knowing the app genre does not tell you why your partner wants it. Gathering missing requirements does not ask them to authorize the task again.
2. **Write back your understanding.** Summarize the intended outcome, relevant constraints, and success criteria in a short note your partner can assess. Separate what they said from assumptions. Invite correction and incorporate their answer before treating this as the design brief.
3. **Carry intent into the design.** Preserve the agreed understanding in the selected path's design artifact: the written spec for architectural work, or the in-chat design/probe for bounded work and spikes. Check proposed features and technical choices against that understanding.

When the request already supplies the purpose and constraints, reflect that understanding instead of asking the same questions again. Keep the note concise; its accuracy and the opportunity to correct it matter.

<HARD-GATE>
Before taking any implementation action, including invoking an implementation skill, writing product code, scaffolding, installing product dependencies, or creating an external project, complete the selected path's prerequisites:

- Spike: the human partner approves the question and probe.
- Bounded: the human partner approves the short in-chat design.
- Architectural: the human partner reviews and approves the written spec, then the implementation plan your planning step produces. Conversational design approval only permits writing the spec; written-spec approval only permits handing the spec to your planning step.

A reply approves the stage actually presented. Approval of an idea or feature scope does not approve artifacts that do not exist yet. Resume at the earliest incomplete stage; do not turn one approval into permission to skip the rest of the selected path. Read-only project exploration is allowed while those prerequisites remain incomplete.
</HARD-GATE>

## Three Paths

Before your first question, classify the request and say the classification out loud ("this looks bounded, so I'll present a short design here rather than write a spec") so your human partner can override it:

- **Spike:** a feasibility question ("can we...", "is it possible...", "quick and dirty is fine") whose output is an answer, not code you keep. Present the question and what you'll try in 2-3 sentences, get a nod, then find out as cheaply as correctness allows. No design doc, no spec file. Report findings as a recommendation; anything you built stays labeled throwaway.
- **Bounded:** a well-scoped change to code that already exists in this repo: a new flag, a small endpoint, a one-file fix. Understanding the kind of app is not enough: bounded means the flow you are changing is already here to read. If there is no existing flow to change, the task is not bounded. Ask the clarifying questions that matter, present a short design IN CHAT (a few sentences to a few short paragraphs), and STOP. Implementation starts only after your human partner says yes to that design; a bounded task's approval is as hard a gate as an architectural one. No spec file, no implementation plan document.
- **Architectural:** new projects, new subsystems, changes that restructure how components fit together or alter interfaces others depend on. Follow the full process: questions, approaches, sectioned design, written spec, then the planning handoff.

When in doubt between two paths, take the heavier one. The ratchet is one-way: hidden complexity discovered mid-task upgrades the path. Stop, say so, and step up. Nothing downgrades mid-task.

## Red Flags

| Thought | Reality |
|---------|---------|
| "This is too simple to need a design" | Follow the selected path: a bounded change gets a short chat design; an architectural change gets the written spec and planning handoff. A new todo-list project is architectural. |
| "I'll call it bounded and skip the spec" | Reaching for a label to skip work IS the doubt. Take the heavier path. |
| "It's bounded and the design is obvious, so I'll start while they read it" | The gate is the approval, not the design's length. Present, then stop until you hear yes. |
| "I understand this kind of app, so it's bounded" | Bounded measures the repo, not your familiarity. A new project has no existing flow, so it is architectural. |
| "The spike works, so I'll keep the code" | A spike's output is an answer. Keeping the code is a new request, so classify it. |
| "It grew, but I'm almost done, so no need to re-classify" | Hidden complexity upgrades the path mid-task. Stop and say so. |
| "They approved the spike, so the follow-up change is approved too" | Each task gets its own classification and its own approval. |

## Checklist

Classify first, announce the path, then create a task for each item on your path and complete them in order.

**Spike:**
1. **Explore project context:** enough to frame the probe
2. **Present question + probe plan:** 2-3 sentences
3. **Get approval:** a nod is enough
4. **Investigate:** as cheaply as correctness allows
5. **Report findings:** a recommendation; label anything built as throwaway

**Bounded:**
1. **Explore project context:** check files, docs, recent commits
2. **Ask clarifying questions:** one at a time, the ones that matter
3. **Present short design in chat:** approach, files touched, testing
4. **Get approval:** STOP and wait for an explicit yes; presenting the design and starting in the same breath is skipping the gate
5. **Implement:** proceed with the normal development workflow (TDD applies); no plan document

**Architectural:**
1. **Explore project context:** check files, docs, recent commits
2. **Ask clarifying questions:** one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches:** with trade-offs and your recommendation
4. **Present design:** in sections scaled to their complexity, get user approval after each section
5. **Write design doc:** save to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit
6. **Spec self-review:** quick inline check for placeholders, contradictions, ambiguity, scope (see below)
7. **User reviews written spec:** ask the user to review the spec file before proceeding
8. **Hand off to planning:** give the approved spec to your planning step (e.g. flow, or a dedicated planning skill) to create the implementation plan

**Terminal states are path-bound.** Architectural: the approved spec goes to your planning step; never jump from here into frontend-design, mcp-builder, or any other implementation skill. Bounded: after approval, implementation proceeds directly through the normal development workflow; no plan document. Spike: the terminal state is a reported recommendation.

## The Process

These subsections serve the bounded and architectural paths (a spike stops at "present the probe, get a nod"). Sections from **Exploring approaches** onward are architectural-path depth; for bounded work, context plus a few questions plus a short in-chat design is the whole process.

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec -> plan -> implementation cycle.
- For appropriately-scoped projects, ask questions one at a time to refine the idea. Prefer multiple choice questions when possible, but open-ended is fine too. If a topic needs more exploration, break it into multiple questions.
- Focus on understanding: purpose, constraints, success criteria
- When a question is visual (layout, mockup, diagram), show it with the host's visual tool (artifact, widget, browser pane) instead of describing it. A question about a UI topic is not automatically a visual question.

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally, leading with your recommended option and explaining why
- YAGNI ruthlessly: remove unnecessary features from every approach and design

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far, and be ready to go back and clarify
- Cover: architecture, components, data flow, error handling, testing
- Aim for deep modules: a lot of behavior behind a small interface, testable through that interface. When the codebase-design skill is installed, use its vocabulary.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, tangled responsibilities), include targeted improvements as part of the design, the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design (architectural path)

**Documentation:** Write the validated design (spec) to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit it. User preferences for spec location override this default.

**Spec self-review:** After writing the spec, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review; just fix and move on.

**User review gate:** After the self-review, ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the self-review. Only proceed to the planning handoff once the user approves.
