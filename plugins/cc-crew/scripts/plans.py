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
  plans.py badge <session id>

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
    """The main checkout's folder for cwd: the parent of git's common dir, or cwd outside git."""
    cwd = cwd or os.getcwd()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=cwd, capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return os.path.realpath(os.path.dirname(out.stdout.strip().rstrip("/")))
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.realpath(cwd)


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
        start = None
        for i, line in self._unfenced():
            if start is None:
                if line.rstrip() == title:
                    start = i
            elif line.startswith("## "):
                return start, i
        return None if start is None else (start, len(self.lines))

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
    """Write Repository for cwd's repository and Held by for session (absent session: Repository only)."""
    if not valid_name(plan.name):
        raise Refused(f'"{plan.name}" does not fit: {NAME_RULE}')

    def change(p):
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


def cmd_wait(plan, args, session):
    text = " ".join(args).strip()
    who, colon, what = text.partition(":")
    if not colon or not who.strip() or not what.strip():
        raise Unusable("wait takes <who or what>: <what for>, for example: Victor: the merge of pull request 121")
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


def badge(session):
    plan = latest_held(session)
    if plan is None:
        return ""
    parts = [plan.name]
    phase, counts = plan.phase(), plan.counts()
    if phase:
        parts.append(phase[0] + (f" {counts[0]}/{counts[1]}" if counts else ""))
    waiting = plan.waiting()
    if waiting and waiting[0].lower() == "victor" and waiting[1]:
        parts.append(f"waiting on you: {waiting[1]}")
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
        if command == "badge" and len(rest) == 1:
            out = badge(rest[0])
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
