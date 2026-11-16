#!/usr/bin/env python3
"""Make a plan's page: fill the crew's page skeleton from the plan file and its page/ folder.

Usage: page.py <plan.md>

Reads ../page-skeleton.html, the plan file, and page/look.css, page/picture.html, page/new.html
and, when the plan has its own parts, page/own.html, all beside the plan file. Writes page.html
beside the plan file and prints its path. The plan file is only read: plans.py alone writes it.

The page holds the top and nine parts. In the phases grilling and awaiting approval they stand in
the first order, every part open but the record; in building and done, in the second order, the
parts already read folded. A dropped plan takes the second order when its sign-off holds an
Approved line.

Exits 0 when it wrote the page, 1 when it refuses (it names every missing piece and writes
nothing), 2 on bad usage or a skeleton it cannot use.
"""
import datetime
import html
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKELETON = HERE.parent / "page-skeleton.html"
sys.path.insert(0, str(HERE.parents[2] / "scripts"))
from plans import FENCE_RE, PHASES, Plan, headings, sections  # noqa: E402  (the readers of a plan file, shared)

FIRST = ("picture", "new", "work", "ladder", "own", "approval", "signoff", "words", "record")
SECOND = ("work", "new", "ladder", "own", "picture", "approval", "signoff", "words", "record")
OPEN_IN_SECOND = {"work", "new", "ladder"}
FOLDED_IN_FIRST = {"record"}  # decisions he settled himself
NAMES = {
    "picture": "The whole, in one picture", "new": "New since we talked", "work": "The work",
    "ladder": "The ladder", "approval": "What your approval starts", "signoff": "Sign-off",
    "words": "The words", "record": "The record",
}
SECTIONS = ("Principle", "The ladder", "Work", 'What "approved" starts', "Sign-off", "Terms", "Decisions")
PIECES = ("look.css", "picture.html", "new.html")

LIST_RE = re.compile(r"^( *)([-*+]|\d+[.)])\s+(.*)$")
TOP_ITEM_RE = re.compile(r"^[-*+]\s+")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
ITEM_RE = re.compile(r"^### Work item (\d+)\s+(.*?)\s*\(([^()]*)\)\s*$")
FIELD_RE = re.compile(r"^- ([A-Z][^:\n]*?):\s*(.*)$")
RUNG_RE = re.compile(r"^[-*+]\s+Rung\s+(\d+)\s+(.*)$")
FACTS = ("Runs", "Mocks or skips", "Cannot tell", "Time and cost", "Built by")
FACT_RE = re.compile(r"^[-*+]\s+(%s):\s*(.*)$" % "|".join(FACTS))
DONE_RE = re.compile(r"^Done means:\s*Rung\s+(\d+)\.?\s*$")
SIGNED_RE = re.compile(r"^- Signed:\s*(.+?),\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\.?\s*$")
APPROVED_RE = re.compile(r"^- Approved:\s*(.+?),\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\.?\s*(.*?)\s*$")
TERM_RE = re.compile(r"^\*\*(.+?)\*\*\s*(.*)$", re.S)
SLOT_RE = re.compile(r"\{\{(\w+)\}\}")
ROOT_SEL_RE = re.compile(r"^:root(\[[^\]]*\]|:not\(\[[^\]]*\]\))*$")


class Refused(Exception):
    def __init__(self, reasons):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


class Unusable(Exception):
    """Bad usage, or a skeleton the script cannot fill."""


def esc(text):
    return html.escape(text, quote=True)


# -- Markdown --------------------------------------------------------------------
# What it cannot turn (a table, an indented block) is shown as plain text, never dropped.

CODE_RE = re.compile(r"(`+)(.+?)(?<!`)\1(?!`)", re.S)
BOLD_RE = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*")
ITALIC_RE = re.compile(r"(?<![*\w])\*(?=[^\s*])([^*]+?)(?<=\S)\*(?![*\w])")
LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def inline(text):
    out, at = [], 0
    for m in CODE_RE.finditer(text):
        out.append(emphasis(text[at:m.start()]))
        out.append(f"<code>{esc(m.group(2).strip())}</code>")
        at = m.end()
    out.append(emphasis(text[at:]))
    return "".join(out)


def emphasis(text):
    s = esc(text)
    s = LINK_RE.sub(r'<a href="\2">\1</a>', s)
    s = BOLD_RE.sub(r"<b>\1</b>", s)
    return ITALIC_RE.sub(r"<i>\1</i>", s)


