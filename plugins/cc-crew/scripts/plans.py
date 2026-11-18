#!/usr/bin/env python3
"""Keep a plan file's first lines and Progress section, and read where every plan stands.

Usage:
  plans.py hold <plan.md>
  plans.py phase <plan.md> <grilling|awaiting approval|building> [sentence...]
  plans.py wait <plan.md> <who or what>: <what for>
  plans.py go <plan.md>
  plans.py progress <plan.md>          (again after work items are added to or taken out of the plan)
  plans.py item <plan.md> <n> <not started|under way|done> [note...]
  plans.py close <plan.md> <done|dropped> <sentence...>
  plans.py report
  plans.py badge <session id> [<transcript.jsonl>]
  plans.py turn-end                    (a Stop hook's input on stdin)

The session is $CLAUDE_CODE_SESSION_ID, or --session <id> anywhere on the line. Plans are
<plans>/<name>/plan.md, <plans> being $CC_CREW_PLANS or ~/.claude/plans.

A plan file's first lines sit between its "# " title and its first "## " heading: Phase,
Waiting on, Repository, Held by, Page. The script writes those lines and the "## Progress"
section and nothing else. After every write it derives each touched session's held-name
file, ~/.claude/.cc-autotitle/held/<session id>, from the plan files as they now stand.

report and badge only read: a file they cannot read is listed as not readable, never fatal,
and the only program they start is git (report alone).

Exits 0 on success, 1 on a refusal, 2 on bad usage or a file that cannot be read or written.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PHASES = ("grilling", "awaiting approval", "building", "done", "dropped")
OPEN_PHASES = ("grilling", "awaiting approval", "building")
STATES = ("not started", "under way", "done")
KEYS = ("Phase", "Waiting on", "Repository", "Held by", "Page")
KEY_RE = re.compile(r"^(Phase|Waiting on|Repository|Held by|Page):[ \t]*(.*?)\s*$")
PHASE_RE = re.compile(r"^(" + "|".join(PHASES) + r")(?:\.(?:\s+(.*))?)?$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^### Work item (\d+)\b")
ITEM_RE = re.compile(r"^- Work item (\d+):\s*(.*?)\s*$")
STATE_RE = re.compile(r"^(" + "|".join(STATES) + r")(?:\.(?:\s+(.*))?)?$")
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NAME_MAX = 40
NAME_RULE = f"a plan's name is its folder name: kebab-case (lowercase letters, digits and hyphens), at most {NAME_MAX} characters"
SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")
PROGRESS = "## Progress"


class Refused(Exception):
    """A command that will not run, with every reason."""

    def __init__(self, *reasons):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


class Unusable(Exception):
    """A file that cannot be read or written, or bad usage."""


def plans_root():
    return Path(os.environ.get("CC_CREW_PLANS") or str(Path.home() / ".claude" / "plans")).expanduser()


def held_dir():
    return Path.home() / ".claude" / ".cc-autotitle" / "held"


def valid_name(name):
    return len(name) <= NAME_MAX and NAME_RE.match(name) is not None


def valid_session(sid):
    return bool(sid) and SESSION_RE.match(sid) is not None


def repository(cwd=None):
    """The main checkout's folder for cwd, or cwd outside git.

    It is the first worktree git lists: the same from every worktree of a repository. For a
    submodule git lists its own git folder there, which is not where its files are but is its
    alone, where the parent of git's common dir would be shared by its siblings.
    """
    cwd = cwd or os.getcwd()
    try:
        out = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=cwd, capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0:
            for line in out.stdout.splitlines():
                if line.startswith("worktree "):
                    return os.path.realpath(line[len("worktree "):])
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.realpath(cwd)


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
    """A plan file's "## " sections, the one reader of them that the crew's scripts share.

    Returns ({title: (heading index, end index)}, [(index, title) of each title met a second time]);
    the span is the first section of that title.
    """
    hs = headings(lines, 2)
    spans, twice = {}, []
    for k, (i, text) in enumerate(hs):
        end = hs[k + 1][0] if k + 1 < len(hs) else len(lines)
        if text in spans:
            twice.append((i, text))
        else:
            spans[text] = (i, end)
    return spans, twice


# -- a plan file's work items and ladder -------------------------------------------
# One reader, with the checks on them, shared by page.py and cut_briefs.py, so that a plan file
# passes or fails the same checks in both. report and badge never use it: they run at every
# session start and every refresh of the status line, and stay as cheap as reading first lines.

WORK_ITEM_RE = re.compile(r"^### Work item (\d+)\s+(.*?)\s*\(([^()]*)\)\s*$")
FIELD_RE = re.compile(r"^- ([A-Z][^:\n]*?):\s*(.*)$")
TOP_ITEM_RE = re.compile(r"^[-*+]\s+")
RUNG_RE = re.compile(r"^[-*+]\s+Rung\s+(\d+)\s+(.*)$")
FACTS = ("Runs", "Mocks or skips", "Cannot tell", "Time and cost", "Built by")
FACT_RE = re.compile(r"^[-*+]\s+(%s):\s*(.*)$" % "|".join(FACTS))
DONE_RE = re.compile(r"^Done means:\s*Rung\s+(\d+)\.?\s*$")
REF_RE = re.compile(r"\bWork item (\d+)\b")
LADDER_ANSWER = "add the section above '## Work', with its rungs, or the one line 'None, because <reason>.'"


def indent(line):
    return len(line) - len(line.lstrip(" "))


def dedent(lines):
    cut = min((indent(l) for l in lines if l.strip()), default=0)
    return [l[cut:] for l in lines]


def chunks(lines):
    """Split lines into ("item", lines) for each top-level list item and ("text", lines) between."""
    out = []
    for line in lines:
        if TOP_ITEM_RE.match(line):
            out.append(["item", [line]])
        elif out and out[-1][0] == "item" and (
            indent(line) > 0 or (line.strip() and out[-1][1][-1].strip()) or not line.strip()
        ):
            out[-1][1].append(line)
        elif out and out[-1][0] == "text":
            out[-1][1].append(line)
        else:
            out.append(["text", [line]])
    return [(kind, ls) for kind, ls in out]


def item_text(lines):
    """A top-level list item's text on one line, without its marker."""
    return TOP_ITEM_RE.sub("", " ".join(l.strip() for l in lines if l.strip()), count=1)


