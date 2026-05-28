"""BeadsAdapter — `bd` CLI subprocess adapter for the Tracker protocol.

Phase 6 implementation target. Phase 1-2 ships a stub that raises at
construction so callers see an honest "adapter not yet wired" error rather than
an ImportError.

When this module is implemented:
- Wraps `bd create / show / ready / update / comment add / link / dep add` via
  subprocess.
- Capabilities advertised: comments_markdown=true; everything else
  (comments_adf, attachments, watchers, sprints, fix_versions, components,
  epic_link, pr_links, ci_links, boards, custom_fields,
  transitions_with_validators, resolutions) = false. Workspace validator
  rejects pipelines that require unsupported capabilities.
- Preflight check: `bd --version` available + compatible.
- `is_shipped()` returns shipped iff bd state == closed AND a git commit
  references the ticket key (commit message OR frontmatter `commit_sha`).
"""

from __future__ import annotations

from typing import Any


class BeadsAdapter:
    """Phase-1 stub. Construction raises so callers see explicit not-implemented."""

    backend = "beads"

    def __init__(self, config: dict[str, Any]) -> None:
        del config
        raise NotImplementedError(
            "BeadsAdapter is scheduled for phase 6 of the /flow build sequence. "
            "Workspace cannot select backend=beads until then."
        )