def indent(line):
    return len(line) - len(line.lstrip(" "))


def dedent(lines):
    cut = min((indent(l) for l in lines if l.strip()), default=0)
    return [l[cut:] for l in lines]


def starts_block(line):
    s = line.lstrip()
    return bool(FENCE_RE.match(line) or HEADING_RE.match(line) or LIST_RE.match(line)
                or s.startswith(">") or s.startswith("|") or (line.startswith("    ") and s))


def list_end(lines, i):
    """Index just past the list that starts at line i."""
    base, j = indent(lines[i]), i + 1
    while j < len(lines):
        line = lines[j]
        if not line.strip():
            k = next((k for k in range(j, len(lines)) if lines[k].strip()), None)
            if k is None or not (indent(lines[k]) > base or (LIST_RE.match(lines[k]) and indent(lines[k]) == base)):
                return j
            j = k
        elif indent(line) > base or (LIST_RE.match(line) and indent(line) == base):
            j += 1
        elif not starts_block(line):  # a lazy continuation of the item above
            j += 1
        else:
            return j
    return j


def render_list(lines):
    base = indent(lines[0])
    ordered = lines[0].strip()[0].isdigit()
    items = []
    for line in lines:
        m = LIST_RE.match(line)
        if m and indent(line) == base:
            items.append([m.group(3)])
        else:
            items[-1].append(line)
    out = []
    for first, *rest in items:
        body = md([first] + dedent(rest))
        if body.count("<p>") == 1 and body.startswith("<p>") and body.endswith("</p>"):
            body = body[3:-4]
        out.append(f"<li>{body}</li>")
    tag = "ol" if ordered else "ul"
    return f"<{tag}>{''.join(out)}</{tag}>"


def md(lines):
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
        elif FENCE_RE.match(line):
            mark, j = FENCE_RE.match(line).group(1), i + 1
            while j < n and not lines[j].strip().startswith(mark):
                j += 1
            out.append(f"<pre><code>{esc(chr(10).join(lines[i + 1:j]))}</code></pre>")
            i = j + 1
        elif HEADING_RE.match(line):
            m = HEADING_RE.match(line)
            level = 3 if len(m.group(1)) <= 3 else 4
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            i += 1
        elif LIST_RE.match(line) and indent(line) <= 3:
            j = list_end(lines, i)
            out.append(render_list(lines[i:j]))
            i = j
        elif line.lstrip().startswith(">"):
            j = i
            while j < n and lines[j].lstrip().startswith(">"):
                j += 1
            quoted = [re.sub(r"^\s*>\s?", "", l) for l in lines[i:j]]
            out.append(f"<blockquote>{md(quoted)}</blockquote>")
            i = j
        elif starts_block(line):  # a table or an indented block: plain text
            j = i
            while j < n and lines[j].strip() and (lines[j].lstrip().startswith("|") or lines[j].startswith("    ")):
                j += 1
            j = max(j, i + 1)
            out.append(f'<pre class="raw">{esc(chr(10).join(lines[i:j]))}</pre>')
            i = j
        else:
            j = i + 1
            while j < n and lines[j].strip() and not starts_block(lines[j]):
                j += 1
            out.append(f"<p>{inline(' '.join(l.strip() for l in lines[i:j]))}</p>")
            i = j
    return "".join(out)


def md_block(lines):
    body = md(lines)
    return f'<div class="md">{body}</div>' if body else ""


def chunks(lines):
    """Split a section into ("item", lines) for each top-level list item and ("text", lines) between."""
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


# -- the plan file ---------------------------------------------------------------


def fmt_time(stamp):
    d = datetime.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
    return f"{d.day} {d:%b %Y, %H:%M}"


