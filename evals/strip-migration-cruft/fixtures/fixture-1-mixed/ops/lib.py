"""DJ pipeline helpers."""

from __future__ import annotations
import re
from pathlib import Path
from typing import Any


# Post-2026-02 /items wraps the track object as `item` (not `track`).
# Keys inside `item` mirror the legacy /tracks track schema, plus we ask
# for album sub-fields needed for tag enrichment downstream.
FIELDS = (
    "items(is_local,item(id,name,duration_ms,track_number,external_ids,"
    "artists(name),type,album(id,name,release_date,images))),"
    "next,total"
)


def content_tokens(s: str) -> set[str]:
    return set(re.findall(r"\w+", s.lower()))


def _disk_tokens(s: str) -> set[str]:  # legacy alias, used internally below
    return content_tokens(s)


def upgrade_track(entry: dict[str, Any]) -> None:
    """Idempotent v1 -> v2 in-place upgrade. Synthesizes attempts[] from
    legacy `tried_users`/`status`/`backend` so reconciler has working memory.
    """
    entry.setdefault("attempts", [])

    # Synthesize attempts from legacy fields only on first upgrade pass.
    if entry["attempts"]:
        return

    status = entry.get("status")
    if status == "done" and entry.get("file"):
        entry["attempts"].append({"state": "succeeded"})