class Reading:
    """A plan file's work items and its ladder, read once, with every problem found in them.

    items: [{n, title, who, start, end, fields: [(name, first index, end index)], for, after,
    with, done_when, level}], line indexes into the lines given, fields outside code fences.
    rungs: {n: (name, {label: text})}; done: the rung "Done means" names; none: the one line
    "None, because <reason>." when the ladder has no rungs; above and ladder_text: the section's
    other list items and its text, for the page.
    """

    def __init__(self, lines):
        self.lines, self.problems = lines, []
        self.items, self.intro = [], []
        self.rungs, self.done, self.none, self.above, self.ladder_text = {}, None, None, [], []
        spans, _ = sections(lines)
        self._ladder(spans.get("The ladder"))
        self._work(spans.get("Work"))
        self._links()

    # -- the ladder --

    def _ladder(self, span):
        body = self.lines[span[0] + 1:span[1]] if span else []
        filled = [l.strip() for l in body if l.strip()]
        if not filled:
            self.problems.append(f"no answer under '## The ladder': {LADDER_ANSWER}")
            return
        if len(filled) == 1 and filled[0].startswith("None, because"):
            if not filled[0][len("None, because"):].strip(" ."):
                self.problems.append("'## The ladder' says 'None, because' and gives no reason")
            self.none = filled[0]
            return
        dones = [int(m.group(1)) for m in (DONE_RE.match(l) for l in filled) if m]
        if len(dones) > 1:
            self.problems.append("'## The ladder' has more than one 'Done means:' line")
        self.done = dones[-1] if dones else None
        refused = False
        for kind, ls in chunks([l for l in body if not DONE_RE.match(l.strip())]):
            if kind == "text":
                self.ladder_text.extend(ls)
            elif not RUNG_RE.match(ls[0].strip()):
                self.above.append(item_text(ls))
            else:
                found = self._rung(ls)
                if found is None:
                    refused = True
                elif found[0] in self.rungs:
                    self.problems.append(f"'## The ladder' has Rung {found[0]} twice")
                else:
                    self.rungs[found[0]] = found[1:]
        if not self.rungs:
            if not refused:
                self.problems.append("'## The ladder' has no '- Rung <n> <name>' item and is not the one line 'None, because <reason>.'")
        elif self.done is None:
            self.problems.append("'## The ladder' has no line 'Done means: Rung <n>.'")
        elif self.done not in self.rungs:
            self.problems.append(f"'## The ladder': 'Done means: Rung {self.done}.' names a rung the ladder does not have")

    def _rung(self, ls):
        """(n, name, {label: text}) of one "- Rung <n> <name>" item and its labelled sub-items, or None."""
        m = RUNG_RE.match(ls[0].strip())
        n, name = int(m.group(1)), m.group(2).strip().rstrip(":").strip()
        subs = [(kind, " ".join(l.strip() for l in sub if l.strip())) for kind, sub in chunks(dedent(ls[1:]))]
        subs = [(kind, text) for kind, text in subs if text]
        if not subs and ": " in name:  # a name may hold a colon; with no sub-item under it, it is the older shape
            self.problems.append(f"Rung {n} gives its facts in one line: give each as a sub-item under '- Rung {n} <name>', starting {', '.join(FACTS[:4])} or {FACTS[4]}, then ':'")
            return None
        facts = {}
        for kind, text in subs:
            f = FACT_RE.match(text) if kind == "item" else None
            if not f:
                self.problems.append(f"Rung {n}: '{text}' is not a sub-item starting {', '.join(FACTS)}, then ':'")
            elif f.group(1) in facts:
                self.problems.append(f"Rung {n} has '{f.group(1)}:' twice")
            elif not f.group(2).strip():
                self.problems.append(f"Rung {n}: '{f.group(1)}:' is empty")
            else:
                facts[f.group(1)] = f.group(2).strip()
        self.problems += [f"Rung {n} has no '{label}:' sub-item" for label in FACTS[:4] if label not in facts]
        return n, name, facts

    # -- the work items --

    def _work(self, span):
        if span is None:
            self.problems.append("no '## Work' section")
            return
        a, b = span
        hs = [(a + 1 + i, t) for i, t in headings(self.lines[a + 1:b], 3)]
        self.intro = self.lines[a + 1:hs[0][0] if hs else b]
        for k, (i, _) in enumerate(hs):
            m = WORK_ITEM_RE.match(self.lines[i])
            if not m:
                self.problems.append(f"line {i + 1}: the heading '{self.lines[i].strip()}' is not '### Work item <n> <title> (<who>)'")
                continue
            end = hs[k + 1][0] if k + 1 < len(hs) else b
            self.items.append({"n": int(m.group(1)), "title": m.group(2), "who": m.group(3).strip(),
                               "start": i, "end": end, "fields": self._fields(i + 1, end)})
        if not self.items and not hs:
            self.problems.append("'## Work' has no '### Work item <n> <title> (<who>)'")
        numbers = [it["n"] for it in self.items]
        for n in sorted({n for n in numbers if numbers.count(n) > 1}):
            self.problems.append(f"'## Work' has Work item {n} twice")
        for it in self.items:
            self._item(it)

    def _fields(self, start, end):
        """[(name, first index, end index)] of an item's "- Name:" fields outside code fences.

        A field runs to the next top-level "- " line outside a fence, its trailing blank lines left out.
        """
        out, fenced = [], False
        for j in range(start, end):
            line = self.lines[j]
            if FENCE_RE.match(line):
                fenced = not fenced
                continue
            if fenced or not line.startswith("- "):
                continue
            if out and out[-1][2] is None:
                out[-1][2] = j
            m = FIELD_RE.match(line)
            if m:
                out.append([m.group(1).strip(), j, None])
        if out and out[-1][2] is None:
            out[-1][2] = end
        for f in out:
            while f[2] > f[1] + 1 and not self.lines[f[2] - 1].strip():
                f[2] -= 1
        return [tuple(f) for f in out]

    def value(self, it, name):
        """[text of each field of this name] in the item, each on one line without its label."""
        out = []
        for field, s, e in it["fields"]:
            if field == name:
                first = FIELD_RE.match(self.lines[s]).group(2)
                out.append(" ".join([first] + [l.strip() for l in self.lines[s + 1:e] if l.strip()]).strip())
        return out

    def _item(self, it):
        label = f"Work item {it['n']} {it['title']}"
        fors = self.value(it, "For")
        if len(fors) != 1:
            self.problems.append(f"{label} has no '- For:' field" if not fors else f"{label} has {len(fors)} '- For:' fields, not one")
        elif not fors[0]:
            self.problems.append(f"{label}: '- For:' is empty")
        it["for"] = fors[0] if fors else ""
        after = self.value(it, "After")
        if not after:
            self.problems.append(f"{label} has no '- After:' field (the work items it waits on, or 'nothing')")
        it["after"] = sorted({int(x) for x in REF_RE.findall(" ".join(after))})
        if after and not it["after"] and not re.match(r"^(nothing|none)\b", after[0], re.I):
            self.problems.append(f"{label}: '- After:' names no 'Work item <n>' and is not 'nothing'")
        it["with"] = sorted({int(x) for x in REF_RE.findall(" ".join(self.value(it, "Runs with")))})
        it["done_when"] = {int(x) for x in re.findall(r"\bRung (\d+)\b", " ".join(self.value(it, "Done when")))}

    def _links(self):
        """What holds between items, and between the work and the ladder."""
        by_n = {it["n"]: it for it in self.items}
        for it in self.items:
            label = f"Work item {it['n']} {it['title']}"
            for field, refs in (("After", it["after"]), ("Runs with", it["with"])):
                for r in refs:
                    if r not in by_n or r == it["n"]:
                        self.problems.append(f"{label}: '- {field}:' names Work item {r}, which is not another item of this plan")
            for r in sorted(set(it["after"]) & set(it["with"])):
                self.problems.append(f"{label} both waits on and runs with Work item {r}: an item that waits on another does not run beside it")
            if self.rungs and it["who"].lower() == "builder" and not it["done_when"] & set(self.rungs):
                self.problems.append(f"{label}: '- Done when:' names no rung of the ladder; say which rung this builder must pass")
        if self.done in self.rungs and self.items and not any(self.done in it["done_when"] for it in self.items):
            self.problems.append(f"'Done means: Rung {self.done}.' but no work item's '- Done when:' names Rung {self.done}: name it in the item that runs it, so the plan cannot close before that rung ran")

        level = {}

        def depth(n, seen):
            if n not in level:
                if n in seen:
                    raise ValueError(n)
                deps = [d for d in by_n[n]["after"] if d in by_n and d != n]
                level[n] = 1 + max((depth(d, seen | {n}) for d in deps), default=-1)
            return level[n]

        try:
            for n in by_n:
                by_n[n]["level"] = depth(n, set())
        except ValueError as loop:
            self.problems.append(f"'- After:' fields wait in a circle through Work item {loop.args[0]}")