def render_work(lines, progress, problems):
    hs = headings(lines, 3)  # outside code fences: a brief may hold a fenced example with headings
    intro, items = lines[:hs[0][0]] if hs else lines, []
    for k, (i, _) in enumerate(hs):
        m = ITEM_RE.match(lines[i])
        if not m:
            problems.append(f"'## Work': the heading '{lines[i].strip()}' is not '### Work item <n> <title> (<who>)'")
            continue
        end = hs[k + 1][0] if k + 1 < len(hs) else len(lines)
        items.append({"n": int(m.group(1)), "title": m.group(2), "who": m.group(3).strip(), "body": lines[i + 1:end]})
    if not items:
        problems.append("'## Work' has no '### Work item <n> <title> (<who>)'")
        return ""
    numbers = [it["n"] for it in items]
    for n in {n for n in numbers if numbers.count(n) > 1}:
        problems.append(f"'## Work' has Work item {n} twice")

    for it in items:
        fields, name, fenced = {}, None, False
        for line in it["body"]:
            if FENCE_RE.match(line):
                fenced = not fenced
            m = None if fenced else FIELD_RE.match(line)
            if m:
                name = m.group(1).strip()
                fields.setdefault(name, []).append(m.group(2))
            elif not fenced and line.startswith("- "):
                name = None
            elif name is not None and line.strip():
                fields[name].append(line.strip())
        label = f"Work item {it['n']}"
        if "For" not in fields:
            problems.append(f"{label} has no '- For:' field")
        it["for"] = " ".join(fields.get("For", [])).strip()
        if "For" in fields and not it["for"]:
            problems.append(f"{label}: '- For:' is empty")
        if "After" not in fields:
            problems.append(f"{label} has no '- After:' field (the work items it waits on, or 'nothing')")
        after = " ".join(fields.get("After", ["nothing"]))
        it["after"] = sorted({int(x) for x in re.findall(r"Work item (\d+)", after)})
        if "After" in fields and not it["after"] and not re.match(r"^(nothing|none)\b", after, re.I):
            problems.append(f"{label}: '- After:' names no 'Work item <n>' and is not 'nothing'")
        it["with"] = {int(x) for x in re.findall(r"Work item (\d+)", " ".join(fields.get("Runs with", [])))}
        for field, refs in (("After", it["after"]), ("Runs with", it["with"])):
            for r in refs:
                if r not in numbers or r == it["n"]:
                    problems.append(f"{label}: '- {field}:' names Work item {r}, which is not another item of this plan")

    states = {}
    if progress:  # no section, or one with no line yet (before approval): every item not started
        for _, n, state, note in progress:
            if n not in numbers:
                problems.append(f"'## Progress' has a line for Work item {n}, which '## Work' does not hold")
            elif state is None:
                problems.append(f"'## Progress': the line for Work item {n} is not 'not started', 'under way' or 'done'")
            else:
                states[n] = (state, note)
        for n in numbers:
            if n not in states:
                problems.append(f"'## Progress' has no line for Work item {n} (run plans.py progress)")

    by_n = {it["n"]: it for it in items}
    level = {}

    def depth(n, seen):
        if n in level:
            return level[n]
        if n in seen:
            raise ValueError(n)
        deps = [d for d in by_n[n]["after"] if d in by_n and d != n]
        level[n] = 1 + max((depth(d, seen | {n}) for d in deps), default=-1)
        return level[n]

    try:
        for n in by_n:
            depth(n, set())
    except ValueError as loop:
        problems.append(f"'- After:' fields wait in a circle through Work item {loop.args[0]}")
    if problems:
        return ""

    # Each card names what it runs with, whichever side wrote the link: items that run together
    # can stand in different stages, where no frame joins them.
    together = {n: sorted(by_n[n]["with"] | {o for o in by_n if n in by_n[o]["with"]}) for n in by_n}
    stages = []
    for k in range(max(level.values()) + 1):
        members = sorted(n for n in by_n if level[n] == k)
        groups, placed = [], set()
        for n in members:
            if n in placed:
                continue
            group, todo = [], [n]
            while todo:  # items that run together, directly or through one another
                m = todo.pop()
                if m in placed:
                    continue
                placed.add(m)
                group.append(m)
                todo += [o for o in members if o not in placed and (o in by_n[m]["with"] or m in by_n[o]["with"])]
            groups.append(sorted(group))
        rows = []
        for group in groups:
            cards = "".join(item_card(by_n[n], states.get(n, ("not started", "")), together[n]) for n in group)
            rows.append(f'<div class="group{" together" if len(group) > 1 else ""}">{cards}</div>')
        tag = "Waits on nothing" if k == 0 else "Then"
        stages.append(f'<div class="stage" data-stage="{k}"><span class="label">{tag}</span><div class="row">{"".join(rows)}</div></div>')
    gate = f'<div class="gate">{md_block(intro)}</div>' if any(l.strip() for l in intro) else ""
    return f'{gate}<div class="stages">{"".join(stages)}</div>'


