#!/usr/bin/env python3
"""Load and merge ship-it config from user + project files.

Reads:
  - User config:    SKILL_DIR/config.toml      (personal identity, e.g. account ID)
  - Project config: .ship-it.toml in repo root (workspace, repo slug, target)

Outputs merged JSON to stdout. Exits non-zero if a required key is missing.

Usage:
    load-config.py <skill_dir>             # Print merged config as JSON
    load-config.py <skill_dir> <key>       # Print a single value (dot notation)

Examples:
    load-config.py ~/.claude/plugins/ship-it/skills/ship-it
    load-config.py SKILL_DIR vcs.workspace
    load-config.py SKILL_DIR reviewers.user_account_id
"""

import json
from pathlib import Path
import sys

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore[no-redef]


REQUIRED = [
    ("vcs", "workspace"),
    ("vcs", "repo_slug"),
    ("reviewers", "user_account_id"),
]

DEFAULTS = {
    "vcs": {
        "default_target": "dev",
        "cli": "bkt",
    },
    "reviewer_bot": {
        "name": "coderabbit",
    },
}

SUPPORTED = {
    "vcs.cli": {"bkt"},
    "reviewer_bot.name": {"coderabbit"},
}


def load_toml(path: Path) -> dict:
    with open(path, "rb") as f:
        return tomllib.load(f)


def deep_merge(base: dict, override: dict) -> dict:
    """Override values from `override` win over `base`. Nested dicts merge recursively."""
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def flatten_get(data: dict, dotted_key: str):
    keys = dotted_key.split(".")
    current = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    skill_dir = Path(sys.argv[1]).expanduser()
    user_config_path = skill_dir / "config.toml"
    project_config_path = Path.cwd() / ".ship-it.toml"

    user = load_toml(user_config_path) if user_config_path.exists() else {}
    project = load_toml(project_config_path) if project_config_path.exists() else {}

    merged = deep_merge(deep_merge(DEFAULTS, user), project)

    missing = []
    for table, key in REQUIRED:
        if not merged.get(table, {}).get(key):
            source = (
                user_config_path
                if (table, key) == ("reviewers", "user_account_id")
                else project_config_path
            )
            missing.append(f"{table}.{key} (expected in {source})")

    if missing:
        print("ship-it config incomplete. Missing keys:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        print("\nSee references/preflight.md for setup.", file=sys.stderr)
        sys.exit(1)

    for dotted, allowed in SUPPORTED.items():
        val = flatten_get(merged, dotted)
        if val and val not in allowed:
            print(
                f"ship-it v0.1 only supports {dotted}={sorted(allowed)}. Got {val!r}.",
                file=sys.stderr,
            )
            sys.exit(1)

    if len(sys.argv) >= 3:
        value = flatten_get(merged, sys.argv[2])
        if value is None:
            print(f"Key not found: {sys.argv[2]}", file=sys.stderr)
            sys.exit(1)
        if isinstance(value, dict | list):
            print(json.dumps(value))
        else:
            print(value)
    else:
        print(json.dumps(merged, indent=2))


if __name__ == "__main__":
    main()
