#!/usr/bin/env python3
"""Check a pull request body against the open-pr template rules.

Usage: pr_body_check.py BODY_FILE [--base REF]

Prints one line per finding, FAIL or WARN, then a summary line. Exits 1 when
any FAIL is found, 0 otherwise. BODY_FILE may be "-" for stdin.

With --base, backticked repo paths are checked against HEAD and the diff from
REF. Those are warnings only: a path can exist at run time or on another branch.
"""

import argparse
import re
import subprocess
import sys

MAX_PROSE_WORDS = 300
MAX_OPENING_WORDS = 60
MAX_H2 = 4
MAX_BULLETS = 6
MAX_BULLET_WORDS = 35
MAX_SPAN_RATIO = 1 / 12

BULLET = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
# A section between <!-- NAME --> and <!-- /NAME --> belongs to a bot (a review
# summary, for example): the author does not write it, so no rule applies to it.
BOT_SECTION = re.compile(r"<!--\s*([A-Za-z0-9_-]+)\s*-->.*?<!--\s*/\1\s*-->", re.S)
INLINE_CODE = re.compile(r"`[^`\n]*`")
LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
URL = re.compile(r"https?://\S+")
ENTITY = re.compile(r"&#?\w+;")
FILE_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?`[^`]+`(?:\*\*)?\s*(?::|—|–| - )")
TYPOGRAPHY = {
    "—": "em dash", "–": "en dash", "“": "curly quote", "”": "curly quote",
    "‘": "curly quote", "’": "curly quote", "→": "arrow", "←": "arrow",
    "⇒": "arrow", "…": "ellipsis character", "•": "bullet character",
}
LOCAL_PATH = re.compile(r"(/Users/[^/\s]+|/home/[a-z][^/\s]*|/private/(?:tmp|var)/|(?<![\w./])~/|[A-Za-z]:\\Users\\)")
ATTRIBUTION = re.compile(
    r"(Generated with \[?Claude|Co-Authored-By:|claude\.ai/code/session|Addressed by \[?Claude"
    r"|Made with Cursor|\U0001F916)", re.I)
SUMMARY_HEADING = re.compile(r"^(summary|tl;?dr)\b", re.I)
MENTION = re.compile(r"(?<![\w/`])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b")
ASK = re.compile(
    r"(please (review|look|check|confirm|decide|approve)|needs? (your|a) (yes|review|approval|decision)"
    r"|before (you )?merg)", re.I)
AI_VOCABULARY = re.compile(
    r"\b(delve|crucial|pivotal|robust|seamless(ly)?|leverag(e|es|ing)|comprehensive|streamlin(e|es|ed)"
    r"|utiliz(e|es|ed|ing)|showcas(e|es|ing)|underscor(e|es|ing)|testament|additionally|furthermore"
    r"|moreover|it'?s worth noting|in summary|this pr introduces)\b", re.I)


def classify(text):
    """Return the author's own lines as (lineno, kind, text), and bot line numbers.

    Kinds: blank, heading, table, bullet, prose. Fenced code, <details> blocks
    and HTML comments are left out: rules about prose do not apply to them.
    """
    bot_lines = set()
    for m in BOT_SECTION.finditer(text):
        first = text.count("\n", 0, m.start()) + 1
        last = text.count("\n", 0, m.end()) + 1
        bot_lines.update(range(first, last + 1))

    own, fence, in_details, in_comment = [], None, False, False
    for n, line in enumerate(text.splitlines(), 1):
        if n in bot_lines:
            continue
        stripped = line.strip()
        if fence:
            if stripped.startswith(fence):
                fence = None
            continue
        if in_details:
            in_details = "</details>" not in line
            continue
        if in_comment:
            in_comment = "-->" not in line
            continue
        if stripped.startswith("```") or stripped.startswith("~~~"):
            fence = stripped[:3]
            continue
        if "<details" in line:
            in_details = "</details>" not in line
            continue
        if "<!--" in line:
            before, _, after = line.partition("<!--")
            if "-->" not in after:
                in_comment = True
                line = before
            else:
                line = before + after.split("-->", 1)[1]
            stripped = line.strip()
        if not stripped:
            own.append((n, "blank", ""))
        elif HEADING.match(stripped):
            own.append((n, "heading", stripped))
        elif stripped.startswith("|"):
            own.append((n, "table", stripped))
        elif BULLET.match(line):
            own.append((n, "bullet", line.rstrip()))
        else:
            own.append((n, "prose", line.rstrip()))
    return own, bot_lines