def item_card(it, state, together):
    word, note = state
    cls = {"done": "s-done", "under way": "s-way"}.get(word, "s-idle")
    who = it["who"][:1].upper() + it["who"][1:]
    after = ", ".join(f"Work item {d}" for d in it["after"])
    beside = ", ".join(f"Work item {d}" for d in together)
    return (
        f'<div class="item {cls}" data-item="{it["n"]}" data-state="{esc(word)}">'
        f'<div class="meta"><span class="who">{esc(who)}</span><span class="state">{esc(word)}</span></div>'
        f'<span class="title">Work item {it["n"]} · {inline(it["title"])}</span>'
        f'<p class="for">For: {inline(it["for"])}</p>'
        + (f'<p class="after">Waits on {after}</p>' if after else "")
        + (f'<p class="with">Runs with {beside}</p>' if beside else "")
        + (f'<p class="note">{inline(note)}</p>' if note else "")
        + "</div>"
    )


def rung(ls, problems):
    """(n, name, {label: text}) of one "- Rung <n> <name>" item and its labelled sub-items, or None."""
    m = RUNG_RE.match(ls[0].strip())
    if not m:
        return None
    n, name = int(m.group(1)), m.group(2).strip().rstrip(":").strip()
    subs = [(kind, " ".join(l.strip() for l in sub if l.strip())) for kind, sub in chunks(dedent(ls[1:]))]
    subs = [(kind, text) for kind, text in subs if text]
    if not subs and ": " in name:  # a name may hold a colon; with no sub-item under it, it is the older shape
        problems.append(f"Rung {n} gives its facts in one line: give each as a sub-item under '- Rung {n} <name>', starting {', '.join(FACTS[:4])} or {FACTS[4]}, then ':'")
        return None
    facts = {}
    for kind, text in subs:
        f = FACT_RE.match(text) if kind == "item" else None
        if not f:
            problems.append(f"Rung {n}: '{text}' is not a sub-item starting {', '.join(FACTS)}, then ':'")
        elif f.group(1) in facts:
            problems.append(f"Rung {n} has '{f.group(1)}:' twice")
        elif not f.group(2).strip():
            problems.append(f"Rung {n}: '{f.group(1)}:' is empty")
        else:
            facts[f.group(1)] = f.group(2).strip()
    problems += [f"Rung {n} has no '{label}:' sub-item" for label in FACTS[:4] if label not in facts]
    return n, name, facts


def render_ladder(lines, problems):
    filled = [l.strip() for l in lines if l.strip()]
    if len(filled) == 1 and filled[0].startswith("None, because"):
        return f'<p class="none">{inline(filled[0])}</p>'
    intro, above, rungs = [], [], {}
    dones = [int(m.group(1)) for m in (DONE_RE.match(l.strip()) for l in lines) if m]
    done = dones[-1] if dones else None
    if len(dones) > 1:
        problems.append("'## The ladder' has more than one 'Done means:' line")
    lines = [l for l in lines if not DONE_RE.match(l.strip())]
    for kind, ls in chunks(lines):
        if kind == "item":
            found = rung(ls, problems)
            if found is None and RUNG_RE.match(ls[0].strip()):
                continue
            if found is None:
                above.append(item_text(ls))
            elif found[0] in rungs:
                problems.append(f"'## The ladder' has Rung {found[0]} twice")
            else:
                rungs[found[0]] = found[1:]
        else:
            intro.extend(ls)
    if not rungs:
        if not any(p.startswith("Rung ") for p in problems):
            problems.append("'## The ladder' has no '- Rung <n> <name>' item and is not the one line 'None, because <reason>.'")
        return ""
    if done is None:
        problems.append("'## The ladder' has no line 'Done means: Rung <n>.'")
    elif done not in rungs:
        problems.append(f"'## The ladder': 'Done means: Rung {done}.' names a rung the ladder does not have")
    out = [md_block(intro)]
    out += [f'<div class="above">{inline(a)}</div>' for a in above]
    steps = ['<div class="ground">Start here: the lowest rung</div>']
    for n in sorted(rungs):
        name, facts = rungs[n]
        sticker = '<span class="sticker">Done means this rung</span>' if n == done else ""
        dl = "".join(f"<div><dt>{label}</dt><dd>{inline(facts[label])}</dd></div>" for label in FACTS if label in facts)
        steps.append(
            f'<div class="rung{" done-means" if n == done else ""}" data-rung="{n}">'
            f'<div class="head"><h3>Rung {n} · {inline(name)}</h3>{sticker}</div><dl class="facts">{dl}</dl></div>'
        )
    out.append(f'<div class="ladder">{"".join(steps)}</div>')
    return "".join(out)


