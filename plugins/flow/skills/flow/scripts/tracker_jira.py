"""JiraAdapter — Atlassian Jira Cloud adapter for the Tracker protocol.

Phase 3 implementation target. Phase 1-2 ships a stub that raises at
construction so callers see an honest "adapter not yet wired" error rather than
an ImportError.

When this module is implemented:
- Capabilities advertised: comments_adf, attachments, watchers, sprints,
  fix_versions, components, epic_link, pr_links, ci_links, boards, custom_fields,
  transitions_with_validators, resolutions (all supported=true).
- `project_requires_pr()` reads Jira project workflow config (whether the "Done"
  transition has a linked-PR validator).
- `is_shipped()` is PURE READ; never writes under `.flow/`.
"""

from __future__ import annotations

from typing import Any


class JiraAdapter:
    """Phase-1 stub. Construction raises so callers see explicit not-implemented."""

    backend = "jira"

    def __init__(self, config: dict[str, Any]) -> None:
        del config
        raise NotImplementedError(
            "JiraAdapter is scheduled for phase 3 of the /flow build sequence. "
            "Workspace cannot select backend=jira until then. "
            "Use backend=beads for personal workspaces, or wait."
        )