def plain(s):
    """Text of a line for word counting: no code spans, links reduced to their text."""
    s = INLINE_CODE.sub("", s)
    s = LINK.sub(r"\1", s)
    s = URL.sub("", s)
    return s


def words(s):
    return [w for w in plain(s).split() if re.search(r"[A-Za-z0-9]", w)]


def bullet_text(line):
    m = BULLET.match(line)
    return m.group(2) if m else line.strip()


def paragraphs(own):
    """Group prose and bullet lines into paragraphs; headings and blanks split them."""
    groups, cur = [], []
    for n, kind, text in own:
        if kind in ("prose", "bullet"):
            cur.append((n, kind, text))
        elif cur:
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def path_findings(own, base):
    try:
        top = set(git("ls-tree", "--name-only", "HEAD").split("\n")) - {""}
        diff_paths = set()
        for row in git("diff", "-M", "--name-status", f"{base}...HEAD").splitlines():
            diff_paths.update(row.split("\t")[1:])
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        reason = e.stderr.strip().splitlines()[0] if getattr(e, "stderr", None) else str(e)
        return [("WARN", "path-check", 0, f"skipped, git failed: {reason}")]
    roots = top | {p.split("/")[0] for p in diff_paths}
    out = []
    for n, kind, text in own:
        if kind not in ("prose", "bullet"):
            continue
        for span in re.findall(r"`([^`\n]+)`", text):
            if re.search(r"[\s{}<>*$]|://", span) or span.startswith("-"):
                continue
            if "/" not in span and not re.search(r"\.[A-Za-z0-9]{1,6}$", span):
                continue
            p = span[2:] if span.startswith("./") else span
            p = p.rstrip("/")
            # Only spans rooted in a real top-level entry are repo paths; the
            # rest (branch names, run-time folders) cannot be checked here.
            if p.split("/")[0] not in roots:
                continue
            if p in diff_paths or any(d.startswith(p + "/") for d in diff_paths):
                continue
            if subprocess.run(["git", "cat-file", "-e", f"HEAD:{p}"], capture_output=True).returncode == 0:
                continue
            out.append(("WARN", "path", n, f"`{span}` is not at HEAD or in the diff from {base}"))
    return out