def render_signoff(lines, problems):
    before, after, signed, approved = [], [], None, None
    for kind, ls in chunks(lines):
        first = ls[0]
        if kind == "item" and first.startswith(("- Signed:", "- Approved:")):
            text = "- " + item_text(ls)
            m = (SIGNED_RE if first.startswith("- Signed:") else APPROVED_RE).match(text)
            if not m:
                shape = "- Signed: the chief engineer, <YYYY-MM-DD HH:MM>." if first.startswith("- Signed:") else '- Approved: <name>, <YYYY-MM-DD HH:MM>. "<his words>"'
                problems.append(f"'## Sign-off': the line '{first.strip()}' is not '{shape}'")
            elif (signed if first.startswith("- Signed:") else approved) is not None:
                problems.append(f"'## Sign-off' has a second '{first.split(':')[0]}:' line")
            elif first.startswith("- Signed:"):
                signed = m
            else:
                approved = m
        else:
            (after if signed or approved else before).extend(ls)
    if signed:
        chief = (f'<div class="sig" data-sig="signed"><span class="hand">{inline(signed.group(1))}</span>'
                 f'<b>Chief engineer</b><span class="label">signed {fmt_time(signed.group(2))}</span></div>')
    else:
        chief = '<div class="sig" data-sig="signed"><span class="empty">not signed yet</span><b>Chief engineer</b><span class="label">signs the plan</span></div>'
    if approved:
        words = approved.group(3).strip().strip('"“”').strip()
        quote = f"<q>{inline(words)}</q>" if words else ""
        victor = (f'<div class="sig" data-sig="approved"><span class="hand">{inline(approved.group(1))}</span>'
                  f'<b>Approved</b><span class="label">approved {fmt_time(approved.group(2))}</span>{quote}</div>')
    else:
        victor = '<div class="sig" data-sig="approved"><span class="empty">not approved yet</span><b>Approval</b><span class="label">approves the plan</span></div>'
    return f'{md_block(before)}<div class="sigs">{chief}{victor}</div>{md_block(after)}'


def render_terms(lines):
    intro, terms = [], []
    for kind, ls in chunks(lines):
        if kind != "item":
            intro.extend(ls)
            continue
        text = item_text(ls)
        m = TERM_RE.match(text)
        word, rest, source = (m.group(1), m.group(2), None) if m else (None, text, None)
        if m and rest.startswith("("):
            depth = 0
            for k, ch in enumerate(rest):
                depth += {"(": 1, ")": -1}.get(ch, 0)
                if depth == 0:
                    source, rest = rest[1:k], rest[k + 1:].lstrip()
                    break
        if word and rest.startswith(":"):
            frm = f'<span class="from">{inline(source)}</span>' if source else ""
            terms.append(f"<div><dt>{inline(word)}</dt><dd>{inline(rest[1:].strip())}{frm}</dd></div>")
        else:  # a term the script cannot take apart is shown whole
            terms.append(f"<div><dd>{inline(text)}</dd></div>")
    return md_block(intro) + (f'<dl class="words">{"".join(terms)}</dl>' if terms else "")


# -- the plan's own pieces -------------------------------------------------------


def declarations(block):
    """A rule's declarations: split on semicolons outside strings and parentheses (a data URL holds one)."""
    out, buf, quote, depth = [], "", None, 0
    for ch in block:
        if quote:
            quote = None if ch == quote else quote
        elif ch in "\"'":
            quote = ch
        elif ch in "()":
            depth = max(0, depth + (1 if ch == "(" else -1))
        elif ch == ";" and not depth:
            out.append(buf)
            buf = ""
            continue
        buf += ch
    return out + [buf]


