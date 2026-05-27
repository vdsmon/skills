#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""status.py — Walk .rapidfire/T*.md and print views.

Modes:
  status.py                  # full table (default)
  status.py --ready          # T-IDs whose deps are satisfied + status=queued
  status.py --stats          # rollup metrics
  status.py --json           # machine-readable
  status.py --dir <path>     # override .rapidfire/ location
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from statistics import median

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "error: PyYAML missing. This script uses PEP 723 inline deps via uv.\n"
        "Invoke it directly: ./status.py [args]\n"
        "Or via uv:           uv run --script status.py [args]\n"
        "Plain `python3 status.py` bypasses the dep manager and fails.\n"
    )
    sys.exit(2)

STATUS_EMOJI = {
    "queued": "⏸ ",
    "dispatched": "🟡",
    "running": "🟡",
    "reported": "✅",
    "failed": "🔴",
    "killed": "💀",
}


def parse_frontmatter(path: Path) -> dict:
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        print(f"warning: bad frontmatter in {path.name}: {exc}", file=sys.stderr)
        return {}


def find_tickets(dir_path: Path) -> list[Path]:
    return sorted(dir_path.glob("T*.md"))


def fmt_duration(ms) -> str:
    if not isinstance(ms, (int, float)):
        return "—"
    secs = ms / 1000
    if secs < 60:
        return f"{secs:.0f}s"
    return f"{secs / 60:.1f}m"


def cmd_table(tickets: list[dict]) -> None:
    if not tickets:
        print("no tickets in .rapidfire/")
        return
    headers = ["ID", "status", "agent", "model", "dur", "origin", "title"]
    rows = []
    for fm in tickets:
        status = fm.get("status", "?")
        rows.append(
            [
                str(fm.get("id", "—")),
                f"{STATUS_EMOJI.get(status, '?')} {status}",
                str(fm.get("agent_name", "—"))[:34],
                str(fm.get("model", "—")),
                fmt_duration(fm.get("duration_ms")),
                str(fm.get("origin", "user")),
                str(fm.get("title", "—")),
            ]
        )
    widths = [max(len(h), max(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    line = "  ".join(f"{{:<{w}}}" for w in widths)
    print(line.format(*headers))
    print(line.format(*["-" * w for w in widths]))
    for r in rows:
        print(line.format(*r))


def cmd_ready(tickets: list[dict]) -> None:
    reported = {t["id"] for t in tickets if t.get("status") == "reported" and t.get("id")}
    for fm in tickets:
        if fm.get("status") != "queued":
            continue
        deps = fm.get("depends_on") or []
        if all(d in reported for d in deps):
            print(fm.get("id", ""))


def cmd_stats(tickets: list[dict]) -> None:
    by_status: dict[str, int] = {}
    by_bucket: dict[str, int] = {}
    by_model_tokens: dict[str, int] = {}
    durations: list[int] = []
    inline_fixed: list[str] = []
    for fm in tickets:
        by_status[fm.get("status", "?")] = by_status.get(fm.get("status", "?"), 0) + 1
        if fm.get("bucket"):
            by_bucket[fm["bucket"]] = by_bucket.get(fm["bucket"], 0) + 1
        if fm.get("duration_ms"):
            durations.append(int(fm["duration_ms"]))
        if fm.get("model") and isinstance(fm.get("total_tokens"), (int, float)):
            by_model_tokens[fm["model"]] = by_model_tokens.get(fm["model"], 0) + int(fm["total_tokens"])
        if fm.get("recovered") == "inline":
            inline_fixed.append(str(fm.get("id", "?")))

    total = len(tickets)
    status_summary = " | ".join(f"{v} {k}" for k, v in sorted(by_status.items()))
    print(f"Tickets: {total} total | {status_summary}")

    if durations:
        durations.sort()
        med = median(durations)
        p95_idx = min(len(durations) - 1, int(len(durations) * 0.95))
        print(f"Duration: median {fmt_duration(med)}  p95 {fmt_duration(durations[p95_idx])}")

    if by_model_tokens:
        total_t = sum(by_model_tokens.values())
        per = ", ".join(f"{k} {v // 1000}k" for k, v in sorted(by_model_tokens.items()))
        print(f"Total tokens: {total_t // 1000}k ({per})")

    if by_bucket:
        per = ", ".join(f"{k} {v}" for k, v in sorted(by_bucket.items()))
        print(f"Buckets: {per}")

    if inline_fixed:
        print(f"Inline-fixed: {', '.join(inline_fixed)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="rapidfire ticket status")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--ready", action="store_true", help="print queued tickets whose deps are satisfied")
    g.add_argument("--stats", action="store_true", help="print rollup metrics")
    g.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--dir", default=".rapidfire", help="ticket directory (default .rapidfire)")
    args = ap.parse_args()

    d = Path(args.dir)
    if not d.exists():
        print(f"error: {d} not found", file=sys.stderr)
        return 1

    tickets = [parse_frontmatter(p) for p in find_tickets(d)]
    tickets = [t for t in tickets if t.get("id")]

    if args.json:
        json.dump(tickets, sys.stdout, indent=2, default=str)
        print()
    elif args.ready:
        cmd_ready(tickets)
    elif args.stats:
        cmd_stats(tickets)
    else:
        cmd_table(tickets)
    return 0


if __name__ == "__main__":
    sys.exit(main())
