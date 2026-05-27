#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml"]
# ///
"""prewarm.py — Builds the uv ephemeral venv that status/dispatch-args/lint-spec share.

Those scripts declare the same PEP 723 deps (pyyaml + python >=3.10),
so uv caches a single venv keyed on the metadata hash. Running this script
once at session bootstrap forces uv to materialize that venv. Subsequent
script invocations hit the warm cache and skip the ~10-15s cold-start.

Idempotent. No output on success. Exit 0 always.

Usage: ./prewarm.py
"""
import sys

try:
    import yaml  # noqa: F401
except ImportError:
    sys.stderr.write("prewarm: yaml import failed — uv env not built. Did you invoke via uv?\n")
    sys.exit(1)
