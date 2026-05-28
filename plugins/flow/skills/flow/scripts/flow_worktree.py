"""flow_worktree.py — post-approval bootstrap for the fire-and-forget pipeline.

After `/flow spec` approves a plan (ExitPlanMode), this seeds a git worktree so a
fresh `claude --bg "/flow do <KEY>"` resumes directly at the implement stage:

  1. git worktree add -b <branch> <worktree> <base>
  2. copy gitignored dev config main->worktree; ensure .flow/.initialized +
     workspace.toml exist (a git worktree only materializes committed files)
  3. mise trust the worktree (toolchain) unless --no-mise-trust
  4. point the worktree's [memory].root at the main checkout's .flow (shared store,
     so per-ticket worktrees don't fragment the compounding-knowledge layer)
  5. seed state.json: plan marked completed with its output_path; plan.out written
     from --plan-from; ticket left pending so the bg tail self-fetches ticket.json
     and stamps frontmatter (keeps the bootstrap offline; tracker auth stays in bg)
  6. stamp commit_type/commit_summary into the worktree frontmatter so the commit
     stage does not block on AskUserQuestion under --bg
  7. print the worktree path + the `claude --bg` launch line

The bootstrap holds NO lease; the bg session's cmd_init acquires it under the
run_id seeded here (it sees that run_id as the owner, so resume is clean).

Exit codes:
  0 = ok (may carry warnings on stderr)
  1 = git / worktree error
  2 = bad args / missing main workspace config
  3 = I/O error
"""

from __future__ import annotations

import argparse
import secrets
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import _atomicio
import _workspace
import state
import ticket_frontmatter

Runner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]

# Gitignored dev config the autonomous tail needs but a fresh worktree won't have.
_DEFAULT_COPY = [
    ".env",
    ".envrc",
    ".claude",
    ".cursor",
    ".vscode",
    "mise.local.toml",
    ".mise.local.toml",
]


def _default_runner() -> Runner:
    def run(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, check=False)

    return run


class _GitError(Exception):
    """git command failed. Exit code 1."""


class _ConfigError(Exception):
    """missing/invalid main workspace config. Exit code 2."""


def _git(args: list[str], cwd: Path, runner: Runner) -> str:
    result = runner(["git", *args], cwd)
    if result.returncode != 0:
        raise _GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _set_memory_root(toml_text: str, root: str) -> str:
    """Insert/replace `root = "<root>"` under the [memory] table, preserving the
    rest of the file (comments, ordering). Assumes a [memory] section exists (a
    valid flow workspace always has one)."""
    lines = toml_text.splitlines()
    out: list[str] = []
    in_memory = False
    replaced = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            # leaving the [memory] table without having seen a root key -> inject now
            if in_memory and not replaced:
                out.append(f'root = "{root}"')
                replaced = True
            in_memory = stripped == "[memory]"
            out.append(line)
            continue
        if in_memory and stripped.startswith("root") and "=" in stripped:
            out.append(f'root = "{root}"')
            replaced = True
            continue
        out.append(line)
    if in_memory and not replaced:  # [memory] was the last table in the file
        out.append(f'root = "{root}"')
        replaced = True
    if not replaced:  # no [memory] table at all
        out.append("[memory]")
        out.append(f'root = "{root}"')
    return "\n".join(out) + "\n"


def _copy_config(main_root: Path, worktree: Path, extra: list[str]) -> list[str]:
    """Copy gitignored dev config main->worktree. Returns the list copied."""
    copied: list[str] = []
    for rel in [*_DEFAULT_COPY, *extra]:
        src = main_root / rel
        if not src.exists():
            continue
        dst = worktree / rel
        if src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        copied.append(rel)
    return copied


def _ensure_flow_config(main_root: Path, worktree: Path, shared_flow: Path) -> None:
    """Ensure the worktree has .flow/.initialized + workspace.toml (copying from
    main when absent — the gitignored case), then point [memory].root at the
    shared store."""
    wt_flow = worktree / ".flow"
    wt_ws = wt_flow / "workspace.toml"
    if not wt_ws.exists():
        main_ws = main_root / ".flow" / "workspace.toml"
        if not main_ws.exists():
            raise _ConfigError(
                f"no workspace.toml at {main_ws}; run /flow init in the main checkout first"
            )
        wt_flow.mkdir(parents=True, exist_ok=True)
        shutil.copy2(main_ws, wt_ws)
    marker = wt_flow / ".initialized"
    if not marker.exists():
        main_marker = main_root / ".flow" / ".initialized"
        if main_marker.exists():
            shutil.copy2(main_marker, marker)
        else:
            marker.touch()
    # redirect the memory store to the shared (main) .flow
    wt_ws.write_text(
        _set_memory_root(wt_ws.read_text(encoding="utf-8"), str(shared_flow)), encoding="utf-8"
    )


