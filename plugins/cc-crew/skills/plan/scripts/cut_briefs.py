#!/usr/bin/env python3
"""Cut one brief per builder work item out of a plan file.

Usage: cut_briefs.py <plan.md> <out-dir>

Each brief is the plan's own lines, in this order: the item's For field, the
## What this is for section when the plan has one, the ## Principle section, the
item's heading and the rest of its body, then the ## Every brief section. Nothing is re-rendered: the item body is copied as written
with only the For field lifted to the top. Briefs land in <out-dir>/work-<n>.md;
stale work-*.md files there are removed, so the dir always matches the plan.

Exits 0 when it wrote briefs or when the plan has no builder item (it says so),
1 on a plan it cannot cut (it names the line and writes nothing), 2 on bad usage.
"""
import re
import sys
from pathlib import Path

FIELDS = ("For", "You own", "Where", "Work", "Limits", "Done when", "Runs with")
FIELD_RE = re.compile(r"^- (%s)\b[^:\n]*:" % "|".join(re.escape(f) for f in FIELDS))
ITEM_RE = re.compile(r"^### Work (\d+)\b.*\(([^()]*)\)\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")


class PlanError(Exception):
    pass


def headings(lines, level):
    """(index, text) of each heading of exactly this level, outside code fences."""
    out, fenced, mark = [], False, "#" * level + " "
    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            fenced = not fenced
        elif not fenced and line.startswith(mark):
            out.append((i, line[len(mark):].strip()))
    return out


def sections(lines):
    """Map each ## heading's text to its (start, end) line span, heading included."""
    hs = headings(lines, 2)
    spans = {}
    for k, (i, text) in enumerate(hs):
        end = hs[k + 1][0] if k + 1 < len(hs) else len(lines)
        if text in spans:
            raise PlanError(f"line {i + 1}: second '## {text}' section")
        spans[text] = (i, end)
    return spans


def trim(block):
    while block and not block[-1].strip():
        block = block[:-1]
    return block


def cut_item(lines, start, end):
    """Split one item into (heading, For block, rest of body)."""
    heading, body = lines[start], lines[start + 1:end]
    field_starts = [i for i, l in enumerate(body) if FIELD_RE.match(l)]
    fors = [i for i in field_starts if body[i].startswith("- For")]
    where = f"line {start + 1} ({heading.strip()})"
    if len(fors) != 1:
        raise PlanError(f"{where}: needs exactly one '- For:' field, found {len(fors)}")
    a = fors[0]
    b = next((i for i in field_starts if i > a), len(body))
    return heading, trim(body[a:b]), trim(body[:a] + body[b:])


def cut(plan_text):
    """Return [(n, brief text)] for every builder item; raise PlanError on a bad plan."""
    lines = plan_text.splitlines()
    spans = sections(lines)
    for need in ("Principle", "Every brief", "Work"):
        if need not in spans:
            raise PlanError(f"no '## {need}' section")
    principle = trim(lines[slice(*spans["Principle"])])
    shared = trim(lines[slice(*spans["Every brief"])])
    purpose = trim(lines[slice(*spans["What this is for"])]) if "What this is for" in spans else []

    w0, w1 = spans["Work"]
    items = [(i, t) for i, t in headings(lines, 3) if w0 < i < w1]
    briefs, seen = [], set()
    for k, (i, _) in enumerate(items):
        m = ITEM_RE.match(lines[i])
        if not m:
            raise PlanError(f"line {i + 1}: item heading is not '### Work <n> <title> (<who>)'")
        n, who = m.group(1), m.group(2).strip().lower()
        if n in seen:
            raise PlanError(f"line {i + 1}: second Work {n}")
        seen.add(n)
        if who != "builder":
            continue
        end = items[k + 1][0] if k + 1 < len(items) else w1
        heading, for_block, rest = cut_item(lines, i, end)
        parts = [p for p in (for_block, purpose, principle, [heading] + rest, shared) if p]
        briefs.append((n, "\n\n".join("\n".join(trim(p)).strip("\n") for p in parts) + "\n"))
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
        print(f"cut_briefs: {plan}: {e}; no brief written", file=sys.stderr)
        return 1
    targets = [(out / f"work-{n}.md", text) for n, text in briefs]
    if any(t == plan for t, _ in targets):
        print(f"cut_briefs: a brief would overwrite the plan {plan}; no brief written", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    keep = {t for t, _ in targets}
    for old in out.glob("work-*.md"):
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
