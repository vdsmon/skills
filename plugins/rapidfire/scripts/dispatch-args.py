#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""dispatch-args.py — Validate ticket + emit Agent() call args as JSON.

Reads a ticket file, applies the 4-bucket matrix, enforces the hard rule
(no haiku + general-purpose), and emits the params to use in the Agent
dispatch call.

Usage:  dispatch-args.py <ticket-file>

Stdout: JSON object {description, subagent_type, name, model, run_in_background, prompt}
Stderr: warnings (cavecrew + heavy-shell-acceptance combo)

Exit:
  0 = ok (warnings may still be on stderr)
  1 = hard rule violation
  2 = usage / parse error
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "error: PyYAML missing. This script uses PEP 723 inline deps via uv.\n"
        "Invoke it directly: ./dispatch-args.py <ticket>\n"
        "Or via uv:           uv run --script dispatch-args.py <ticket>\n"
        "Plain `python3 dispatch-args.py` bypasses the dep manager and fails.\n"
    )
    sys.exit(2)


# 4-bucket matrix. `trivial` defaults to caveman:cavecrew-builder + haiku.
# When the caveman plugin is not installed, set RAPIDFIRE_NO_CAVEMAN=1 in the
# environment to remap trivial → {general-purpose, sonnet} (haiku +
# general-purpose is the one combo blocked by the hard rule below).
if os.environ.get("RAPIDFIRE_NO_CAVEMAN"):
    TRIVIAL = {"agent_type": "general-purpose", "model": "sonnet"}
else:
    TRIVIAL = {"agent_type": "caveman:cavecrew-builder", "model": "haiku"}

MATRIX = {
    "trivial":   TRIVIAL,
    "moderate":  {"agent_type": "general-purpose", "model": "sonnet"},
    "complex":   {"agent_type": "general-purpose", "model": "opus"},
    "ambiguous": {"agent_type": "general-purpose", "model": "opus"},
}

# Commands that cavecrew-builder CAN execute via its read-only tool set
# (effectively: grep via the Grep tool, ls via the underlying filesystem, etc.
# It has NO Bash, so any cargo/npm/pytest/etc. acceptance will SKIP).
LIGHT_ACCEPTANCE_CMDS = {
    "grep", "ls", "wc", "cat", "head", "tail", "echo", "true", "false", "test",
}


def parse_frontmatter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        print(f"error: bad frontmatter — {exc}", file=sys.stderr)
        sys.exit(2)


def extract_section(text: str, heading: str) -> str:
    pattern = rf"^##\s+{re.escape(heading)}\s*$"
    m = re.search(pattern, text, re.MULTILINE)
    if not m:
        return ""
    start = m.end()
    rest = text[start:]
    next_h = re.search(r"^##\s+", rest, re.MULTILINE)
    return rest[: next_h.start()] if next_h else rest


def acceptance_needs_heavy_shell(text: str) -> bool:
    block = extract_section(text, "Acceptance")
    if not block:
        return False
    for line in block.split("\n"):
        for cmd in re.findall(r"`([^`]+)`", line):
            first = cmd.strip().split()[0] if cmd.strip() else ""
            first = first.split("/")[-1]
            if not first:
                continue
            if not re.match(r"^[a-zA-Z0-9_.\-]+$", first):
                continue
            if first not in LIGHT_ACCEPTANCE_CMDS:
                return True
    return False


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: dispatch-args.py <ticket-file>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 2

    text = path.read_text()
    fm = parse_frontmatter(text)
    if not fm.get("id"):
        print("error: ticket missing `id` frontmatter field", file=sys.stderr)
        return 2

    bucket = fm.get("bucket")
    if bucket not in MATRIX:
        print(
            f"warning: bucket '{bucket}' unknown or unset; defaulting to ambiguous",
            file=sys.stderr,
        )
        bucket = "ambiguous"

    matrix_choice = MATRIX[bucket]
    agent_type = fm.get("agent_type") or matrix_choice["agent_type"]
    model = fm.get("model") or matrix_choice["model"]

    if bucket == "trivial" and os.environ.get("RAPIDFIRE_NO_CAVEMAN") and not fm.get("agent_type"):
        print(
            "info: RAPIDFIRE_NO_CAVEMAN set — trivial bucket routed to "
            "general-purpose + sonnet (caveman:cavecrew-builder skipped).",
            file=sys.stderr,
        )

    # Hard rule: never haiku + general-purpose
    if model == "haiku" and agent_type == "general-purpose":
        print(
            "error: hard rule — haiku + general-purpose is lossy. "
            "Bump model to sonnet OR switch agent_type to cavecrew-builder.",
            file=sys.stderr,
        )
        return 1

    # Heuristic warning: cavecrew + heavy-shell acceptance
    if agent_type in {"caveman:cavecrew-builder", "cavecrew-builder"} and acceptance_needs_heavy_shell(text):
        print(
            f"warning: ticket {fm['id']} acceptance contains shell commands beyond "
            "grep/ls/wc/cat/head, but agent_type is cavecrew-builder (no Bash). "
            "Those checks will SKIP. Consider general-purpose.",
            file=sys.stderr,
        )

    name = fm.get("agent_name") or f"rf-{fm['id']}"
    description = f"rapidfire {fm['id']}"
    ticket_path = str(path.resolve())

    prompt = (
        f"Dispatched ticket {fm['id']}. Execute the ticket below. Respect its `## Files` boundary.\n\n"
        f"Ticket file: {ticket_path}\n\n"
        "Read the ticket end-to-end first. Execute the edits per `## Edits` "
        "(or follow `## Goal` if no Edits block).\n\n"
        "Required final-report format — the dispatcher parses these positions deterministically:\n"
        "1. Your final message MUST begin with EXACTLY one of these two tokens on its first line, "
        "no leading whitespace, no other text on that line:\n"
        "   PASS:   <one-line summary>\n"
        "   FAIL:   <one-line summary explaining what broke and why>\n"
        "2. Second block: `git diff --stat` output (verbatim) of files you touched.\n"
        "3. Third block (optional, only if you deviated from spec): a `## Notes / trade-offs` "
        "section explaining the deviation. The dispatcher parses this into ticket frontmatter "
        "as `agent_notes:`.\n"
        "4. Run every check in `## Acceptance` and include their PASS/FAIL/SKIP results before "
        "your final-report line.\n"
        "5. Do NOT commit. Lead reviews + commits via `/rapidfire commit`.\n"
        "6. Do NOT modify any file outside the paths in `## Files`.\n"
    )

    args = {
        "description": description,
        "subagent_type": agent_type,
        "name": name,
        "model": model,
        "run_in_background": True,
        "prompt": prompt,
    }

    json.dump(args, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
