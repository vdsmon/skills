---
name: wayfinder
disable-model-invocation: true
description: Plan a huge chunk of work, more than one agent session can hold, as a shared map of investigation tickets on the repo's issue tracker, then resolve them one per session until the way to the destination is clear. Use when the user says "wayfinder", "chart this", "map this effort", brings a greenfield project or a feature too big for one session, or points at an existing map to work through. Produces decisions, not deliverables; hand the cleared way to your execution pipeline.
argument-hint: "[loose idea to chart, or a map to work through]"
---

A loose idea has arrived: too big for one agent session, and wrapped in fog. The way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **shared map** on the repo's issue tracker, then works its tickets one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. It might be a spec to hand off and iterate on, a decision to lock before planning starts, or a change made in place like a data-structure migration. The map is domain-agnostic: engineering work, course content, whatever fits the shape.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes**, carrying execution into the map itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is an issue, so it has a **name**: its title. In everything the human reads (narration, the map's Decisions so far) refer to it by that name, never by a bare id, number, or slug. A wall of `#42, #43, #44` is illegible; names read at a glance. The id and URL don't vanish: a name wraps its link, but they ride *inside* the name, never stand in for it.

## The tracker

The map lives on whatever issue tracker the repo already uses. Resolve it in this order:

1. A tracker documented in `CLAUDE.md` / `AGENTS.md` (an issue-tracker block naming the tool and its commands) wins.
2. Otherwise infer from the repo: a `.beads/` directory means bd; a GitHub remote means GitHub issues via `gh`.
3. No tracker at all: fall back to a single `WAYFINDER.md` file at the repo root.

Parent-to-child linkage and blocking use the tracker's **native** relationships where they exist, body-section conventions where they don't. Native edges matter: they render the frontier visually in the tracker's own UI, so the human sees what's takeable without opening the map. Per-tracker mechanics and the local-file fallback format: [MAP-FORMAT.md](MAP-FORMAT.md).

## The map

The map is a single issue labelled `wayfinder:map`, the canonical artifact. Its tickets are child issues of the map. The map body is the whole effort at low resolution, loaded once per session: Destination, Notes, Decisions so far, Not yet specified, Out of scope (template in [MAP-FORMAT.md](MAP-FORMAT.md)). Open tickets are **not** listed in the body; they are open children, found by query.

The map is an **index**, not a store. A decision lives in exactly one place, its ticket; the map never restates it, only gists it and links.

### Tickets

Each ticket is a child issue of the map, its body a single `## Question` sized to one agent session, carrying a `wayfinder:<type>` label (see Ticket types). A session **claims** a ticket by assigning it to the driving dev, **first**, before any work, so concurrent sessions skip it. The assignee *is* the claim: an open, unassigned ticket is unclaimed.

A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children, the edge of the known. The answer isn't part of the body: it's recorded on resolution. Assets created while resolving are linked from the issue, not pasted in.

## Ticket types

Every ticket is either **HITL** (human in the loop, worked *with* a human who speaks for themselves) or **AFK** (driven by the agent alone). A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it. A grilling agent that answers its own questions has broken HITL.

- **Research** (AFK): reading documentation, third-party APIs, or local resources like knowledge bases. Creates a markdown summary as a linked asset. Use when knowledge outside the current working directory is required.
- **Prototype** (HITL): raise the fidelity of the discussion with a cheap, rough, concrete artifact to react to: an outline, a rough take, a stub, throwaway code. Link it as an asset. Use when "how should it look" or "how should it behave" is the key question.
- **Grilling** (HITL): conversation via the `/grilling` and `/domain-modeling` skills (the grilling plugin), one question at a time. The default case.
- **Task** (HITL or AFK): manual work that must happen before a *decision* can be made: signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. The one type that *does* rather than decides, earning its place by unblocking a decision. The agent drives it alone where it can (AFK); otherwise it hands the human a precise checklist (HITL). The answer records what was done and any resulting facts (credentials location, new URLs, row counts) later tickets depend on.

## Fog of war

The map is *deliberately* incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**, the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, one at a time, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. Everything here is in scope, just not sharp enough to ticket. Write as loosely or as fully as the view allows; it doubles as a signpost for collaborators reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, *not* whether you can answer it now. Ticket when the question is already sharp, even if it's blocked. Not-yet-specified when you can't yet phrase it that sharply; don't pre-slice the fog into ticket-sized pieces, one patch may graduate into several tickets, or none, once the frontier reaches it.

## Out of scope

Fog only ever gathers *toward* the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in Not yet specified. It gets its own **Out of scope** section on the map, work consciously ruled out of *this* effort. It never graduates; it returns only if the destination is redrawn, and then as a fresh effort.

When an existing ticket turns out to sit past the destination (mis-scoped while charting, or exposed by a resolution), **close it** and leave one line in Out of scope: the gist plus why, linking the closed ticket. It stays out of Decisions so far, which records the route actually walked.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session.**

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Run a `/grilling` and `/domain-modeling` session to pin down what this map is finding its way to: the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** (the way is already clear, the whole journey small enough for one session) you don't need a map: stop and ask the user how they'd like to proceed.
3. **Create the map** (label `wayfinder:map`): Destination and Notes filled in, Decisions so far empty, the fog sketched into Not yet specified.
4. **Create the tickets you can specify now** as children of the map, then wire blocking edges in a **second pass** (issues need ids before they can reference each other). Everything you can't yet specify stays in the fog.
5. Stop. Charting the map is one session's work; do not also resolve tickets.

### Work through the map

User invokes with a map (URL, id, or file). A ticket is optional; without one, you pick the next decision, not the user.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it; otherwise take the first frontier ticket in order. **Claim it** before any work.
3. Resolve it, zooming as needed: fetch the full body of any related or closed ticket on demand; invoke the skills the map's Notes name. If in doubt, use `/grilling` and `/domain-modeling`.
4. Record the resolution: post the answer as a resolution comment, close the ticket, append a one-line pointer to the map's Decisions so far.
5. Add newly surfaced tickets (create, then wire edges); graduate any fog the answer has made specifiable, clearing each graduated patch from Not yet specified so it lives only as its new ticket. If the answer reveals a ticket sits beyond the destination, rule it out of scope rather than resolving it. If the decision invalidates other parts of the map, update or delete those tickets.

The user may run unblocked tickets in parallel, so expect other sessions to be editing the tracker concurrently.
