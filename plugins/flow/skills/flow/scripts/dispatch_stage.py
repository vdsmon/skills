"""State-machine driver for /flow do <ticket>.

Library + thin CLI. Stdlib-only. Imports `state` + `validate_workspace`.

Subcommands: `init`, `next`, `finish`, `status`. The dispatcher does NOT
invoke handlers itself; it reads/writes state.json and emits a handler-
descriptor JSON for the SKILL.md prose layer to act on.

Lifecycle: pending → in_progress (via `next`) → completed | failed (via
`finish`).

HARD GATE: validate_workspace.validate() runs on every `init` and every
`next`. Schema violation = exit 1, stderr lists violations.

Exit codes:
    0 = ok
    1 = generic error / validate-workspace failure / state malformed
    2 = no such ticket dir / not yet initialized
    7 = lost lease (RESERVED for phase 7-full; mvp never returns 7)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import state
import validate_workspace as vw

_STAGE_REGISTRY_RELATIVE = Path("stage-registry.toml")


# ─── Stage-registry handler defaults ─────────────────────────────────────────


@dataclass(frozen=True)
class StageMeta:
    name: str
    default_timeout_min: int
    reference_doc: str | None
    roles: list[str]


def _load_stage_meta(skill_root: Path) -> dict[str, StageMeta]:
    raw = (skill_root / _STAGE_REGISTRY_RELATIVE).read_bytes()
    data = tomllib.loads(raw.decode("utf-8"))
    stages = data.get("stage", [])
    out: dict[str, StageMeta] = {}
    for entry in stages:
        if not isinstance(entry, dict):
            continue
        out[entry["name"]] = StageMeta(
            name=entry["name"],
            default_timeout_min=int(entry.get("default_timeout_min", 10)),
            reference_doc=entry.get("reference_doc"),
            roles=list(entry.get("roles", []) or []),
        )
    return out


# ─── Handler-string parsing ──────────────────────────────────────────────────


def _parse_handler(value: str) -> dict[str, Any]:
    """Return a handler-descriptor dict. Assumes validate-workspace already passed."""
    if value == "inline":
        return {"handler_type": "inline"}
    if value == "none":
        return {"handler_type": "none"}
    if value.startswith("subagent:"):
        return {"handler_type": "subagent", "subagent_type": value[len("subagent:") :]}
    if value.startswith("skill:"):
        rest = value[len("skill:") :]
        if ":" in rest:
            name, _, args = rest.partition(":")
            return {"handler_type": "skill", "skill_name": name, "skill_args": args}
        return {"handler_type": "skill", "skill_name": rest, "skill_args": None}
    return {"handler_type": "unknown", "raw": value}


# ─── Git HEAD probe ──────────────────────────────────────────────────────────


def _git_head_sha(workspace_root: Path) -> str:
    try:
        cp = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return ""
    if cp.returncode != 0:
        return ""
    return cp.stdout.strip()


# ─── Public API ──────────────────────────────────────────────────────────────


def _skill_root_from_script() -> Path:
    # `__file__` = .../plugins/flow/skills/flow/scripts/dispatch_stage.py
    return Path(__file__).resolve().parent.parent


def _ticket_dir(workspace_root: Path, ticket: str) -> Path:
    return workspace_root / ".flow" / "runs" / ticket


def cmd_init(workspace_root: Path, ticket: str) -> tuple[int, dict[str, Any]]:
    result, snapshot = vw.validate(workspace_root)
    if snapshot is None:
        return 1, {
            "error": "validate-workspace failed",
            "violations": result.violations,
        }
    td = _ticket_dir(workspace_root, ticket)
    new_state = state.init(td, ticket, snapshot.backend, snapshot.stages)
    return 0, {
        "ticket": ticket,
        "run_id": new_state.run_id,
        "stages": snapshot.stages,
        "ticket_dir": str(td),
    }


def cmd_next(workspace_root: Path, ticket: str) -> tuple[int, dict[str, Any]]:
    result, snapshot = vw.validate(workspace_root)
    if snapshot is None:
        return 1, {
            "error": "validate-workspace failed",
            "violations": result.violations,
        }
    td = _ticket_dir(workspace_root, ticket)
    ts, exit_code = state.read(td)
    if ts is None:
        if exit_code == 2:
            return 1, {"error": f"unrecoverable state.json at {td}"}
        return 2, {"error": f"no state.json at {td}; run `dispatch init` first"}

    failed = state.find_failed(ts)
    if failed is not None:
        record = ts.stages[failed]
        return 0, {
            "done": False,
            "blocked_by": failed,
            "reason": record.failure_detail or "stage failed",
        }

    next_stage = state.pick_next_pending(ts, snapshot.stages)
    if next_stage is None:
        return 0, {"done": True}

    head_sha = _git_head_sha(workspace_root)
    state.begin_stage(td, next_stage, head_sha)

    stage_meta = _load_stage_meta(_skill_root_from_script()).get(next_stage)
    handler_descriptor = _parse_handler(snapshot.handlers[next_stage])

    output_path = td / "stages" / f"{next_stage}.out"
    payload: dict[str, Any] = {
        "done": False,
        "stage": next_stage,
        "timeout_min": stage_meta.default_timeout_min if stage_meta else 10,
        "head_sha": head_sha,
        "ticket_dir": str(td),
        "output_path": str(output_path),
        "roles": stage_meta.roles if stage_meta else [],
        **handler_descriptor,
    }
    if (
        stage_meta is not None
        and stage_meta.reference_doc
        and handler_descriptor["handler_type"] == "inline"
    ):
        payload["reference_doc"] = stage_meta.reference_doc
    return 0, payload


def cmd_finish(
    workspace_root: Path,
    ticket: str,
    stage_name: str,
    status_value: str,
    output_path: str | None = None,
    skill_output: dict[str, Any] | None = None,
    failure_detail: str | None = None,
) -> tuple[int, dict[str, Any]]:
    if status_value not in ("completed", "failed"):
        return 1, {"error": f"--status must be completed|failed, got {status_value!r}"}
    td = _ticket_dir(workspace_root, ticket)
    ts, exit_code = state.read(td)
    if ts is None:
        if exit_code == 2:
            return 1, {"error": f"unrecoverable state.json at {td}"}
        return 2, {"error": f"no state.json at {td}; run `dispatch init` first"}

    head_sha = _git_head_sha(workspace_root)
    try:
        new_state = state.finish_stage(
            td,
            stage_name,
            status_value,  # type: ignore[arg-type]
            head_sha,
            output_path=output_path,
            skill_output=skill_output,
            failure_detail=failure_detail,
        )
    except (ValueError, state.StateUnrecoverable) as exc:
        return 1, {"error": str(exc)}

    # Compute next_pending for caller convenience.
    _, snapshot = vw.validate(workspace_root)
    next_pending: str | None = None
    if snapshot is not None and state.find_failed(new_state) is None:
        next_pending = state.pick_next_pending(new_state, snapshot.stages)
    return 0, {
        "stage": stage_name,
        "status": status_value,
        "next_pending": next_pending,
    }


def cmd_status(workspace_root: Path, ticket: str) -> tuple[int, dict[str, Any]]:
    td = _ticket_dir(workspace_root, ticket)
    ts, exit_code = state.read(td)
    if ts is None:
        if exit_code == 2:
            return 1, {"error": f"unrecoverable state.json at {td}"}
        return 2, {"error": f"no state.json at {td}"}
    from dataclasses import asdict

    return exit_code, asdict(ts)


# ─── CLI ─────────────────────────────────────────────────────────────────────


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="/flow dispatcher state machine.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--ticket", required=True)
    common.add_argument("--workspace-root", default=".")

    sub.add_parser("init", parents=[common], help="Initialize per-ticket state.json.")
    sub.add_parser("next", parents=[common], help="Pick next pending stage.")
    sub.add_parser("status", parents=[common], help="Emit full state.json.")

    p_finish = sub.add_parser("finish", parents=[common], help="Mark stage terminal.")
    p_finish.add_argument("--stage", required=True)
    p_finish.add_argument(
        "--status", dest="status_value", choices=("completed", "failed"), required=True
    )
    p_finish.add_argument("--output-path", default=None)
    p_finish.add_argument("--skill-output", default=None)
    p_finish.add_argument("--failure-detail", default=None)

    return parser.parse_args(argv)


def cli_main(argv: list[str]) -> int:
    args = _parse_args(argv)
    workspace_root = Path(args.workspace_root).expanduser().resolve()

    if args.cmd == "init":
        rc, payload = cmd_init(workspace_root, args.ticket)
    elif args.cmd == "next":
        rc, payload = cmd_next(workspace_root, args.ticket)
    elif args.cmd == "finish":
        skill_output: dict[str, Any] | None = None
        if args.skill_output:
            try:
                parsed = json.loads(args.skill_output)
            except json.JSONDecodeError as exc:
                sys.stderr.write(f"dispatch finish: --skill-output not JSON: {exc}\n")
                return 1
            if not isinstance(parsed, dict):
                sys.stderr.write("dispatch finish: --skill-output must be a JSON object\n")
                return 1
            skill_output = parsed
        rc, payload = cmd_finish(
            workspace_root,
            args.ticket,
            args.stage,
            args.status_value,
            output_path=args.output_path,
            skill_output=skill_output,
            failure_detail=args.failure_detail,
        )
    elif args.cmd == "status":
        rc, payload = cmd_status(workspace_root, args.ticket)
    else:
        sys.stderr.write(f"unknown subcommand {args.cmd!r}\n")
        return 1

    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    if rc != 0:
        if "violations" in payload:
            for v in payload["violations"]:
                sys.stderr.write(v + "\n")
        elif "error" in payload:
            sys.stderr.write(str(payload["error"]) + "\n")
    return rc


if __name__ == "__main__":
    raise SystemExit(cli_main(sys.argv[1:]))


__all__ = [
    "cli_main",
    "cmd_finish",
    "cmd_init",
    "cmd_next",
    "cmd_status",
]