def look_problems(css):
    """A look sets the skeleton's tokens on :root, and loads typefaces; nothing about layout."""
    css = re.sub(r"/\*.*?\*/", " ", css, flags=re.S)
    problems, stack, buf = [], [], ""

    def say(what):
        problems.append(f"page/look.css: {what}; a look only sets the skeleton's tokens on :root (colours, typefaces, --band, --heading-case) and imports from Google Fonts")

    quote, parens = None, 0
    for ch in css:
        # A Google Fonts URL holds semicolons: only those outside strings and url(...) end a statement.
        if quote or parens or ch in "\"'(":
            if quote:
                quote = None if ch == quote else quote
            elif ch in "\"'":
                quote = ch
            else:
                parens += {"(": 1, ")": -1}.get(ch, 0)
            buf += ch
        elif ch == "{":
            pre = " ".join(buf.split())
            buf = ""
            if pre.startswith("@media"):
                stack.append("media")
            elif pre.startswith("@font-face"):
                stack.append("face")
            elif pre.startswith("@"):
                say(f"'{pre}' is not allowed")
                stack.append("skip")
            elif all(ROOT_SEL_RE.match(s.strip()) for s in pre.split(",")):
                stack.append("root")
            else:
                say(f"the rule '{pre}' styles more than :root")
                stack.append("skip")
        elif ch == "}":
            kind = stack.pop() if stack else None
            if kind == "root":
                for decl in declarations(buf):
                    prop = decl.split(":", 1)[0].strip()
                    if prop and not prop.startswith("--") and prop != "color-scheme":
                        say(f"'{prop}' is not a token")
            buf = ""
        elif ch == ";" and not stack:
            stmt = " ".join(buf.split())
            buf = ""
            if not (stmt.startswith("@import") and "https://fonts.googleapis.com/" in stmt):
                say(f"'{stmt}' is not allowed")
        else:
            buf += ch
    return problems


def own_parts(text, problems):
    """[(heading html, body html)] from page/own.html, one part per <h2>."""
    pieces = re.split(r"(?=<h2\b)", text, flags=re.I)
    if pieces[0].strip():
        problems.append("page/own.html has text before its first <h2>: each own part starts with its own <h2> heading")
    out, taken = [], {v.lower() for v in NAMES.values()}
    for piece in pieces[1:]:
        m = re.match(r"(<h2\b[^>]*>(.*?)</h2>)(.*)$", piece, re.S | re.I)
        if not m:
            problems.append("page/own.html has an <h2> with no </h2>")
            continue
        name = " ".join(re.sub(r"<[^>]+>", "", m.group(2)).split())
        if not name:
            problems.append("page/own.html has an empty <h2>")
        elif name.lower() in taken:
            problems.append(f"page/own.html: the part '{name}' takes a name the page already has")
        taken.add(name.lower())
        if not m.group(3).strip():
            problems.append(f"page/own.html: the part '{name}' is empty")
        out.append((m.group(1), m.group(3).strip()))
    return out


# -- the page --------------------------------------------------------------------


def fill(template, values):
    """Fill {{slots}} in one pass, so a slot-like text in what is filled in stays as it is."""
    def one(m):
        if m.group(1) not in values:
            raise Unusable(f"{SKELETON}: unknown slot {{{{{m.group(1)}}}}}")
        return values[m.group(1)]
    return SLOT_RE.sub(one, template)


