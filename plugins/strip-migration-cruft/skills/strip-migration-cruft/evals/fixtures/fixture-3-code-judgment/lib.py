"""Mixed code-semantic vs rot-comment fixture."""

from __future__ import annotations
from typing import Any


# legacy alias kept because callers still use the old import path
fetch = lambda url: _fetch_impl(url)


def _fetch_impl(url: str) -> dict[str, Any]:
    return {"url": url}


# Migrated from v1 schema in Q2 2024 — v1 used a flat dict, v2 uses nested.
# (This comment describes a change that already shipped; the code below
# only handles the v2 shape now and v1 support was removed two years ago.)
def parse_response(body: dict[str, Any]) -> str:
    return body["result"]["value"]


# Backfill path: even if cached=True, refresh metadata when stale.
def get_metadata(item_id: str, cached: bool = False) -> dict[str, Any]:
    if cached and not _is_stale(item_id):
        return _cache[item_id]
    fresh = _fetch_impl(f"/items/{item_id}")
    _cache[item_id] = fresh
    return fresh


_cache: dict[str, Any] = {}


def _is_stale(item_id: str) -> bool:
    return False


# Previously this used regex; switched to simple split in 2023 because regex
# was overkill. Kept the regex import just in case — it's dead code today.
def tokenize(s: str) -> list[str]:
    return s.lower().split()