class Plan:
    """One plan file as lines; reads its first lines and Progress section, writes only those."""

    def __init__(self, path):
        self.path = Path(path)
        self.name = self.path.resolve().parent.name if self.path.name == "plan.md" else self.path.stem
        self.text = self.path.read_text(encoding="utf-8")  # OSError, UnicodeDecodeError: the caller's
        self.lines = self.text.split("\n")

    # -- structure -------------------------------------------------------------

    def _unfenced(self):
        """Yield (index, line) of every line outside code fences."""
        fenced = False
        for i, line in enumerate(self.lines):
            if FENCE_RE.match(line):
                fenced = not fenced
                continue
            if not fenced:
                yield i, line

    def _head(self):
        """(title index, end index) of the first lines' region, or None without a title."""
        title = None
        for i, line in self._unfenced():
            if title is None:
                if line.startswith("# "):
                    title = i
            elif line.startswith("## "):
                return title, i
        return None if title is None else (title, len(self.lines))

    def _keys(self):
        """{key: (index, value)} for the first occurrence of each first-line key."""
        head, out = self._head(), {}
        if head is None:
            return out
        for i in range(head[0] + 1, head[1]):
            m = KEY_RE.match(self.lines[i])
            if m and m.group(1) not in out:
                out[m.group(1)] = (i, m.group(2))
        return out

    def first(self, key):
        hit = self._keys().get(key)
        return None if hit is None else hit[1]

    def _section(self, title):
        """(heading index, end index) of a "## <title>" section outside fences, or None."""
        return sections(self.lines)[0].get(title[3:].strip())

    # -- reading ---------------------------------------------------------------

    def phase(self):
        """(phase, sentence) or None when the Phase line is missing or not one of the five."""
        value = self.first("Phase")
        m = PHASE_RE.match(value) if value is not None else None
        return None if m is None else (m.group(1), m.group(2) or "")

    def waiting(self):
        """(who, what for) or None."""
        value = self.first("Waiting on")
        if not value:
            return None
        who, _, what = value.partition(":")
        return who.strip(), what.strip()

    def held_by(self):
        value = self.first("Held by")
        return value if value and valid_session(value) else None

    def work_items(self):
        """Work item numbers from the "### Work item <n>" headings, in order, once each."""
        seen = []
        for _, line in self._unfenced():
            m = HEADING_RE.match(line)
            if m and int(m.group(1)) not in seen:
                seen.append(int(m.group(1)))
        return seen

    def progress(self):
        """[(index, n, state or None, note)] of the Progress section's item lines, or None without one."""
        sec = self._section(PROGRESS)
        if sec is None:
            return None
        out = []
        for i in range(sec[0] + 1, sec[1]):
            m = ITEM_RE.match(self.lines[i])
            if m:
                s = STATE_RE.match(m.group(2))
                out.append((i, int(m.group(1)), s.group(1) if s else None, (s.group(2) or "") if s else m.group(2)))
        return out

    def counts(self):
        """(done, total) from the Progress section, or None when it has no item lines."""
        items = self.progress()
        if not items:
            return None
        return sum(1 for _, _, state, _ in items if state == "done"), len(items)

    # -- writing ---------------------------------------------------------------

    def set_first(self, key, value):
        line = f"{key}: {value}".rstrip()
        keys = self._keys()
        if key in keys:
            self.lines[keys[key][0]] = line
            return
        head = self._head()
        if head is None:
            raise Unusable(f"{self.path} has no '# ' title, so it has no first lines")
        title, end = head
        if keys:
            pos = max(i for i, _ in keys.values()) + 1
            new = [line, ""] if pos < len(self.lines) and self.lines[pos].startswith("## ") else [line]
        else:
            pos = title + 1
            while pos < end and not self.lines[pos].strip():
                pos += 1
            # Right under the title, keep the blank line after it; with nothing but blanks before the
            # first section, keep one before that section's heading.
            new = ([""] if pos == title + 1 else []) + [line] + ([""] if pos == end else [])
        self.lines[pos:pos] = new

    def drop_first(self, key):
        keys = self._keys()
        if key in keys:
            del self.lines[keys[key][0]]

    def fill_progress(self):
        """Make the Progress section mirror the work item headings; return (numbers added, numbers removed)."""
        numbers = self.work_items()
        if not numbers:
            raise Refused('the file has no "### Work item <n>" heading')
        if self._section(PROGRESS) is None:
            self._add_progress_section()
        have = {n: i for i, n, _, _ in self.progress()}
        added = []
        for n in numbers:
            if n in have:
                continue
            items = self.progress()
            line = f"- Work item {n}: not started."
            later = [i for i, m, _, _ in items if m > n]
            if later:
                self.lines.insert(min(later), line)
            elif items:
                self.lines.insert(items[-1][0] + 1, line)
            else:
                start, end = self._section(PROGRESS)
                pos = start + 1
                while pos < end and not self.lines[pos].strip():
                    pos += 1
                if pos == end:  # an empty section: one blank line on each side of the list
                    self.lines[start + 1:end] = ["", line, ""]
                else:  # text of someone else's under the heading: the list goes above it
                    self.lines[pos:pos] = ([""] if pos == start + 1 else []) + [line, ""]
            added.append(n)
        # A work item taken out of the plan takes its line with it, whatever its state.
        gone = [(i, n) for i, n, _, _ in self.progress() if n not in numbers]
        for i, _ in sorted(gone, reverse=True):
            del self.lines[i]
        return added, [n for _, n in gone]

    def _add_progress_section(self):
        """Place a new Progress section before the "## " section that holds the first work item."""
        first_item, last_h2 = None, None
        for i, line in self._unfenced():
            if line.startswith("## "):
                last_h2 = i
            if HEADING_RE.match(line):
                first_item = i
                break
        if first_item is not None and last_h2 is not None and last_h2 < first_item:
            self.lines[last_h2:last_h2] = [PROGRESS, ""]
        else:
            while self.lines and not self.lines[-1].strip():
                self.lines.pop()
            self.lines += ["", PROGRESS, ""]

    def set_item(self, n, state, note):
        for i, m, _, _ in self.progress() or []:
            if m == n:
                self.lines[i] = f"- Work item {n}: {state}." + (f" {note}" if note else "")
                return
        raise Refused(f"no Progress line for work item {n}: run plans.py progress first")

    def save(self):
        text = "\n".join(self.lines)
        tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as err:
            tmp.unlink(missing_ok=True)
            raise Unusable(f"cannot write {self.path}: {err.strerror}")


