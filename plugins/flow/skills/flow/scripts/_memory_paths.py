"""Shared path + namespace helpers for the memory cohort.

Avoids duplicating workspace.toml parsing across memory_append / recall /
reflect_inputs / observe_ship_event.
"""

from __future__ import annotations

import tomllib
from pathlib import Path


class _MemoryConfigError(Exception):
    """Raised when workspace.toml is missing or lacks [memory] namespace."""


def resolve_namespace(workspace_root: Path) -> str:
    """Read `.flow/workspace.toml` [memory] namespace.

    Raises `_MemoryConfigError` if workspace.toml missing or malformed.
    """
    path = workspace_root / ".flow" / "workspace.toml"
    if not path.exists():
        raise _MemoryConfigError(f"no workspace.toml at {path}")
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise _MemoryConfigError(f"workspace.toml does not parse: {exc}") from exc
    memory = data.get("memory")
    if not isinstance(memory, dict):
        raise _MemoryConfigError("workspace.toml missing [memory] block")
    namespace = memory.get("namespace")
    if not isinstance(namespace, str) or not namespace:
        raise _MemoryConfigError("workspace.toml missing or empty memory.namespace")
    return namespace


def namespace_root(workspace_root: Path, namespace: str) -> Path:
    return workspace_root / ".flow" / namespace


def knowledge_path(workspace_root: Path, namespace: str) -> Path:
    return namespace_root(workspace_root, namespace) / "knowledge.jsonl"


def knowledge_lock_path(workspace_root: Path, namespace: str) -> Path:
    return namespace_root(workspace_root, namespace) / "knowledge.jsonl.lock"


def ship_events_dir(workspace_root: Path, namespace: str) -> Path:
    return namespace_root(workspace_root, namespace) / "ship-events"


def ship_event_path(workspace_root: Path, namespace: str, ticket: str) -> Path:
    return ship_events_dir(workspace_root, namespace) / f"{ticket}.json"