def _seed_state(worktree: Path, ticket: str, plan_text: str, head_sha: str) -> str:
    """Seed state.json: plan completed (with plan.out as its output_path); ticket
    left pending so the bg tail self-fetches it. Returns the run_id."""
    data = _workspace.load_workspace_toml(worktree)
    tracker = data.get("tracker")
    backend = tracker.get("backend") if isinstance(tracker, dict) else None
    pipeline = data.get("pipeline")
    stages = pipeline.get("stages") if isinstance(pipeline, dict) else None
    if not isinstance(backend, str) or not isinstance(stages, list):
        raise _ConfigError("worktree workspace.toml missing tracker.backend or pipeline.stages")

    ticket_dir = worktree / ".flow" / "runs" / ticket
    run_id = secrets.token_hex(8)
    state.init(ticket_dir, ticket, backend, list(stages), run_id=run_id)

    if "plan" in stages:
        state.begin_stage(ticket_dir, "plan", head_sha)
        plan_out = ticket_dir / "stages" / "plan.out"
        _atomicio.atomic_write_text(plan_out, plan_text)
        state.finish_stage(ticket_dir, "plan", "completed", head_sha, output_path=str(plan_out))
    return run_id


def _worktree_path(main_root: Path, branch: str, override: str | None) -> Path:
    if override:
        return Path(override).expanduser().resolve()
    main = main_root.resolve()
    return main.parent / f"{main.name}.worktrees" / branch.replace("/", "-")


def bootstrap(
    *,
    ticket: str,
    plan_from: Path,
    base: str,
    branch: str,
    main_root: Path,
    worktree_override: str | None = None,
    extra_copy: list[str] | None = None,
    commit_type: str | None = None,
    commit_summary: str | None = None,
    mise_trust: bool = True,
    runner: Runner | None = None,
) -> dict:
    run = runner or _default_runner()
    main_root = main_root.expanduser().resolve()
    plan_text = plan_from.read_text(encoding="utf-8")
    worktree = _worktree_path(main_root, branch, worktree_override)
    warnings: list[str] = []

    _git(["worktree", "add", "-b", branch, str(worktree), base], main_root, run)

    copied = _copy_config(main_root, worktree, extra_copy or [])
    _ensure_flow_config(main_root, worktree, main_root / ".flow")

    if mise_trust and ((worktree / "mise.toml").exists() or (worktree / ".mise.toml").exists()):
        result = run(["mise", "trust"], worktree)
        if result.returncode != 0:
            warnings.append(
                f"mise trust failed: {result.stderr.strip()} (the bg tail may die on first `mise run`)"
            )

    head_sha = _git(["rev-parse", "HEAD"], worktree, run)
    run_id = _seed_state(worktree, ticket, plan_text, head_sha)

    fm_updates: dict[str, str] = {}
    if commit_type:
        fm_updates["commit_type"] = commit_type
    if commit_summary:
        fm_updates["commit_summary"] = commit_summary
    if fm_updates:
        ticket_frontmatter.update(worktree / ".flow" / "tickets" / f"{ticket}.md", fm_updates)

    return {
        "ticket": ticket,
        "branch": branch,
        "worktree": str(worktree),
        "run_id": run_id,
        "copied": copied,
        "warnings": warnings,
        "launch_cmd": f'cd {worktree} && claude --bg "/flow do {ticket}"',
    }


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="/flow worktree bootstrap for the background tail."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create", help="Create a worktree + seed state for the bg tail.")
    p.add_argument("--ticket", required=True)
    p.add_argument("--plan-from", required=True, help="path to the approved plan file")
    p.add_argument("--base", required=True, help="base branch/ref for the new worktree")
    p.add_argument("--branch", required=True, help="new branch name (e.g. feature/FT-1-thing)")
    p.add_argument("--main-root", default=".", help="path to the main checkout (default cwd)")
    p.add_argument("--worktree-path", default=None, help="override the derived worktree path")
    p.add_argument("--copy", default=None, help="extra comma-separated gitignored paths to copy")
    p.add_argument("--commit-type", default=None)
    p.add_argument("--commit-summary", default=None)
    p.add_argument("--no-mise-trust", action="store_true")
    return parser.parse_args(argv)


def cli_main(argv: list[str]) -> int:
    import json

    args = _parse_args(argv)
    extra = [s.strip() for s in args.copy.split(",")] if args.copy else []
    try:
        result = bootstrap(
            ticket=args.ticket,
            plan_from=Path(args.plan_from).expanduser(),
            base=args.base,
            branch=args.branch,
            main_root=Path(args.main_root),
            worktree_override=args.worktree_path,
            extra_copy=extra,
            commit_type=args.commit_type,
            commit_summary=args.commit_summary,
            mise_trust=not args.no_mise_trust,
        )
    except _ConfigError as exc:
        sys.stderr.write(f"flow-worktree: {exc}\n")
        return 2
    except _GitError as exc:
        sys.stderr.write(f"flow-worktree: {exc}\n")
        return 1
    except OSError as exc:
        sys.stderr.write(f"flow-worktree: I/O error: {exc}\n")
        return 3

    for w in result["warnings"]:
        sys.stderr.write(f"flow-worktree: WARN {w}\n")
    sys.stdout.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
    sys.stderr.write(
        f"\nworktree ready at {result['worktree']}\nfire the tail:\n  {result['launch_cmd']}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(cli_main(sys.argv[1:]))