# -- every plan ----------------------------------------------------------------


def all_plans():
    """[(path, Plan or None, reason)] for every <plans>/*/plan.md; None with a reason when unreadable."""
    out = []
    try:
        paths = sorted(plans_root().glob("*/plan.md"))
    except OSError:
        return out
    for path in paths:
        try:
            out.append((path, Plan(path), ""))
        except (OSError, UnicodeDecodeError):
            out.append((path, None, "cannot be read"))
    return out


def mtime(path):
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def latest_held(session):
    """The Plan that session holds and wrote to last, or None. Ties go to the name, so it is stable."""
    if not valid_session(session):
        return None
    mine = [(mtime(path), plan.name, plan) for path, plan, _ in all_plans()
            if plan is not None and plan.held_by() == session and valid_name(plan.name)]
    return max(mine, key=lambda t: (t[0], t[1]))[2] if mine else None


def sync_held(sessions):
    """Derive each session's held-name file from the plan files as they now stand."""
    for sid in sorted({s for s in sessions if valid_session(s)}):
        plan, path = latest_held(sid), held_dir() / sid
        try:
            if plan is None:
                path.unlink(missing_ok=True)
                continue
            want = plan.name + "\n"
            if not path.is_file() or path.read_text(encoding="utf-8") != want:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_name(f".{sid}.{os.getpid()}.tmp")
                tmp.write_text(want, encoding="utf-8")
                os.replace(tmp, path)
        except (OSError, UnicodeDecodeError) as err:
            print(f"plans.py: cannot update {path}: {err}", file=sys.stderr)


