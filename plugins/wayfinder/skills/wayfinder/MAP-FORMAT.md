# Map format

The map body, the ticket body, and how each tracker expresses the map's mechanics. Referenced from [SKILL.md](SKILL.md).

## Map body template

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<!-- in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->
```

## Ticket body template

```markdown
## Question

<the decision or investigation this ticket resolves>
```

Labels: the map carries `wayfinder:map`; each ticket carries one `wayfinder:<type>` (`research` | `prototype` | `grilling` | `task`). The answer is posted as a resolution comment when the ticket closes, never edited into the body.

## Per-tracker mechanics

| operation | bd (beads) | GitHub (`gh`) | local file |
| --- | --- | --- | --- |
| map | `bd create "<title>" -t epic --add-label wayfinder:map`, body = map template | `gh issue create`, label `wayfinder:map` | `WAYFINDER.md` top section |
| ticket | `bd create "<title>" --add-label wayfinder:<type>` | `gh issue create`, label `wayfinder:<type>`; add as sub-issue of the map | `## <title>` section |
| parent link | ticket description references the map key | native sub-issue of the map issue | section lives in the file |
| blocking edge | `bd dep add <ticket> <blocker>` | native "blocked by" relationship where available; else a `## Blocked by` body section listing issue references | `Blocked by:` line listing section titles |
| frontier query | `bd ready` filtered to `wayfinder:` labels, unassigned | open issues labelled `wayfinder:`, no assignee, no open blockers | open sections whose blockers are all closed |
| claim | `bd update <id> --claim` | `gh issue edit --add-assignee` | `Claimed by:` line |
| resolve | comment the answer, `bd close <id>` | comment the answer, `gh issue close` | append `Answer:` + mark the section closed |

`bd list` hides closed issues and caps at 50 by default (`--all`, `--limit 0` when auditing the whole map); `bd edit` blocks on `$EDITOR`, use `bd update` flags instead.

## Local file fallback (`WAYFINDER.md`)

No tracker at all: one file at the repo root. The map body template sits at the top; each ticket is a `## <title>` section below it:

```markdown
## <Ticket title>

Type: grilling | research | prototype | task
Status: open | closed
Blocked by: <ticket titles, or "None">
Claimed by: <name, when someone is on it>

### Question

<the decision or investigation this ticket resolves>

### Answer

<filled on resolution>
```

Everything else works the same; the medium only loses the tracker's visual frontier and concurrent claiming, which is fine for a solo effort.
