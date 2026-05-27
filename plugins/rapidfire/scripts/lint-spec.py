#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""lint-spec.py — Pre-dispatch ticket lint.

Narrow heuristic (the only one): catch the T01-class spec defect where a
`## Acceptance` block greps for a string expected to be absent but the
`## Edits` block writes that string into the ticket's files.

Usage:  lint-spec.py <ticket-file>

Exit:
  0 = clean (no findings)
  1 = at least one conflict (diagnostics on stderr)
  2 = usage / parse error
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


# A loose grep pattern. Captures the search-string in group 1.
# Tolerates flags: -r -n -i -l -c, single/double quotes.
GREP_PATTERN_RE = re.compile(
    r"grep(?:\s+(?:-[a-zA-Z]+|--[\w-]+))*\s+(['\"])([^'\"]+)\1",
)

# Words/phrases in the same line signalling "expects absence".
ABSENCE_INDICATORS = re.compile(
    r"\b(?:exit(?:s)?\s*(?:code\s*)?(?:1|non-?zero)"
    r"|no\s+matches?"
    r"|prints?\s*[`'\"]?0[`'\"]?"
    r"|->\s*[`'\"]?0[`'\"]?"
    r"|→\s*[`'\"]?0[`'\"]?"
    r"|outputs?\s*[`'\"]?0[`'\"]?"
    r"|returns?\s*[`'\"]?(?:0|non-?zero|no\s+matches?)[`'\"]?"
    r"|empty"
    r"|absent"
    r"|removed"
    r"|gone)\b",
    re.IGNORECASE,
)

PRESENCE_INDICATORS = re.compile(
    r"\b(?:prints?\s*[`'\"]?[1-9]"
    r"|->\s*[`'\"]?[1-9]"
    r"|→\s*[`'\"]?[1-9]"
    r"|matches?\s+expected"
    r"|>=\s*1)\b",
    re.IGNORECASE,
)

# Capture "new" strings from ## Edits. We look for arrow-style replacements.
# Each form below uses a single delimiter type so the content can include the
# OTHER delimiters (so `foo = "Brett"` captures the whole `foo = "Brett"`).
ARROW_NEW_RES = [
    re.compile(r"(?:→|->)\s*`([^`\n]+)`"),     # backtick-wrapped
    re.compile(r"(?:→|->)\s*\"([^\"\n]+)\""),  # double-quote-wrapped
    re.compile(r"(?:→|->)\s*'([^'\n]+)'"),     # single-quote-wrapped
]
WRITES_INTO_RE = re.compile(
    r"writes?\s+[`\"']([^`\"']+)[`\"']\s+into\s+([\w/.\-]+)",
    re.IGNORECASE,
)


def extract_section(text: str, heading: str) -> str:
    pattern = rf"^##\s+{re.escape(heading)}\s*$"
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        return ""
    start = m.end()
    rest = text[start:]
    next_h = re.search(r"^##\s+", rest, re.MULTILINE)
    return rest[: next_h.start()] if next_h else rest


def parse_absence_specs(acceptance_block: str) -> list[str]:
    """Yield search-pattern strings that the acceptance expects to be absent."""
    out = []
    for raw in acceptance_block.split("\n"):
        line = raw.strip()
        if not line:
            continue
        # presence wins over absence on the same line
        if PRESENCE_INDICATORS.search(line):
            continue
        if not ABSENCE_INDICATORS.search(line):
            continue
        for m in GREP_PATTERN_RE.finditer(line):
            out.append(m.group(2))
    return out


def parse_edit_new_values(edits_block: str) -> list[str]:
    out = []
    for rx in ARROW_NEW_RES:
        for m in rx.finditer(edits_block):
            out.append(m.group(1))
    for m in WRITES_INTO_RE.finditer(edits_block):
        out.append(m.group(1))
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: lint-spec.py <ticket-file>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 2

    text = path.read_text()
    accept_block = extract_section(text, "Acceptance")
    if not accept_block:
        return 0

    absence_patterns = parse_absence_specs(accept_block)
    if not absence_patterns:
        return 0

    edits_block = extract_section(text, "Edits")
    if not edits_block:
        return 0

    new_values = parse_edit_new_values(edits_block)
    if not new_values:
        return 0

    conflicts: list[tuple[str, str]] = []
    for pat in absence_patterns:
        for new_val in new_values:
            if pat.lower() in new_val.lower():
                conflicts.append((pat, new_val))

    if not conflicts:
        return 0

    print("lint-spec: ticket has acceptance/edit conflicts:", file=sys.stderr)
    for pat, new_val in conflicts:
        print(
            f"  CONFLICT: acceptance expects '{pat}' absent, but edit writes '{new_val}' (contains '{pat}')",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
