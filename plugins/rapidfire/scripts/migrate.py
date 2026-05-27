#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""migrate.py — Backfill old rapidfire tickets with v2 frontmatter fields.

Idempotent. Re-runnable. Fills missing fields with sentinels.

Usage:  migrate.py [<dir>]     # default .rapidfire
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "error: PyYAML missing. This script uses PEP 723 inline deps via uv.\n"
        "Invoke it directly: ./migrate.py [dir]\n"
        "Or via uv:           uv run --script migrate.py [dir]\n"
        "Plain `python3 migrate.py` bypasses the dep manager and fails.\n"
    )
    sys.exit(2)


SENTINEL_DEFAULTS = {
    "model": "unknown",
    "bucket": "unknown",
    "origin": "user",
    "attempt": 1,
}


def _format_value(v) -> str:
    """Render a scalar the way YAML would, for surgical append."""
    if hasattr(v, "isoformat"):
        return v.isoformat(timespec="seconds")
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    # Quote only when YAML would otherwise misparse (leading special char,
    # contains `:` followed by space, etc). Sentinel values are simple, so
    # the common path needs no quoting at all.
    needs_quote = any(c in s for c in ":#\n") or s.startswith(("- ", "? ", "! ", "& ", "* "))
    if needs_quote:
        return '"' + s.replace('"', '\\"') + '"'
    return s


def main() -> int:
    d = Path(sys.argv[1] if len(sys.argv) > 1 else ".rapidfire")
    if not d.exists():
        print(f"error: {d} not found", file=sys.stderr)
        return 1

    tickets = sorted(d.glob("T*.md"))
    if not tickets:
        print(f"no tickets in {d}", file=sys.stderr)
        return 0

    changed = 0
    for path in tickets:
        text = path.read_text()
        m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
        if not m:
            print(f"skip: {path.name} (no frontmatter)", file=sys.stderr)
            continue

        fm_text = m.group(1)
        try:
            fm = yaml.safe_load(fm_text) or {}
        except yaml.YAMLError as exc:
            print(f"skip: {path.name} ({exc})", file=sys.stderr)
            continue

        mtime_iso = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(
            timespec="seconds"
        )

        # Compute which keys need to be added — never rewrite existing ones.
        # This preserves folded scalars (`>-`), block strings, comments, and
        # field ordering. The original safe_dump path mangled all of those.
        to_add: list[tuple[str, object]] = []
        for k, v in SENTINEL_DEFAULTS.items():
            if k not in fm:
                to_add.append((k, v))
        if "dispatched_at" not in fm:
            to_add.append(("dispatched_at", mtime_iso))
        if "created_at" not in fm:
            created = fm.get("created") or mtime_iso
            to_add.append(("created_at", created))

        if not to_add:
            continue

        appended = "\n".join(f"{k}: {_format_value(v)}" for k, v in to_add)
        new_fm_text = fm_text.rstrip() + "\n" + appended
        body_after = text[m.end():]
        path.write_text(f"---\n{new_fm_text}\n---\n{body_after}")
        changed += 1
        print(f"migrated: {path.name} (added: {', '.join(k for k, _ in to_add)})")

    print(f"\ndone. {changed} ticket(s) updated, {len(tickets) - changed} already current.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