def write(plan, change, session=None):
    """Apply change(plan), save, and bring the held-name files of every touched session up to date."""
    before = plan.first("Held by")
    result = change(plan)
    plan.save()
    sync_held({before, plan.first("Held by"), session})
    return result


# -- commands that write -----------------------------------------------------------


def hold(plan, session, cwd=None):
    """Write Held by for session, and Repository for cwd's repository when the file names none (absent session: Repository only)."""
    if not valid_name(plan.name):
        raise Refused(f'"{plan.name}" does not fit: {NAME_RULE}')

    def change(p):
        # A plan belongs to the repository it was first held in: taking it over from another one must not move it.
        if not p.first("Repository"):
            p.set_first("Repository", repository(cwd))
        if session:
            p.set_first("Held by", session)

    write(plan, change, session)


def cmd_hold(plan, args, session):
    if args:
        raise Unusable("hold takes only the plan file")
    if not valid_session(session):
        raise Unusable("hold needs the session: $CLAUDE_CODE_SESSION_ID or --session <id>")
    previous = plan.held_by()
    hold(plan, session)
    took = f", taken over from {previous}" if previous and previous != session else ""
    print(f"{plan.name}: held by {session}{took}; Repository: {plan.first('Repository')}")


def split_words(args, choices):
    """(choice, rest) when args start with one of choices, quoted or as separate words."""
    joined = " ".join(args).strip()
    for choice in sorted(choices, key=len, reverse=True):
        if joined == choice or joined.startswith(choice + " "):
            return choice, joined[len(choice):].strip()
    return None, joined


def cmd_phase(plan, args, session):
    phase, sentence = split_words(args, PHASES)
    if phase in ("done", "dropped"):
        raise Refused(f'"{phase}" goes through plans.py close, which checks the closing step')
    if phase is None:
        raise Unusable("phase takes grilling, awaiting approval or building, then an optional sentence")
    write(plan, lambda p: p.set_first("Phase", f"{phase}." + (f" {sentence}" if sentence else "")), session)
    print(f"{plan.name}: Phase: {plan.first('Phase')}")


WAIT_MAX = 24
WAIT_EXAMPLE = "Victor: the merge of #121"


def cmd_wait(plan, args, session):
    text = " ".join(args).strip()
    who, colon, what = text.partition(":")
    if not colon or not who.strip() or not what.strip():
        raise Unusable(f"wait takes <who or what>: <what for>, for example: {WAIT_EXAMPLE}")
    if len(what.strip()) > WAIT_MAX:
        raise Unusable(f"say what for in {WAIT_MAX} characters or fewer, as the status line shows it whole; for example: {WAIT_EXAMPLE}")
    write(plan, lambda p: p.set_first("Waiting on", f"{who.strip()}: {what.strip()}"), session)
    print(f"{plan.name}: Waiting on: {plan.first('Waiting on')}")


def cmd_go(plan, args, session):
    if args:
        raise Unusable("go takes only the plan file")
    if plan.first("Waiting on") is None:
        print(f"{plan.name}: waits on nothing")
        return
    write(plan, lambda p: p.drop_first("Waiting on"), session)
    print(f"{plan.name}: Waiting on removed")