def build(plan_path):
    """The page's HTML; raises Refused with every reason when a part cannot be filled."""
    try:
        text = plan_path.read_text(encoding="utf-8")
        plan = Plan(plan_path)
    except (OSError, UnicodeDecodeError) as err:
        raise Refused([f"cannot read {plan_path}: {getattr(err, 'strerror', None) or err}"])
    lines = text.split("\n")
    head = []
    for line in lines[1:] if lines and lines[0].startswith("# ") else []:
        if line.startswith("## "):
            break
        head.append(line)
    if plan.first("Phase") is None and any(l.startswith("Status:") for l in head):
        raise Refused(["the plan file is in the older shape (a 'Status:' line, no 'Phase:' line): its page stays the hand-written one"])
    folder = plan_path.parent / "page"
    if not folder.is_dir():
        raise Refused([f"no page/ folder beside the plan file ({folder}): a plan without one keeps its hand-written page"])

    problems, pieces = [], {}
    for name in PIECES + ("own.html",):
        path = folder / name
        if not path.is_file():
            if name != "own.html":
                problems.append(f"page/{name} is missing")
            continue
        try:
            pieces[name] = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as err:
            problems.append(f"page/{name} cannot be read: {getattr(err, 'strerror', None) or err}")
            continue
        if not pieces[name].strip():
            problems.append(f"page/{name} is empty")
    if pieces.get("look.css", "").strip():
        problems += look_problems(pieces["look.css"])
    own = own_parts(pieces["own.html"], problems) if pieces.get("own.html", "").strip() else []

    title = lines[0][2:].strip() if lines and lines[0].startswith("# ") else ""
    if not title:
        problems.append("the plan file's first line is not its '# <name>' title")
    phase = plan.phase()
    if phase is None:
        problems.append(f"no 'Phase:' line with one of: {', '.join(PHASES)}")
    spans, twice = sections(lines)
    problems += [f"line {i + 1}: a second '## {t}' section" for i, t in twice]
    texts = {t: lines[a + 1:b] for t, (a, b) in spans.items()}
    unfilled = [f"no '## {need}' section" if need not in texts else f"'## {need}' is empty"
                for need in SECTIONS if not any(l.strip() for l in texts.get(need, []))]
    if unfilled or phase is None:
        raise Refused(problems + unfilled)

    bodies = {
        "work": render_work(texts["Work"], plan.progress(), problems),
        "ladder": render_ladder(texts["The ladder"], problems),
        "approval": md_block(texts['What "approved" starts']),
        "signoff": render_signoff(texts["Sign-off"], problems),
        "words": render_terms(texts["Terms"]),
        "record": md_block(texts["Decisions"]),
        "picture": pieces.get("picture.html", ""),
        "new": pieces.get("new.html", ""),
    }
    if problems:
        raise Refused(problems)

    word, sentence = phase
    approved = any(APPROVED_RE.match(l) for l in texts["Sign-off"])
    second = word in ("building", "done") or (word == "dropped" and approved)
    order = SECOND if second else FIRST

    try:
        skeleton = SKELETON.read_text(encoding="utf-8")
    except OSError as err:
        raise Unusable(f"cannot read the skeleton {SKELETON}: {err.strerror}")
    region = re.search(r"<!-- parts\b.*?-->\n(.*?)<!-- /parts -->", skeleton, re.S)
    if not region:
        raise Unusable(f"{SKELETON} has no '<!-- parts -->' ... '<!-- /parts -->' region")
    templates = dict(re.findall(r"<!-- part (\w+) -->\n(.*?)<!-- /part -->\n?", region.group(1), re.S))
    if set(templates) != set(FIRST):
        raise Unusable(f"{SKELETON} holds the parts {sorted(templates)}, not {sorted(FIRST)}")

    parts = []
    for key in order:
        folded = key not in OPEN_IN_SECOND if second else key in FOLDED_IN_FIRST
        opened = "" if folded else " open"
        if key == "own":
            parts += [fill(templates["own"], {"open": opened, "heading": h, "body": b}) for h, b in own]
        else:
            parts.append(fill(templates[key], {"open": opened, "body": bodies[key]}))

    waiting = plan.waiting()
    # The version shown is the last change of anything the page is made from, a piece included.
    sources = [plan_path] + [folder / name for name in pieces]
    mtime = datetime.datetime.fromtimestamp(max(p.stat().st_mtime for p in sources))
    top = {
        "name": esc(title),
        "folder": esc(plan_path.parent.name),
        "version": f"{mtime.day} {mtime:%b %Y, %H:%M}",
        "phase": esc(word),
        "order": "second" if second else "first",
        "where": inline(sentence),
        "waiting": f'<span class="waits">Waiting on <b>{inline(waiting[0])}</b>: {inline(waiting[1])}</span>' if waiting else "",
        "principle": inline(" ".join(l.strip() for l in texts["Principle"] if l.strip())),
        "look": pieces["look.css"],
    }
    a, b = region.span()
    return fill(skeleton[:a], top) + "".join(parts) + fill(skeleton[b:], top)


def main(argv):
    if len(argv) != 2 or argv[1].startswith("-"):
        print("usage: page.py <plan.md>", file=sys.stderr)
        return 2
    plan_path = Path(argv[1]).resolve()
    try:
        page = build(plan_path)
    except Refused as refused:
        for k, reason in enumerate(refused.reasons, 1):
            tail = "; no page written" if k == len(refused.reasons) else ""
            print(f"page.py: refused: {reason}{tail}", file=sys.stderr)
        return 1
    except Unusable as err:
        print(f"page.py: {err}", file=sys.stderr)
        return 2
    out = plan_path.with_name("page.html")
    tmp = out.with_name(f".page.html.{os.getpid()}.tmp")
    try:
        tmp.write_text(page, encoding="utf-8")
        os.replace(tmp, out)
    except OSError as err:
        tmp.unlink(missing_ok=True)
        print(f"page.py: cannot write {out}: {err.strerror}", file=sys.stderr)
        return 2
    print(out)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv))
