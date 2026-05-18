#!/usr/bin/env python3
"""Fetch actionable CodeRabbit inline comments from a Bitbucket Cloud pull request.

Uses `bkt api` under the hood. Requires bkt to be installed and authenticated.

Usage:
    python fetch_coderabbit_comments.py <workspace> <repo> <pr_id>
    python fetch_coderabbit_comments.py --url <bitbucket_pr_url>
"""

from argparse import ArgumentParser
import json
import re
import subprocess
import sys


def parse_pr_url(url: str) -> tuple[str, str, int]:
    """Extract workspace, repo slug, and PR id from a Bitbucket URL."""
    m = re.search(r"bitbucket\.org/([^/]+)/([^/]+)/pull-requests/(\d+)", url)
    if not m:
        print(f"Error: could not parse Bitbucket PR URL: {url}", file=sys.stderr)
        sys.exit(1)
    return m.group(1), m.group(2), int(m.group(3))


def fetch_all_comments(workspace: str, repo: str, pr_id: int) -> list[dict]:
    """Fetch all comment pages from the Bitbucket API via bkt."""
    all_comments = []
    page = 1
    while True:
        endpoint = (
            f"/repositories/{workspace}/{repo}"
            f"/pullrequests/{pr_id}/comments?page={page}&pagelen=100"
        )
        result = subprocess.run(
            ["bkt", "api", endpoint, "--json"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"Error fetching page {page}: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        data = json.loads(result.stdout)
        all_comments.extend(data.get("values", []))

        if "next" not in data:
            break
        page += 1

    return all_comments


def is_actionable_inline(comment: dict) -> bool:
    """Return True if the comment is an actionable inline CodeRabbit finding."""
    if not comment.get("inline"):
        return False
    raw = comment.get("content", {}).get("raw", "")
    # Skip summary/status comments that happen to be inline
    if "Actionable comments posted" in raw:
        return False
    if "Walkthrough" in raw:
        return False
    # Actionable comments contain a severity marker
    return "Potential issue" in raw or "suggestion" in raw.lower()


def extract_comment(comment: dict) -> dict:
    """Extract structured fields from an actionable inline comment."""
    raw = comment.get("content", {}).get("raw", "")
    inline = comment["inline"]

    severity = None
    if "Critical" in raw:
        severity = "Critical"
    elif "Major" in raw:
        severity = "Major"
    elif "Minor" in raw:
        severity = "Minor"

    title_match = re.search(r"\*\*(.+?)\*\*", raw)
    title = title_match.group(1) if title_match else "(no title)"

    return {
        "id": comment.get("id"),
        "resolved": comment.get("resolution") is not None,
        "file": inline.get("path"),
        "line": inline.get("to") or inline.get("from"),
        "severity": severity,
        "title": title,
        "raw": raw,
    }


def format_output(comments: list[dict], pr_id: int) -> str:
    """Format extracted comments into a readable summary."""
    lines = [f"**CodeRabbit: {len(comments)} actionable finding(s) on PR #{pr_id}**\n"]

    by_file: dict[str, list[dict]] = {}
    for c in comments:
        by_file.setdefault(c["file"], []).append(c)

    for filepath in sorted(by_file):
        lines.append(f"### {filepath}")
        for c in sorted(by_file[filepath], key=lambda x: x["line"] or 0):
            sev = f" [{c['severity']}]" if c["severity"] else ""
            loc = f"L{c['line']}" if c["line"] else ""
            cid = f" (comment {c['id']})" if c.get("id") else ""
            lines.append(f"- **{loc}{sev}**{cid}: {c['title']}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = ArgumentParser(description="Fetch CodeRabbit comments from a Bitbucket PR")
    parser.add_argument("workspace", nargs="?", help="Bitbucket workspace")
    parser.add_argument("repo", nargs="?", help="Repository slug")
    parser.add_argument("pr_id", nargs="?", type=int, help="Pull request ID")
    parser.add_argument("--url", help="Full Bitbucket PR URL (alternative to positional args)")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output JSON")
    args = parser.parse_args()

    if args.url:
        workspace, repo, pr_id = parse_pr_url(args.url)
    elif args.workspace and args.repo and args.pr_id:
        workspace, repo, pr_id = args.workspace, args.repo, args.pr_id
    else:
        parser.error("Provide either --url or workspace repo pr_id")

    all_comments = fetch_all_comments(workspace, repo, pr_id)
    cr_comments = [
        c for c in all_comments if c.get("user", {}).get("display_name", "").lower() == "coderabbit"
    ]
    actionable = [c for c in cr_comments if is_actionable_inline(c)]

    if not actionable:
        print(f"No actionable CodeRabbit comments found on PR #{pr_id}.")
        return

    extracted = [extract_comment(c) for c in actionable]
    # A resolved thread is already handled (fixed in a prior round, or
    # closed by a maintainer). Dropping it here stops the re-fetch loop
    # from re-surfacing the same finding after the fix push.
    extracted = [c for c in extracted if not c["resolved"]]

    if not extracted:
        print(f"No unresolved actionable CodeRabbit comments on PR #{pr_id}.")
        return

    if args.as_json:
        print(json.dumps(extracted, indent=2))
    else:
        print(format_output(extracted, pr_id))


if __name__ == "__main__":
    main()