def cmd_progress(plan, args, session):
    if args:
        raise Unusable("progress takes only the plan file")
    added, removed = write(plan, Plan.fill_progress, session)
    done, total = plan.counts()
    listed = lambda numbers: ", ".join(str(n) for n in numbers) if numbers else "none"
    print(f"{plan.name}: {total} work items, {done} done; added: {listed(added)}; removed: {listed(removed)}")


def cmd_item(plan, args, session):
    if not args or not args[0].isdigit():
        raise Unusable("item takes <n> <not started|under way|done> [note...]")
    n = int(args[0])
    state, note = split_words(args[1:], STATES)
    if state is None:
        raise Unusable("item takes <n> <not started|under way|done> [note...]")
    write(plan, lambda p: p.set_item(n, state, note), session)
    print(f"{plan.name}: Work item {n}: {state}." + (f" {note}" if note else ""))


def reviewer_reads(plan):
    """(plan reads, diff reads): the plan-* and diff-* folders under reviews/ that hold an answer.md."""
    reviews = plan.path.parent / "reviews"
    count = lambda pattern: sum(1 for d in reviews.glob(pattern) if (d / "answer.md").is_file())
    return count("plan-*"), count("diff-*")


def cmd_close(plan, args, session):
    end, sentence = split_words(args, ("done", "dropped"))
    if end is None or not sentence:
        raise Unusable("close takes <done|dropped> <sentence...>")
    reasons = []
    waiting = plan.first("Waiting on")
    if waiting is not None:
        reasons.append(f"it still waits on {waiting}: remove that with plans.py go once it has moved")
    items = plan.progress() or []
    if end == "done":
        states = {n: state for _, n, state, _ in items}
        # Only the work items the plan has now: a line left from one taken out does not hold it open.
        for n in plan.work_items():
            if n not in states:
                reasons.append(f"work item {n} has no Progress line")
            elif states[n] != "done":
                reasons.append(f"work item {n} is {states[n] or 'in no known state'}, not done")
    if reasons:
        raise Refused(*reasons)

    def change(p):
        p.set_first("Phase", f"{end}. {sentence}")
        p.drop_first("Held by")

    write(plan, change, session)
    total = len(plan.work_items())
    plan_reads, diff_reads = reviewer_reads(plan)
    print(f"{plan.name}: Phase: {plan.first('Phase')}")
    print(f"Stamp: {total} work items; {plan_reads + diff_reads} reviewer reads ({plan_reads} of the plan, {diff_reads} of the diff).")
    print("Before you end this turn, write one visible line for each:")
    print("- Decisions: where they were recorded.")
    print("- The builders' suggestions: where they were recorded.")
    print("- Worktrees and branches: which of the plan's were removed.")
    print("- The page: its final state.")
    print('- Left for Victor: what is his now, or "nothing".')
    if end == "dropped":
        print("Unmerged branches and worktrees stay until Victor says to delete them.")


# -- commands that only read -----------------------------------------------------------


def transcript(session):
    """(current name or None, last write time) from the session's transcript, or None without one."""
    for path in (Path.home() / ".claude" / "projects").glob(f"*/{session}.jsonl"):
        try:
            data = path.read_bytes()
            when = path.stat().st_mtime
        except OSError:
            continue
        name, at = None, data.rfind(b'"type":"custom-title"')
        if at >= 0:
            start, stop = data.rfind(b"\n", 0, at) + 1, data.find(b"\n", at)
            try:
                record = json.loads(data[start:stop if stop >= 0 else len(data)])
                name = record.get("customTitle") or None
            except (ValueError, AttributeError):
                pass
        return name, when
    return None


def ago(seconds):
    seconds = max(0, int(seconds))
    if seconds < 60:
        return "just now"
    if seconds < 3600:
        return f"{seconds // 60} min ago"
    if seconds < 48 * 3600:
        return f"{seconds // 3600} h ago"
    return f"{seconds // 86400} d ago"


def holder_text(plan, session, now):
    held = plan.held_by()
    if held is None:
        return "held by no session"
    if held == session:
        return "held by this session"
    seen = transcript(held)
    if seen is None:
        return f"held by another session ({held[:8]})"
    name, when = seen
    who = f'"{name}"' if name else held[:8]
    return f"held by another session ({who}, last wrote {ago(now - when)})"


def report_line(plan, session, now, repo_named=True):
    parts = [plan.name, plan.phase()[0]]
    counts = plan.counts()
    if counts:
        parts.append(f"{counts[0]} of {counts[1]} done")
    waiting = plan.first("Waiting on")
    if waiting:
        parts.append(f"waiting on {waiting}")
    parts.append(holder_text(plan, session, now))
    if not repo_named:
        parts.append("names no repository")
    page = plan.first("Page")
    if page:
        parts.append(page)
    return "- " + " · ".join(parts)


def report(session, cwd=None):
    repo, now = repository(cwd), time.time()
    here, elsewhere, unreadable = [], 0, {}
    for path, plan, reason in all_plans():
        name = path.parent.name
        if plan is None:
            unreadable.setdefault(reason, []).append(name)
            continue
        phase = plan.phase()
        if phase is None:
            why = "no Phase line" if plan.first("Phase") is None else "Phase line not one of the five"
            unreadable.setdefault(why, []).append(name)
            continue
        if phase[0] not in OPEN_PHASES:
            continue
        named = plan.first("Repository")
        if not named:
            here.append(report_line(plan, session, now, repo_named=False))
        elif os.path.realpath(named) == repo:
            here.append(report_line(plan, session, now))
        else:
            elsewhere += 1
    lines = ["<cc-crew-plans>"]
    lines += [f"Plans under way in {repo}:"] + here if here else [f"No plan under way in {repo}."]
    if elsewhere == 1:
        lines.append("1 plan under way in another repository.")
    elif elsewhere:
        lines.append(f"{elsewhere} plans under way in other repositories.")
    for why, names in sorted(unreadable.items()):
        lines.append(f"Not readable ({why}): {', '.join(names)}.")
    lines.append("</cc-crew-plans>")
    return "\n".join(lines)


