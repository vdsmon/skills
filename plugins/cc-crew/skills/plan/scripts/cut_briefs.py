#!/usr/bin/env python3
"""Cut one brief per builder work item out of a plan file.

Usage: cut_briefs.py <plan.md> <out-dir>

Each brief is the plan's own lines, in this order: the item's For field, the
## What this is for section when the plan has one, the ## Principle section, the
item's heading and the rest of its body, the ## The ladder section, then the ## Every brief
section. Nothing is re-rendered: the item body is copied as written with only the For field
lifted to the top. The work items and the ladder are read and checked by plans.py's Reading,
as page.py checks them, so a plan whose page was written by hand meets the same checks here;
every plan answers the ladder, in one line "None, because <reason>." when it has no rungs.
Briefs land in <out-dir>/work-item-<n>.md;
stale work-item-*.md files there are removed, so the dir always matches the plan.

Exits 0 when it wrote briefs or when the plan has no builder item (it says so),
1 on a plan it cannot cut (it names the line and writes nothing), 2 on bad usage.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from plans import Reading, sections  # noqa: E402  (the readers of a plan file, shared with page.py)


class PlanError(Exception):
    """A plan the cutter will not cut, with every reason."""

    def __init__(self, reasons):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def trim(block):
    while block and not block[-1].strip():
        block = block[:-1]
    return block


def cut(plan_text):
    """Return [(n, brief text)] for every builder item; raise PlanError on a bad plan."""
    lines = plan_text.splitlines()
    spans, twice = sections(lines)
    problems = [f"line {i + 1}: second '## {t}' section" for i, t in twice]
    problems += [f"no '## {need}' section" for need in ("Principle", "Every brief") if need not in spans]
    reading = Reading(lines)  # the work items and the ladder, checked as page.py checks them
    problems += reading.problems
    if problems:
        raise PlanError(problems)
    ladder = trim(lines[slice(*spans["The ladder"])])
    principle = trim(lines[slice(*spans["Principle"])])
    shared = trim(lines[slice(*spans["Every brief"])])
    purpose = trim(lines[slice(*spans["What this is for"])]) if "What this is for" in spans else []

    briefs = []
    for it in reading.items:
        if it["who"].lower() != "builder":
            continue
        _, a, b = next(f for f in it["fields"] if f[0] == "For")
        for_block = trim(lines[a:b])
        rest = trim(lines[it["start"] + 1:a] + lines[b:it["end"]])
        parts = [p for p in (for_block, purpose, principle, [lines[it["start"]]] + rest, ladder, shared) if p]
        briefs.append((it["n"], "\n\n".join("\n".join(trim(p)).strip("\n") for p in parts) + "\n"))
    return briefs


def main(argv):
    if len(argv) != 3:
        print("usage: cut_briefs.py <plan.md> <out-dir>", file=sys.stderr)
        return 2
    plan, out = Path(argv[1]).resolve(), Path(argv[2]).resolve()
    try:
        briefs = cut(plan.read_text(encoding="utf-8"))
    except OSError as e:
        print(f"cut_briefs: cannot read {plan}: {e.strerror}", file=sys.stderr)
        return 1
    except PlanError as e:
        for k, reason in enumerate(e.reasons, 1):
            tail = "; no brief written" if k == len(e.reasons) else ""
            print(f"cut_briefs: {plan}: {reason}{tail}", file=sys.stderr)
        return 1
    targets = [(out / f"work-item-{n}.md", text) for n, text in briefs]
    if any(t == plan for t, _ in targets):
        print(f"cut_briefs: a brief would overwrite the plan {plan}; no brief written", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    keep = {t for t, _ in targets}
    for old in out.glob("work-item-*.md"):
        if old not in keep and old != plan:
            old.unlink()
    if not briefs:
        print(f"no builder item in {plan}; no brief written")
        return 0
    for t, text in targets:
        t.write_text(text, encoding="utf-8")
        print(t)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