def check(text, base=None, author=None):
    """Return (findings, prose_word_count). A finding is (level, rule, line, message)."""
    own, bot_lines = classify(text)
    f = []

    for n, line in enumerate(text.splitlines(), 1):
        if n in bot_lines:
            continue
        if m := LOCAL_PATH.search(line):
            f.append(("FAIL", "local-path", n, f"local path {m.group(1)!r}: say what it is, not where it sits on one machine"))
        if m := ATTRIBUTION.search(line):
            f.append(("FAIL", "attribution", n, f"attribution {m.group(1)!r}: leave tool credits out of the body"))

    content = [x for x in own if x[1] != "blank"]
    if content and content[0][1] == "heading":
        f.append(("FAIL", "opening", content[0][0], "the body starts with a heading: open with two or three sentences"))

    h2 = [(n, t) for n, k, t in own if k == "heading" and HEADING.match(t).group(1) == "##"]
    if len(h2) > MAX_H2:
        f.append(("FAIL", "headings", h2[MAX_H2][0], f"{len(h2)} sections, at most {MAX_H2}: drop the empty or minor ones"))
    for n, k, t in own:
        if k == "heading" and SUMMARY_HEADING.match(HEADING.match(t).group(2)):
            f.append(("FAIL", "summary-heading", n, "the title is the summary: no Summary heading"))

    prose_words, spans = 0, 0
    for n, k, t in own:
        if k not in ("prose", "bullet", "heading"):
            continue
        clean = ENTITY.sub("", URL.sub("", INLINE_CODE.sub("", t)))
        for ch, name in TYPOGRAPHY.items():
            if ch in clean:
                f.append(("FAIL", "typography", n, f"{name} ({ch}): use plain punctuation"))
        if " -- " in clean:
            f.append(("FAIL", "typography", n, "double hyphen: use a period or a comma"))
        if k == "heading":
            continue
        if ";" in clean:
            f.append(("FAIL", "semicolon", n, "semicolon in prose: split the sentence"))
        body = bullet_text(t) if k == "bullet" else t.strip()
        if body.startswith("**") or body.startswith("__"):
            f.append(("FAIL", "bold-label", n, "line starts with a bold label: say it in the sentence"))
        elif "**" in plain(t):
            f.append(("WARN", "bold", n, "bold in prose: keep it for a real warning"))
        if m := AI_VOCABULARY.search(plain(t)):
            f.append(("WARN", "ai-vocabulary", n, f"{m.group(0)!r} reads as machine-written: use a plain word"))
        w = len(words(bullet_text(t) if k == "bullet" else t))
        prose_words += w
        spans += len(INLINE_CODE.findall(t))
        if k == "bullet":
            indent = len(BULLET.match(t).group(1))
            if indent >= 4:
                f.append(("WARN", "nesting", n, "bullet nested two levels deep: flatten it"))
            if w > MAX_BULLET_WORDS:
                f.append(("WARN", "bullet-length", n, f"{w}-word bullet: keep a bullet to one idea"))

    # Hand-wrapped prose: a line that continues the previous one in lowercase.
    for (_, k1, _), (n2, k2, t2) in zip(own, own[1:]):
        if k1 in ("prose", "bullet") and k2 == "prose" and t2.lstrip()[:1].islower():
            f.append(("FAIL", "hand-wrap", n2, "prose is wrapped by hand: join the lines of a paragraph"))

    # A file-by-file changelog: half or more of a section's bullets are "`path`: text".
    sections, cur = [], []
    for x in own:
        if x[1] == "heading":
            sections.append(cur)
            cur = []
        elif x[1] == "bullet" and len(BULLET.match(x[2]).group(1)) < 2:
            cur.append(x)
    sections.append(cur)
    for bullets in sections:
        hits = [b for b in bullets if FILE_BULLET.match(b[2])]
        if len(hits) >= 2 and 2 * len(hits) >= len(bullets):
            f.append(("FAIL", "file-list", hits[0][0], "bullets list files: describe what a reader would notice instead"))
        if len(bullets) > MAX_BULLETS:
            f.append(("WARN", "bullet-count", bullets[MAX_BULLETS][0], f"{len(bullets)} bullets in one section, aim for {MAX_BULLETS} or fewer"))

    if prose_words > MAX_PROSE_WORDS:
        f.append(("FAIL", "prose-length", 0, f"{prose_words} words of prose, at most {MAX_PROSE_WORDS} (code, tables, <details> and bot sections do not count)"))
    if spans and spans > prose_words * MAX_SPAN_RATIO:
        f.append(("WARN", "code-density", 0, f"{spans} code spans in {prose_words} words: keep only what a reader types or opens"))

    paras = paragraphs(own)
    if paras and content and content[0][1] != "heading":
        opening = sum(len(words(t)) for _, _, t in paras[0])
        if opening > MAX_OPENING_WORDS:
            f.append(("WARN", "opening-length", paras[0][0][0], f"{opening}-word opening, at most {MAX_OPENING_WORDS}"))
    for i, para in enumerate(paras):
        for n, _, t in para:
            for m in MENTION.finditer(INLINE_CODE.sub("", t)):
                if author and m.group(1).lower() == author.lower():
                    f.append(("FAIL", "self-mention", n, f"@{m.group(1)} is the PR author: write \"I\" instead"))
                else:
                    f.append(("WARN", "mention", n, f"@{m.group(1)} is notified as soon as the PR is visible: confirm it with the user"))
            if i >= 2 and ASK.search(t):
                f.append(("WARN", "ask-late", n, "an ask to the reader sits low in the body: move it to the line after the opening"))

    if base:
        f.extend(path_findings(own, base))
    f.sort(key=lambda x: (x[0] != "FAIL", x[2]))
    return f, prose_words


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check a PR body against the open-pr template rules.")
    ap.add_argument("body", help="body file, or - for stdin")
    ap.add_argument("--base", help="base ref: also check backticked repo paths against HEAD and the diff")
    ap.add_argument("--author", help="the PR author's GitHub login: fail when the body tags them")
    args = ap.parse_args(argv)
    text = sys.stdin.read() if args.body == "-" else open(args.body, encoding="utf-8").read()
    findings, prose_words = check(text, args.base, args.author)
    for level, rule, line, msg in findings:
        where = f"line {line}: " if line else ""
        print(f"{level} {rule}: {where}{msg}")
    fails = sum(1 for x in findings if x[0] == "FAIL")
    warns = len(findings) - fails
    status = f"{fails} FAIL" if fails else "pass"
    print(f"open-pr check: {status}, {warns} WARN, {prose_words} words of prose")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