# The badge shares a status line row that cuts what does not fit, so every part of it is short:
# kinds and counts, never free text a model wrote.
BADGE_PHASES = {"grilling": "🔥", "awaiting approval": "👀", "building": "🔨"}
TURN_OVER = ("end_turn", "stop_sequence", "max_tokens")
# Tools that hold the turn on Victor's answer while they run.
ASKS = {"AskUserQuestion": "question", "ExitPlanMode": "plan approval"}
DOING = {"Bash": "shell", "Read": "reading", "Grep": "reading", "Glob": "reading", "Edit": "editing", "Write": "editing",
         "NotebookEdit": "editing", "WebFetch": "web", "WebSearch": "web", "Skill": "skill", "Monitor": "monitor"}


def turns_dir():
    return Path.home() / ".claude" / ".cc-crew" / "turns"


def stamp(entry):
    """A transcript entry's time in epoch seconds, or None."""
    try:
        return datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00")).timestamp()
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def short_agent(kind):
    """cc-crew:builder -> builder."""
    return (kind or "agent").rsplit(":", 1)[-1]


def doing(tool):
    """What a running tool_use block says the session is doing, as one or two words."""
    name, given = tool.get("name") or "", tool.get("input") or {}
    if name in ("Agent", "Task"):
        return short_agent(given.get("subagent_type"))
    if name.startswith("mcp__"):
        return name.split("__")[1]
    return DOING.get(name, name.lower() or "working")


def turn_over(entry):
    """True when this entry ends the session's turn, False when it shows the turn running, None when it says neither."""
    kind = entry.get("type")
    if kind == "system":
        return True if entry.get("subtype") in ("stop_hook_summary", "turn_duration") else None
    if kind == "assistant":
        return (entry.get("message") or {}).get("stop_reason") in TURN_OVER
    if kind == "user" and not entry.get("isMeta"):
        return "[Request interrupted by user" in json.dumps((entry.get("message") or {}).get("content"))
    return None


def session_state(transcript):
    """What the transcript says, read from the end so a long one costs only its tail: a dict with
    answered: epoch seconds of Victor's last typed prompt or AskUserQuestion answer (0.0 when none);
    title: the session's current name or None; over: whether its turn is over (None when it does not say);
    last: the epoch seconds of the last user or assistant entry; tools: the tool_use blocks of the last
    entry when it is an assistant's, which are what the turn is running."""
    state = {"answered": None, "title": None, "over": None, "last": None, "tools": None}
    try:
        with open(transcript, "rb") as fh:
            end = fh.seek(0, os.SEEK_END)
            carry = b""
            while end > 0 and None in state.values():
                start = max(0, end - (1 << 20))
                fh.seek(start)
                lines = (fh.read(end - start) + carry).split(b"\n")
                carry = lines.pop(0) if start else b""
                for raw in reversed(lines):
                    talk = b'"type":"user"' in raw or b'"type":"assistant"' in raw
                    if not ((state["title"] is None and b'"type":"custom-title"' in raw)
                            or (talk and (state["answered"] is None or state["last"] is None or state["tools"] is None))
                            or (state["over"] is None and (talk or b'"type":"system"' in raw))):
                        continue
                    try:
                        entry = json.loads(raw)
                    except ValueError:
                        continue
                    kind = entry.get("type")
                    if state["title"] is None and kind == "custom-title":
                        state["title"] = entry.get("customTitle") or ""
                    if state["over"] is None:
                        state["over"] = turn_over(entry)
                    if kind not in ("user", "assistant") or entry.get("isMeta"):
                        continue
                    if state["last"] is None:
                        state["last"] = stamp(entry) or 0.0
                    if state["tools"] is None:
                        content = (entry.get("message") or {}).get("content")
                        state["tools"] = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"] \
                            if kind == "assistant" and isinstance(content, list) else []
                    if state["answered"] is None and kind == "user":
                        origin, result = entry.get("origin"), entry.get("toolUseResult")
                        if (isinstance(origin, dict) and origin.get("kind") == "human") or (
                                isinstance(result, dict) and "answers" in result):
                            state["answered"] = stamp(entry) or 0.0
                    if None not in state.values():
                        break
                end = start
    except OSError:
        pass
    state["answered"] = state["answered"] or 0.0
    state["title"] = state["title"] or None
    return state


def armed_watches(session):
    """Names of the job watches this session has armed with cc-quiet-watch, from the mod's store.
    Trackers are left out: they run until Victor stops them, so the session does not wait on them."""
    names = []
    for store in sorted((Path.home() / ".claude" / "plugins" / "store").glob("cc-quiet-watch_*.json")):
        try:
            watches = json.loads(store.read_text(encoding="utf-8")).get(f"watches:{session}") or []
            names += [w["name"] for w in watches if not w.get("keep")]
        except (OSError, ValueError, AttributeError, TypeError, KeyError):
            continue
    return names


