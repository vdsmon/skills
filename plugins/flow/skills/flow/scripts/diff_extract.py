"""Git diff capture for the dispatcher's implement / commit / reflect stages.

Library + thin CLI. Stdlib-only.

Subcommands (per plan line 955):

  since --ref <git-ref>
      git diff --numstat <ref>..HEAD; emits {files_touched, insertions,
      deletions, binary} JSON.

  since-stage --stage <name> --ticket <key> --ticket-dir <dir>
      Reads <ticket-dir>/state.json for stages.<name>.started_at_sha; if absent
      exits 1. Then runs `since` mode with that sha.

  record-baseline --stage <name> --ticket <key> --ticket-dir <dir>
                  [--files <comma-sep>] [--capture-blobs]
      Writes <ticket-dir>/baseline.json: head_sha + planned_files + (when
      --capture-blobs set) per-file index entries via `git ls-files -s`.

  capture-implement-diff --ticket <key> --ticket-dir <dir>
      Reads baseline.json for {head_sha, planned_files}, runs `git diff
      --binary --raw <head_sha> -- <files>`, writes to
      <ticket-dir>/implement.diff.

Exit codes (per plan line 1014-1016):
  0 = ok
  1 = missing baseline / state.json
  2 = git error (stderr propagated)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import state

Runner = Callable[..., subprocess.CompletedProcess[str]]


def _default_runner() -> Runner:
    def run(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )

    return run


class _GitError(Exception):
    """Raised on git command failure. Exit code 2."""


class _BaselineMissing(Exception):
    """Raised when baseline.json or state.json absent. Exit code 1."""


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as tmp:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def _git(args: list[str], cwd: Path, runner: Runner) -> str:
    result = runner(["git", *args], cwd)
    if result.returncode != 0:
        raise _GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def _head_sha(cwd: Path, runner: Runner) -> str:
    return _git(["rev-parse", "HEAD"], cwd, runner).strip()


def _baseline_path(ticket_dir: Path) -> Path:
    return ticket_dir / "baseline.json"


def _implement_diff_path(ticket_dir: Path) -> Path:
    return ticket_dir / "implement.diff"


# ─── since / since-stage ─────────────────────────────────────────────────────


def diff_since(ref: str, cwd: Path, runner: Runner | None = None) -> dict[str, Any]:
    r = runner or _default_runner()
    raw = _git(["diff", "--numstat", f"{ref}..HEAD"], cwd, r)
    files_touched: list[str] = []
    insertions = 0
    deletions = 0
    binary = False
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        ins_s, del_s, path = parts[0], parts[1], parts[2]
        if ins_s == "-" or del_s == "-":
            binary = True
        else:
            insertions += int(ins_s)
            deletions += int(del_s)
        files_touched.append(path)
    return {
        "files_touched": files_touched,
        "insertions": insertions,
        "deletions": deletions,
        "binary": binary,
    }


def diff_since_stage(
    stage: str,
    ticket_dir: Path,
    cwd: Path,
    runner: Runner | None = None,
) -> dict[str, Any]:
    ts, exit_code = state.read(ticket_dir)
    if ts is None or exit_code == 2:
        raise _BaselineMissing(f"no usable state.json at {ticket_dir}")
    record = ts.stages.get(stage)
    if record is None:
        raise _BaselineMissing(f"stage {stage!r} not in state.json")
    if not record.started_at_sha:
        raise _BaselineMissing(f"stage {stage!r} has no started_at_sha")
    return diff_since(record.started_at_sha, cwd, runner)


# ─── record-baseline ─────────────────────────────────────────────────────────


def _ls_files_blobs(files: list[str], cwd: Path, runner: Runner) -> dict[str, dict[str, str]]:
    """Run `git ls-files -s -- <files>` and return mode/type/sha map per path.

    Format: `<mode> <sha> <stage>\t<path>` for each file.
    """
    if not files:
        return {}
    raw = _git(["ls-files", "-s", "--", *files], cwd, runner)
    blobs: dict[str, dict[str, str]] = {}
    for line in raw.splitlines():
        head, _, path = line.partition("\t")
        parts = head.split()
        if len(parts) < 3:
            continue
        mode, sha, _stage_num = parts[0], parts[1], parts[2]
        blobs[path] = {"mode": mode, "type": "blob", "sha": sha}
    return blobs


def record_baseline(
    stage: str,
    ticket_dir: Path,
    cwd: Path,
    files: list[str] | None = None,
    capture_blobs: bool = False,
    runner: Runner | None = None,
) -> dict[str, Any]:
    r = runner or _default_runner()
    head = _head_sha(cwd, r)
    blobs: dict[str, dict[str, str]] = {}
    files = files or []
    if capture_blobs and files:
        blobs = _ls_files_blobs(files, cwd, r)
    payload: dict[str, Any] = {
        "stage": stage,
        "head_sha": head,
        "planned_files": files,
        "blobs": blobs,
    }
    _atomic_write_text(
        _baseline_path(ticket_dir), json.dumps(payload, indent=2, sort_keys=True) + "\n"
    )
    return payload


# ─── capture-implement-diff ──────────────────────────────────────────────────


def capture_implement_diff(
    ticket_dir: Path,
    cwd: Path,
    runner: Runner | None = None,
) -> Path:
    r = runner or _default_runner()
    bpath = _baseline_path(ticket_dir)
    if not bpath.exists():
        raise _BaselineMissing(f"no baseline.json at {bpath}")
    try:
        baseline = json.loads(bpath.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise _BaselineMissing(f"baseline.json malformed: {exc}") from exc
    head_sha = baseline.get("head_sha")
    if not isinstance(head_sha, str) or not head_sha:
        raise _BaselineMissing("baseline.json missing head_sha")
    planned = baseline.get("planned_files", [])
    if not isinstance(planned, list):
        raise _BaselineMissing("baseline.json planned_files is not a list")
    args = ["diff", "--binary", "--raw", head_sha]
    if planned:
        args.append("--")
        args.extend(str(p) for p in planned)
    raw = _git(args, cwd, r)
    out_path = _implement_diff_path(ticket_dir)
    _atomic_write_text(out_path, raw)
    return out_path


# ─── CLI ─────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Git diff capture for /flow stages.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_since = sub.add_parser("since", help="git diff <ref>..HEAD numstat.")
    p_since.add_argument("--ref", required=True)
    p_since.add_argument("--cwd", default=".")

    p_stage = sub.add_parser("since-stage", help="diff since stage started_at_sha.")
    p_stage.add_argument("--stage", required=True)
    p_stage.add_argument("--ticket", required=True)
    p_stage.add_argument("--ticket-dir", required=True)
    p_stage.add_argument("--cwd", default=".")

    p_record = sub.add_parser("record-baseline", help="write baseline.json for the stage.")
    p_record.add_argument("--stage", required=True)
    p_record.add_argument("--ticket", required=True)
    p_record.add_argument("--ticket-dir", required=True)
    p_record.add_argument("--files", default=None, help="comma-separated planned files.")
    p_record.add_argument("--capture-blobs", action="store_true")
    p_record.add_argument("--cwd", default=".")

    p_capture = sub.add_parser("capture-implement-diff", help="dump implement.diff.")
    p_capture.add_argument("--ticket", required=True)
    p_capture.add_argument("--ticket-dir", required=True)
    p_capture.add_argument("--cwd", default=".")

    return parser.parse_args(argv)


def cli_main(argv: list[str]) -> int:
    args = _parse_args(argv)
    cwd = Path(args.cwd).resolve()

    try:
        if args.cmd == "since":
            payload = diff_since(args.ref, cwd)
            sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
            return 0

        if args.cmd == "since-stage":
            ticket_dir = Path(args.ticket_dir).resolve()
            payload = diff_since_stage(args.stage, ticket_dir, cwd)
            sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
            return 0

        if args.cmd == "record-baseline":
            ticket_dir = Path(args.ticket_dir).resolve()
            files: list[str] = []
            if args.files:
                files = [f.strip() for f in args.files.split(",") if f.strip()]
            payload = record_baseline(
                args.stage,
                ticket_dir,
                cwd,
                files=files,
                capture_blobs=args.capture_blobs,
            )
            sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
            return 0

        if args.cmd == "capture-implement-diff":
            ticket_dir = Path(args.ticket_dir).resolve()
            out = capture_implement_diff(ticket_dir, cwd)
            sys.stdout.write(json.dumps({"diff_path": str(out)}) + "\n")
            return 0

    except _BaselineMissing as exc:
        sys.stderr.write(f"diff-extract: {exc}\n")
        return 1
    except _GitError as exc:
        sys.stderr.write(f"diff-extract: {exc}\n")
        return 2

    return 1


if __name__ == "__main__":
    raise SystemExit(cli_main(sys.argv[1:]))


__all__ = [
    "capture_implement_diff",
    "cli_main",
    "diff_since",
    "diff_since_stage",
    "record_baseline",
]
