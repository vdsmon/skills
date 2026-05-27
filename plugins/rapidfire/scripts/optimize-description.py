#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""optimize-description.py — Iterative description tightening via `claude -p`.

Drop-in replacement for skill-creator's `run_loop.py` that does NOT require
the `anthropic` SDK or `ANTHROPIC_API_KEY`. Both the trigger-eval step and
the improvement step use `claude -p` subprocesses (Max plan auth).

How it works:
  - Reuses skill-creator's `run_eval.py` via subprocess for the evaluation
    side (creates temp .claude/commands/ entries to test descriptions).
  - Calls `claude -p` directly for the improvement step (replaces the SDK
    `client.messages.create` call). No extended-thinking traces, just the
    final description.
  - Splits the eval set 60/40 into train/test; picks the best description
    by TEST score, not train, to avoid overfitting.
  - Iterates up to `--max-iterations`. Stops early if train hits 100%.

Usage:
  ./optimize-description.py \\
      --eval-set <trigger-eval.json> \\
      --skill-path <skill-dir> \\
      --max-iterations 5 \\
      [--model claude-opus-4-7] \\
      [--workspace <dir>] \\
      [--verbose]

Output: JSON to stdout with `best_description` + iteration log.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


def _resolve_skill_creator() -> Path:
    """Locate skill-creator's installed dir inside the claude-plugins-official
    cache. The middle segment is a per-install version slug (often "unknown"
    when the plugin is unversioned, but can change on re-fetch), so glob it."""
    cache_root = Path.home() / ".claude/plugins/cache/claude-plugins-official/skill-creator"
    hits = sorted(cache_root.glob("*/skills/skill-creator"))
    if not hits:
        sys.exit(
            "optimize-description.py needs the `skill-creator` plugin installed.\n"
            "Run: /plugin install skill-creator@claude-plugins-official"
        )
    return hits[-1]


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Return (name, description, body)."""
    text = (skill_path / "SKILL.md").read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        raise ValueError(f"No frontmatter in {skill_path}/SKILL.md")
    fm = yaml.safe_load(m.group(1))
    return fm.get("name", ""), fm.get("description", ""), m.group(2)


def update_description(skill_path: Path, new_description: str) -> None:
    """Rewrite SKILL.md frontmatter description field. Body untouched.

    Surgical edit: replace ONLY the `description:` line(s) — do not re-serialize
    the whole frontmatter (yaml.safe_dump mangles styling, breaks `>-` blocks).
    """
    p = skill_path / "SKILL.md"
    text = p.read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        raise ValueError("No frontmatter")
    fm_text = m.group(1)

    # Normalize ALL whitespace in candidate to single spaces. Folded YAML
    # scalars (>-) require strict 2-space indentation on every continuation
    # line. Embedded newlines or tabs in the candidate text break this and
    # cause the YAML parser to see unindented "keys" on subsequent lines.
    # Collapse to a single logical line, then word-wrap for readability.
    normalized = " ".join(new_description.split())
    new_block = "description: >-\n  " + "\n  ".join(_wrap_text(normalized, 78))

    # Match `description: >-` followed by indented continuation lines, OR
    # a single-line `description: "..."` / `description: ...`.
    pattern = re.compile(
        r"^description:\s*(?:>-?|>|\||\".*?\"|.+?)$"  # opening line
        r"(?:\n(?:  .*|\t.*))*",                       # indented continuation
        re.MULTILINE,
    )
    if pattern.search(fm_text):
        new_fm_text = pattern.sub(new_block, fm_text, count=1)
    else:
        # No existing description — append (rare)
        new_fm_text = fm_text.rstrip() + "\n" + new_block

    p.write_text(f"---\n{new_fm_text}\n---\n{m.group(2)}")


def _wrap_text(text: str, width: int) -> list[str]:
    """Simple word-wrap respecting word boundaries. Splits on any whitespace
    so embedded newlines/tabs in the input don't escape the output."""
    out = []
    line = ""
    for word in text.split():
        if not line:
            line = word
        elif len(line) + 1 + len(word) <= width:
            line += " " + word
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def run_eval_subprocess(eval_set_path: Path, skill_path: Path, model: str, runs_per_query: int, verbose: bool) -> dict:
    """Invoke skill-creator's run_eval.py via subprocess.

    Reads CURRENT SKILL.md description (skill-creator's run_eval re-parses).
    Returns parsed JSON output.
    """
    skill_creator_dir = _resolve_skill_creator()
    cmd = [
        "python3",
        "-m",
        "scripts.run_eval",
        "--eval-set", str(eval_set_path),
        "--skill-path", str(skill_path),
        "--model", model,
        "--runs-per-query", str(runs_per_query),
    ]
    if verbose:
        cmd.append("--verbose")
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    if verbose:
        sys.stderr.write(f"$ cd {skill_creator_dir} && {' '.join(cmd)}\n")
    result = subprocess.run(
        cmd,
        cwd=skill_creator_dir,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(f"run_eval failed (exit {result.returncode}):\n{result.stderr}\n")
        raise RuntimeError("run_eval subprocess failed")
    return json.loads(result.stdout)


def build_improvement_prompt(
    skill_name: str,
    skill_body: str,
    current_description: str,
    eval_results: dict,
    history: list[dict],
) -> str:
    """Construct the prompt for `claude -p` to propose a better description."""
    failed_triggers = [r for r in eval_results["results"] if r["should_trigger"] and not r["pass"]]
    false_triggers = [r for r in eval_results["results"] if not r["should_trigger"] and not r["pass"]]
    train_score = f"{eval_results['summary']['passed']}/{eval_results['summary']['total']}"

    prompt = f"""You are optimizing the `description` field of a Claude Code skill. Claude reads only the description (no body) to decide whether to invoke the skill. Your goal: trigger correctly on relevant queries, skip irrelevant ones.

Skill name: {skill_name}

Current description:
<current_description>
{current_description}
</current_description>

Current train score: {train_score}
"""
    if failed_triggers:
        prompt += "\nFAILED TO TRIGGER (should have, didn't):\n"
        for r in failed_triggers:
            prompt += f'  - "{r["query"]}" (triggered {r["triggers"]}/{r["runs"]})\n'
    if false_triggers:
        prompt += "\nFALSE TRIGGERS (shouldn't have, did):\n"
        for r in false_triggers:
            prompt += f'  - "{r["query"]}" (triggered {r["triggers"]}/{r["runs"]})\n'

    if history:
        prompt += "\nPREVIOUS ATTEMPTS — do NOT repeat; try a structurally different angle:\n"
        for h in history:
            prompt += f'  [train={h.get("train", "?")}, test={h.get("test", "?")}] {h["description"][:200]}...\n'

    prompt += f"""

Skill body (for context — DO NOT regurgitate, just understand the skill's job):
<skill_body>
{skill_body[:3000]}
</skill_body>

Write a NEW description. Rules:
- Target ~100-200 words. Hard cap: 1024 characters.
- Phrase imperatively: "Use this skill when...", "Trigger on..."
- Focus on USER INTENT, not implementation.
- Generalize from failures — don't enumerate specific failed queries verbatim. Capture the broader intent shape.
- Make it distinctive — competes with N other skills for Claude's attention.
- Mix style across iterations; if past attempts didn't work, try a different sentence structure.

Respond with ONLY the new description text inside <new_description> tags. No preamble, no explanation.
"""
    return prompt


def claude_p_improve(prompt: str, model: str, verbose: bool) -> str:
    """Run `claude -p` with the improvement prompt, return parsed description."""
    cmd = ["claude", "-p", prompt, "--output-format", "text"]
    if model:
        cmd.extend(["--model", model])
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    if verbose:
        sys.stderr.write(f"$ claude -p <improvement-prompt> --model {model}\n")
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        sys.stderr.write(f"claude -p failed: {result.stderr}\n")
        raise RuntimeError("claude -p improvement failed")
    text = result.stdout
    m = re.search(r"<new_description>(.*?)</new_description>", text, re.DOTALL)
    if not m:
        # Fallback: take the whole response, stripped
        return text.strip().strip('"').strip("`")
    return m.group(1).strip().strip('"')


def shorten_if_needed(description: str, model: str, verbose: bool) -> str:
    """If over 1024 chars, ask claude -p to shorten."""
    if len(description) <= 1024:
        return description
    prompt = (
        f"This skill description is {len(description)} chars; hard cap is 1024. "
        "Shorten it while preserving the most important trigger words + intent coverage. "
        "Respond ONLY with the shortened version inside <new_description> tags.\n\n"
        f"<original>{description}</original>"
    )
    return claude_p_improve(prompt, model, verbose)


def split_eval_set(eval_set: list[dict], seed: int = 42) -> tuple[list[dict], list[dict]]:
    """60/40 train/test split."""
    rnd = random.Random(seed)
    shuffled = list(eval_set)
    rnd.shuffle(shuffled)
    n_train = max(1, int(len(shuffled) * 0.6))
    return shuffled[:n_train], shuffled[n_train:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--skill-path", required=True)
    ap.add_argument("--max-iterations", type=int, default=5)
    ap.add_argument("--model", default="claude-opus-4-7")
    ap.add_argument("--runs-per-query", type=int, default=3)
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    eval_set_path = Path(args.eval_set)
    skill_path = Path(args.skill_path)
    workspace = Path(args.workspace) if args.workspace else Path(tempfile.mkdtemp(prefix="rf-optdesc-"))
    workspace.mkdir(parents=True, exist_ok=True)

    eval_set = json.loads(eval_set_path.read_text())
    train_set, test_set = split_eval_set(eval_set)
    train_path = workspace / "train.json"
    test_path = workspace / "test.json"
    train_path.write_text(json.dumps(train_set, indent=2))
    test_path.write_text(json.dumps(test_set, indent=2))

    if args.verbose:
        sys.stderr.write(f"Train: {len(train_set)} queries | Test: {len(test_set)} queries\n")
        sys.stderr.write(f"Workspace: {workspace}\n")

    skill_name, original_description, skill_body = parse_skill_md(skill_path)
    history: list[dict] = []
    best = {"description": original_description, "train_score": -1, "test_score": -1}

    # Snapshot original to restore at the end (we revert before the final
    # write so iterations don't leave the skill in a half-optimized state)
    original_skill_text = (skill_path / "SKILL.md").read_text()

    try:
        for iteration in range(args.max_iterations):
            if args.verbose:
                sys.stderr.write(f"\n=== Iteration {iteration + 1}/{args.max_iterations} ===\n")

            # Evaluate current description on train
            train_results = run_eval_subprocess(train_path, skill_path, args.model, args.runs_per_query, args.verbose)
            train_score = train_results["summary"]["passed"] / max(train_results["summary"]["total"], 1)

            if args.verbose:
                sys.stderr.write(f"Train: {train_results['summary']['passed']}/{train_results['summary']['total']}\n")

            # Evaluate on test for the candidate ranking
            test_results = run_eval_subprocess(test_path, skill_path, args.model, args.runs_per_query, args.verbose)
            test_score = test_results["summary"]["passed"] / max(test_results["summary"]["total"], 1)
            if args.verbose:
                sys.stderr.write(f"Test:  {test_results['summary']['passed']}/{test_results['summary']['total']}\n")

            # Re-read actual description from disk (may have been updated mid-loop)
            _, current_desc, _ = parse_skill_md(skill_path)

            # Persist per-query results to workspace (so failing queries are
            # auditable after the loop ends).
            (workspace / f"iter-{iteration + 1}-eval-train.json").write_text(
                json.dumps(train_results, indent=2)
            )
            (workspace / f"iter-{iteration + 1}-eval-test.json").write_text(
                json.dumps(test_results, indent=2)
            )

            history.append({
                "iteration": iteration + 1,
                "description": current_desc,
                "train": f"{train_results['summary']['passed']}/{train_results['summary']['total']}",
                "test": f"{test_results['summary']['passed']}/{test_results['summary']['total']}",
                "train_score": train_score,
                "test_score": test_score,
                "train_results": train_results["results"],
                "test_results": test_results["results"],
            })

            if args.verbose:
                # Surface failures so the loop's reasoning is debuggable live.
                for label, res in [("Train", train_results), ("Test", test_results)]:
                    fails = [r for r in res["results"] if not r["pass"]]
                    if fails:
                        sys.stderr.write(f"{label} failures ({len(fails)}):\n")
                        for r in fails:
                            kind = "MISS" if r["should_trigger"] else "FALSE-TRIGGER"
                            sys.stderr.write(
                                f"  [{kind}] rate={r['triggers']}/{r['runs']} \"{r['query'][:90]}\"\n"
                            )

            if test_score > best["test_score"] or (test_score == best["test_score"] and train_score > best["train_score"]):
                best = {
                    "description": current_desc,
                    "train_score": train_score,
                    "test_score": test_score,
                    "iteration": iteration + 1,
                }

            # Stop early if train is perfect
            if train_score == 1.0:
                if args.verbose:
                    sys.stderr.write("Train at 100%, stopping early.\n")
                break

            # If this is the last iteration, don't bother improving
            if iteration == args.max_iterations - 1:
                break

            # Build + run improvement prompt
            improve_prompt = build_improvement_prompt(
                skill_name, skill_body, current_desc, train_results, history[:-1]
            )
            (workspace / f"iter-{iteration + 1}-prompt.txt").write_text(improve_prompt)
            new_desc = claude_p_improve(improve_prompt, args.model, args.verbose)
            new_desc = shorten_if_needed(new_desc, args.model, args.verbose)
            (workspace / f"iter-{iteration + 1}-new.txt").write_text(new_desc)

            if args.verbose:
                sys.stderr.write(f"New description ({len(new_desc)} chars):\n  {new_desc[:200]}...\n")

            # Apply for next iteration
            update_description(skill_path, new_desc)

    finally:
        # Restore best description (or original if best == original)
        update_description(skill_path, best["description"])

    output = {
        "best_description": best["description"],
        "best_train_score": best["train_score"],
        "best_test_score": best["test_score"],
        "best_iteration": best.get("iteration", 0),
        "history": history,
        "workspace": str(workspace),
    }
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