def turn_end(hook_input):
    """Record what the session's Stop hook says is still out when its turn ends: background tasks and wakeups.
    Kinds only, never their descriptions, which the badge has no room for."""
    data = json.loads(hook_input)
    session = data.get("session_id") or ""
    if not valid_session(session):
        return
    tasks = [{"type": t.get("type") or "task", "agent": t.get("agent_type")} for t in data.get("background_tasks") or []
             if isinstance(t, dict)]
    crons = [{"recurring": bool(c.get("recurring"))} for c in data.get("session_crons") or [] if isinstance(c, dict)]
    path = turns_dir() / f"{session}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{session}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"tasks": tasks, "crons": crons}), encoding="utf-8")
    os.replace(tmp, path)


def turn_record(session, last):
    """The Stop hook's record of this session's last turn end, or None when there is none written since the
    transcript's last user or assistant entry: an interrupted turn, a restart or a hook not loaded yet."""
    path = turns_dir() / f"{session}.json"
    if not valid_session(session) or last is None or mtime(path) < last:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def counted(labels):
    """['builder', 'shell', 'shell'] -> ['builder', '2 shells'], in first-seen order."""
    seen = {}
    for label in labels:
        seen[label] = seen.get(label, 0) + 1
    return [label if n == 1 else f"{n} {label}s" for label, n in seen.items()]


def waits(session, record):
    """What a session whose turn is over waits on, from the Stop record and cc-quiet-watch's store."""
    items = []
    if record:
        items += counted(short_agent(t.get("agent")) if t.get("type") == "subagent" else t.get("type") or "task"
                         for t in record.get("tasks") or [])
    items += armed_watches(session)
    if record:
        items += counted("loop" if c.get("recurring") else "wakeup" for c in record.get("crons") or [])
    return items


def status(session, s, plan):
    """What the session is doing now, from its transcript's state s, as the badge's last part. It starts
    with ✋ exactly when the move is Victor's, so badge.sh can color it."""
    waiting = plan.waiting() if plan is not None else None
    on_victor = bool(waiting and waiting[0].lower() == "victor" and waiting[1])
    # The chief clears a wait only when it gets to it, often at the end of its turn: once Victor has
    # answered since the plan was last written, the wait is his no longer.
    if on_victor and s["answered"] < mtime(plan.path):
        return f"✋ {waiting[1]}"
    if s["over"] is False:
        asks = [ASKS[t.get("name")] for t in s["tools"] or [] if t.get("name") in ASKS]
        if asks:
            return f"✋ {asks[0]}"
        return "⚙ " + (doing(s["tools"][-1]) if s["tools"] else "thinking")
    if not s["over"]:
        return ""
    items = [f"{waiting[0]}: {waiting[1]}"] if waiting and not on_victor else []
    items += waits(session, turn_record(session, s["last"]))
    if not items:
        return "💤 idle"
    return "⏳ " + ", ".join(items[:2]) + (f" +{len(items) - 2}" if len(items) > 2 else "")


def badge(session, transcript=None):
    """The plan the session holds, where it stands, and what the session is doing now, each part after " · "."""
    plan = latest_held(session)
    s = session_state(transcript) if transcript else {"answered": 0.0, "title": None, "over": None, "last": None, "tools": None}
    parts = []
    if plan is not None:
        # The session's name already shows the plan's name when cc-autotitle named the session after it.
        if s["title"] != plan.name:
            parts.append(plan.name)
        phase, counts = plan.phase(), plan.counts()
        if phase:
            parts.append(BADGE_PHASES.get(phase[0], phase[0]) + (f" {counts[0]}/{counts[1]}" if counts else ""))
    now = status(session, s, plan)
    if now:
        parts.append(now)
    return "".join(f" · {p}" for p in parts)


# -- entry ---------------------------------------------------------------------

WRITERS = {
    "hold": cmd_hold, "phase": cmd_phase, "wait": cmd_wait, "go": cmd_go,
    "progress": cmd_progress, "item": cmd_item, "close": cmd_close,
}
USAGE = __doc__.split("\n\n")[1]


def main(argv):
    args, session = list(argv[1:]), os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if "--session" in args:
        at = args.index("--session")
        if at + 1 >= len(args):
            print(USAGE, file=sys.stderr)
            return 2
        session = args[at + 1]
        del args[at:at + 2]
    session = session.strip()
    if not args:
        print(USAGE, file=sys.stderr)
        return 2
    command, rest = args[0], args[1:]
    try:
        if command == "report" and not rest:
            print(report(session))
            return 0
        if command == "turn-end" and not rest:
            turn_end(sys.stdin.read())
            return 0
        if command == "badge" and len(rest) in (1, 2):
            out = badge(*rest)
            if out:
                sys.stdout.write(out)
            return 0
        if command in WRITERS and rest:
            try:
                plan = Plan(rest[0])
            except (OSError, UnicodeDecodeError) as err:
                raise Unusable(f"cannot read {rest[0]}: {getattr(err, 'strerror', None) or err}")
            WRITERS[command](plan, rest[1:], session)
            return 0
    except Refused as refused:
        for reason in refused.reasons:
            print(f"plans.py: refused: {reason}", file=sys.stderr)
        return 1
    except Unusable as err:
        print(f"plans.py: {err}", file=sys.stderr)
        return 2
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv))
