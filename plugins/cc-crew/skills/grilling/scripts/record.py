#!/usr/bin/env python3
"""Start and check the record a grilling writes into, which later becomes the plan file.

Usage:
  record.py start <name> <subject...>
  record.py check <plan.md>

start creates <plans>/<name>/plan.md, <plans> being $CC_CREW_PLANS or ~/.claude/plans,
then checks it. A file that already exists is left untouched and only checked, so a
second session continues the same record. The file's path is always the last line.

check reads the Terms, Decisions, Open and Set aside sections and nothing else. It refuses, naming each line: a decision with no reason after "Why:", a
term with no source in parentheses or no meaning, and a question number used twice
across Decisions and Open. Otherwise it prints what is settled and open, the next
question's number and the agreed words.

Exits 0 on a sound record, 1 on a refused one, 2 on bad usage or an unreadable file.
"""
import os
import re
import sys
from pathlib import Path

SECTIONS = ("Terms", "Decisions", "Open", "Set aside")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
LABEL_RE = re.compile(r"^- \*\*Q(\d+)\.")
ANY_Q_RE = re.compile(r"\bQ(\d+)\b")
WHY_RE = re.compile(r"\bWhy:(.*)$")
WAITS_RE = re.compile(r"\bWaits on Q\d+")
TERM_RE = re.compile(r"^- \*\*(.+?)\*\* \((.+?)\):(.*)$")
AGREED = "Agreed by the user on"
REMINDER = (
    'Before this round goes out, print "New words:" with each term in it that the user '
    'has not used or agreed to, or "New words: none". Agreed so far: the words above, '
    "and the words of the repo's glossary when it has one."
)


def template(name, subject):
    return (
        f"# {name}\n\nStatus: grilling.\n\n"
        f"## Principle\n\nNot proposed yet.\n\n"
        f"## What this is for\n\n{subject}\n\n"
        "## Example\n\n## Terms\n\n## Decisions\n\n## Open\n\n## Set aside\n"
    )


def entries(lines):
    """Map each of SECTIONS to its list items as (line number, text).

    An item is a `- ` line at column 0 outside code fences; indented lines after it
    are its continuation, so a reason wrapped onto the next line still counts.
    """
    out = {s: [] for s in SECTIONS}
    section, fenced, item = None, False, None
    for n, line in enumerate(lines, 1):
        if FENCE_RE.match(line):
            fenced, item = not fenced, None
            continue
        if fenced:
            continue
        if line.startswith("## "):
            title = line[3:].strip()
            section, item = (title if title in out else None), None
        elif section is None:
            continue
        elif line.startswith("- "):
            item = [n, line.rstrip()]
            out[section].append(item)
        elif item is not None and line[:1] in (" ", "\t") and line.strip():
            item[1] += " " + line.strip()
        else:
            item = None
    return {s: [tuple(i) for i in items] for s, items in out.items()}


def has_words(text):
    return re.search(r"\w", text) is not None


def check(text):
    """Return (problems, summary lines) for one record."""
    e = entries(text.splitlines())
    problems, labels, agreed = [], {}, []

    for n, item in e["Decisions"]:
        why = WHY_RE.search(item)
        if why is None:
            problems.append(f'line {n}: decision has no "Why:"')
        elif not has_words(why.group(1)):
            problems.append(f'line {n}: decision has nothing after "Why:"')

    for n, item in e["Terms"]:
        m = TERM_RE.match(item)
        if m is None or not has_words(m.group(2)):
            problems.append(f"line {n}: term has no (<where it comes from>) after the bold word")
            continue
        meaning = m.group(3).split(AGREED, 1)[0]
        if not has_words(meaning):
            problems.append(f"line {n}: term has no meaning after the colon")
        elif AGREED in m.group(3):
            agreed.append(m.group(1))

    for section in ("Decisions", "Open"):
        for n, item in e[section]:
            m = LABEL_RE.match(item)
            if m:
                labels.setdefault(int(m.group(1)), []).append(n)
    for q, at in sorted(labels.items()):
        if len(at) > 1:
            where = ", ".join(str(n) for n in at)
            problems.extend(f"line {n}: Q{q} appears more than once (lines {where})" for n in at)

    # Every Q<n> the four sections mention counts, so a number named only in a
    # "Waits on" or a set-aside point is never handed out again.
    mentioned = [int(q) for s in SECTIONS for _, item in e[s] for q in ANY_Q_RE.findall(item)]
    waiting = sum(1 for _, item in e["Open"] if WAITS_RE.search(item))
    summary = [
        f"{len(e['Decisions'])} settled · {len(e['Open']) - waiting} open · "
        f"{waiting} waiting · {len(e['Set aside'])} set aside",
        f"Next question: Q{max(mentioned, default=0) + 1}",
        "Agreed words: " + (", ".join(agreed) if agreed else "none yet"),
        REMINDER,
    ]
    return problems, summary


def run_check(path):
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        print(f"record.py: cannot read {path}: {err.strerror}", file=sys.stderr)
        return 2
    problems, summary = check(text)
    if problems:
        for p in problems:
            print(f"record.py: {path} {p}", file=sys.stderr)
        return 1
    print("\n".join(summary))
    return 0


def run_start(name, subject):
    root = os.environ.get("CC_CREW_PLANS") or str(Path.home() / ".claude" / "plans")
    path = Path(root).expanduser() / name / "plan.md"
    if not path.exists():
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(template(name, subject), encoding="utf-8")
        except OSError as err:
            print(f"record.py: cannot write {path}: {err.strerror}", file=sys.stderr)
            return 2
    rc = run_check(path)
    print(path)
    return rc


def main(argv):
    if len(argv) >= 4 and argv[1] == "start" and argv[2].strip():
        return run_start(argv[2], " ".join(argv[3:]))
    if len(argv) == 3 and argv[1] == "check":
        return run_check(Path(argv[2]))
    print("usage: record.py start <name> <subject...>\n       record.py check <plan.md>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv))
