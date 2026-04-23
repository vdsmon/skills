#!/usr/bin/env python3
"""Token usage report for Claude Code sessions.

Reads the current (or specified) session transcript and shows:
- Per-message token breakdown (input / cache_read / cache_creation / output)
- Cache hit ratio per message and overall
- Running totals

Usage:
  python3 scripts/token-report.py                  # latest session in this project
  python3 scripts/token-report.py <session.jsonl>  # specific file
  python3 scripts/token-report.py --all             # all sessions in this project
"""

import json
import sys
import os
import glob
from datetime import datetime, timezone


def parse_session(filepath):
    """Parse a JSONL session file and extract usage data per assistant turn."""
    turns = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            if d.get("type") != "assistant" or "message" not in d:
                continue

            msg = d["message"]
            if not isinstance(msg, dict) or "usage" not in msg:
                continue

            u = msg["usage"]
            turns.append({
                "model": msg.get("model", "?"),
                "input": u.get("input_tokens", 0),
                "cache_read": u.get("cache_read_input_tokens", 0),
                "cache_create": u.get("cache_creation_input_tokens", 0),
                "output": u.get("output_tokens", 0),
                "timestamp": d.get("timestamp"),
            })
    return turns


def format_tokens(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def print_report(turns, filepath=None):
    if not turns:
        print("No usage data found.")
        return

    if filepath:
        print(f"\n  Session: {os.path.basename(filepath)}")
    print(f"  Turns: {len(turns)}")
    if turns[0].get("timestamp"):
        start = datetime.fromisoformat(turns[0]["timestamp"].replace("Z", "+00:00"))
        print(f"  Started: {start.strftime('%Y-%m-%d %H:%M')}")
    print()

    # Header
    print(f"  {'#':>3}  {'Model':<25} {'Input':>8} {'Cache R':>8} {'Cache W':>8} {'Output':>8} {'Hit %':>6}")
    print(f"  {'─' * 3}  {'─' * 25} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 6}")

    totals = {"input": 0, "cache_read": 0, "cache_create": 0, "output": 0}

    for i, t in enumerate(turns):
        total_in = t["input"] + t["cache_read"] + t["cache_create"]
        hit_pct = (t["cache_read"] / total_in * 100) if total_in > 0 else 0

        print(
            f"  {i + 1:>3}  {t['model']:<25} "
            f"{format_tokens(t['input']):>8} "
            f"{format_tokens(t['cache_read']):>8} "
            f"{format_tokens(t['cache_create']):>8} "
            f"{format_tokens(t['output']):>8} "
            f"{hit_pct:>5.1f}%"
        )

        for k in totals:
            totals[k] += t[k]

    # Totals
    total_in = totals["input"] + totals["cache_read"] + totals["cache_create"]
    overall_hit = (totals["cache_read"] / total_in * 100) if total_in > 0 else 0

    print(f"  {'─' * 3}  {'─' * 25} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 6}")
    print(
        f"  {'Σ':>3}  {'TOTAL':<25} "
        f"{format_tokens(totals['input']):>8} "
        f"{format_tokens(totals['cache_read']):>8} "
        f"{format_tokens(totals['cache_create']):>8} "
        f"{format_tokens(totals['output']):>8} "
        f"{overall_hit:>5.1f}%"
    )

    # Context window usage (Opus 4.6 = 1M tokens)
    # Context = input tokens sent in the most recent main-chain turn (no output).
    # This matches ccstatusline's approach: the last API call includes the full
    # conversation, so its input tokens = current context window occupancy.
    context_window = 1_000_000
    last_turn = turns[-1]
    last_total_in = last_turn["input"] + last_turn["cache_read"] + last_turn["cache_create"]
    context_pct = last_total_in / context_window * 100

    # Plan usage from Anthropic API
    five_h_pct = seven_d_pct = extra_pct = "?"
    five_h_reset = seven_d_reset = ""
    extra_line = ""
    try:
        import subprocess
        import urllib.request

        raw = subprocess.check_output(
            ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        api_token = json.loads(raw)["claudeAiOauth"]["accessToken"]

        req = urllib.request.Request(
            "https://api.anthropic.com/api/oauth/usage",
            headers={
                "Authorization": f"Bearer {api_token}",
                "anthropic-beta": "oauth-2025-04-20",
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            usage = json.loads(resp.read())

        now = datetime.now(timezone.utc)

        def time_until(iso_str):
            if not iso_str:
                return "?"
            reset = datetime.fromisoformat(iso_str)
            delta = reset - now
            if delta.total_seconds() <= 0:
                return "now"
            hours, rem = divmod(int(delta.total_seconds()), 3600)
            mins = rem // 60
            return f"{hours}h{mins:02d}m"

        five_h = usage.get("five_hour", {})
        seven_d = usage.get("seven_day", {})
        five_h_pct = f"{five_h.get('utilization', 0):.2f}%"
        five_h_reset = time_until(five_h.get("resets_at"))
        seven_d_pct = f"{seven_d.get('utilization', 0):.2f}%"
        seven_d_reset = time_until(seven_d.get("resets_at"))

        extra = usage.get("extra_usage", {})
        if extra.get("is_enabled"):
            used = extra.get("used_credits", 0) / 100
            limit = extra.get("monthly_limit", 0) / 100
            extra_pct = f"{extra.get('utilization', 0):.2f}%"
            extra_line = f"${used:.2f} / ${limit:.2f}"
    except Exception:
        pass

    last_hit = (last_turn["cache_read"] / last_total_in * 100) if last_total_in > 0 else 0

    # Session duration and burn rate
    duration_str = ""
    burn_rate_str = ""
    compress_eta_str = ""
    if turns[0].get("timestamp") and turns[-1].get("timestamp"):
        t_start = datetime.fromisoformat(turns[0]["timestamp"].replace("Z", "+00:00"))
        t_end = datetime.fromisoformat(turns[-1]["timestamp"].replace("Z", "+00:00"))
        duration_secs = (t_end - t_start).total_seconds()
        if duration_secs > 0:
            hours = duration_secs / 3600
            h, m = divmod(int(duration_secs), 3600)
            m = m // 60
            duration_str = f"{h}h{m:02d}m"
            burn_per_hour = total_in / hours
            burn_rate_str = f"{format_tokens(int(burn_per_hour))}/h"
            # Compression threshold is ~50% of context window
            compress_threshold = context_window * 0.5
            context_growth_per_hour = last_total_in / hours if hours > 0 else 0
            if context_growth_per_hour > 0 and last_total_in < compress_threshold:
                hours_left = (compress_threshold - last_total_in) / context_growth_per_hour
                ch, cm = divmod(int(hours_left * 3600), 3600)
                cm = cm // 60
                compress_eta_str = f"~{ch}h{cm:02d}m"

    # Estimated cost (Opus 4.6 pricing per MTok)
    # Input: $15, Output: $75, Cache read: $1.50 (90% off), Cache write: $18.75 (25% premium)
    cost_input = totals["input"] / 1_000_000 * 15.0
    cost_cache_read = totals["cache_read"] / 1_000_000 * 1.50
    cost_cache_write = totals["cache_create"] / 1_000_000 * 18.75
    cost_output = totals["output"] / 1_000_000 * 75.0
    cost_total = cost_input + cost_cache_read + cost_cache_write + cost_output
    cost_without_cache = total_in / 1_000_000 * 15.0 + totals["output"] / 1_000_000 * 75.0
    cost_saved = cost_without_cache - cost_total

    # Read-to-write ratio
    rw_ratio = total_in / totals["output"] if totals["output"] > 0 else 0

    # Delta tracking — compare with previous run
    delta_str = ""
    state_file = (filepath or "") + ".tokenomics-state.json"
    if not state_file.startswith("."):
        prev_state = {}
        try:
            with open(state_file) as f:
                prev_state = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass

        if prev_state:
            d_in = total_in - prev_state.get("total_in", 0)
            d_out = totals["output"] - prev_state.get("total_out", 0)
            d_cost = cost_total - prev_state.get("cost", 0)
            if d_in > 0:
                delta_str = f"+{format_tokens(d_in)} in, +{format_tokens(d_out)} out, +${d_cost:.2f}"

        try:
            with open(state_file, "w") as f:
                json.dump({"total_in": total_in, "total_out": totals["output"], "cost": cost_total}, f)
        except OSError:
            pass

    # Print summary
    print(f"\n  Total input tokens: {format_tokens(total_in)}")
    print(f"  Total output tokens: {format_tokens(totals['output'])}")
    print(f"  Cache hit ratio: {overall_hit:.2f}% overall, {last_hit:.2f}% last msg")
    print(f"  Cache efficiency: {format_tokens(totals['cache_read'])} served from cache (saved ${cost_saved:.2f})")
    ctx_parts = f"  Context usage: {context_pct:.2f}% of 1M ({format_tokens(last_total_in)} last turn)"
    if compress_eta_str:
        ctx_parts += f"  compress in {compress_eta_str}"
    print(ctx_parts)
    session_parts = []
    if duration_str:
        session_parts.append(f"duration {duration_str}")
    if burn_rate_str:
        session_parts.append(f"burn {burn_rate_str}")
    session_parts.append(f"r:w {int(rw_ratio)}:1")
    session_parts.append(f"est. ${cost_total:.2f}")
    print(f"  Session: {' | '.join(session_parts)}")
    if delta_str:
        print(f"  Delta: {delta_str}")
    print(f"  Plan usage (5h): {five_h_pct} (resets in {five_h_reset})" if five_h_reset else f"  Plan usage (5h): {five_h_pct}")
    print(f"  Plan usage (7d): {seven_d_pct} (resets in {seven_d_reset})" if seven_d_reset else f"  Plan usage (7d): {seven_d_pct}")
    if extra_line:
        print(f"  Extra usage: {extra_line} ({extra_pct})")
    print()


def find_project_sessions(project_dir=None):
    """Find session files for a project. Auto-detects from CWD if not specified."""
    if project_dir:
        base = project_dir
    else:
        # Auto-detect: CWD path mangled to match Claude's convention
        cwd = os.getcwd()
        mangled = cwd.replace("/", "-").lstrip("-")
        base = os.path.expanduser(f"~/.claude/projects/-{mangled}")
        if not os.path.exists(base):
            # Fallback: find most recently modified project
            projects_dir = os.path.expanduser("~/.claude/projects")
            if os.path.exists(projects_dir):
                candidates = [
                    os.path.join(projects_dir, d)
                    for d in os.listdir(projects_dir)
                    if os.path.isdir(os.path.join(projects_dir, d))
                ]
                if candidates:
                    base = max(candidates, key=os.path.getmtime)
    return sorted(glob.glob(os.path.join(base, "*.jsonl")), key=os.path.getmtime)


def main():
    args = [a for a in sys.argv[1:]]

    if args and args[0] != "--all":
        filepath = args[0]
        turns = parse_session(filepath)
        print_report(turns, filepath)
        return

    sessions = find_project_sessions()
    if not sessions:
        print("No sessions found.")
        return

    if args and args[0] == "--all":
        for s in sessions:
            turns = parse_session(s)
            print_report(turns, s)
    else:
        filepath = sessions[-1]
        turns = parse_session(filepath)
        print_report(turns, filepath)


if __name__ == "__main__":
    main()
