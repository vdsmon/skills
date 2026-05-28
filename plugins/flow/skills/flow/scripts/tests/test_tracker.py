"""Contract tests for tracker.py — factory dispatch + capability advertisement.

Phase 2 deliverable. Adapter modules are stubs; this test asserts the factory
correctly hands construction off to them and surfaces stub failures as
`NotImplementedError` (not `ImportError`, not silent success).

Also asserts the Protocol's structural compatibility against a hand-rolled fake
adapter so the `@runtime_checkable` Tracker actually matches conforming objects.
"""

from __future__ import annotations

from typing import Any

import pytest

import tracker as t

# ─── Factory dispatch ───────────────────────────────────────────────────────


def test_make_tracker_rejects_missing_backend() -> None:
    with pytest.raises(t.TrackerConfigError, match=r"tracker\.backend missing"):
        t.make_tracker({})


def test_make_tracker_rejects_unknown_backend() -> None:
    with pytest.raises(t.TrackerConfigError, match="not recognized"):
        t.make_tracker({"backend": "github-projects"})


def test_make_tracker_rejects_none_backend() -> None:
    with pytest.raises(t.TrackerConfigError):
        t.make_tracker({"backend": None})


def test_make_tracker_jira_constructs_stub_then_raises_not_implemented() -> None:
    # Phase 1-2: the Jira adapter is a stub that raises at construction.
    # Phase 3 will replace this with a working adapter; the assertion flips to
    # "instance returned and capabilities advertised".
    with pytest.raises(NotImplementedError, match="phase 3"):
        t.make_tracker({"backend": "jira", "cloud_id": "x", "project_key": "FT"})


def test_make_tracker_beads_constructs_stub_then_raises_not_implemented() -> None:
    # Phase 1-2: the Beads adapter is a stub that raises at construction.
    # Phase 6 will replace this; the assertion flips at that point.
    with pytest.raises(NotImplementedError, match="phase 6"):
        t.make_tracker({"backend": "beads", "prefix": "safemic"})


def test_known_backends_enum_matches_factory_branches() -> None:
    # If KNOWN_BACKENDS grows, the factory MUST grow with it. This test catches
    # a future drift where a new backend is added to the enum but not wired in.
    for backend in t.KNOWN_BACKENDS:
        with pytest.raises((NotImplementedError, t.TrackerConfigError)):
            t.make_tracker({"backend": backend})


# ─── Exception hierarchy ─────────────────────────────────────────────────────


def test_not_supported_is_tracker_error() -> None:
    assert issubclass(t.NotSupported, t.TrackerError)


def test_tracker_config_error_is_tracker_error() -> None:
    assert issubclass(t.TrackerConfigError, t.TrackerError)


def test_tracker_error_is_exception() -> None:
    assert issubclass(t.TrackerError, Exception)


# ─── Capability advertisement shape ──────────────────────────────────────────


def test_capability_shape_accepts_closed_enum_names() -> None:
    # TypedDicts don't enforce literal membership at runtime, but the shape must
    # at least be writable for each enum value without TypeError.
    capabilities: list[t.Capability] = []
    enum_values = (
        "comments_adf",
        "comments_markdown",
        "attachments",
        "watchers",
        "sprints",
        "fix_versions",
        "components",
        "epic_link",
        "pr_links",
        "ci_links",
        "boards",
        "custom_fields",
        "transitions_with_validators",
        "resolutions",
    )
    for name in enum_values:
        cap: t.Capability = {
            "name": name,  # type: ignore[typeddict-item]
            "supported": True,
            "payload_schema": None,
        }
        capabilities.append(cap)
    assert len(capabilities) == 14
    assert {c["name"] for c in capabilities} == set(enum_values)


def test_capability_supported_false_is_legal() -> None:
    cap: t.Capability = {
        "name": "attachments",
        "supported": False,
        "payload_schema": None,
    }
    assert cap["supported"] is False


# ─── Protocol structural conformance ─────────────────────────────────────────


class _FakeAdapter:
    """Minimal Tracker conformant for structural Protocol matching."""

    backend = "fake"
    capabilities: list[t.Capability] = []  # noqa: RUF012 - test fixture, not shared state

    def get(self, key: str) -> t.Ticket:  # pragma: no cover - structural
        raise NotImplementedError

    def list_assigned(self, filter: str = "open") -> list[t.TicketRef]:  # pragma: no cover
        raise NotImplementedError

    def list_linked(self, key: str) -> list[t.TicketRef]:  # pragma: no cover
        raise NotImplementedError

    def list_transitions(self, key: str) -> list[t.Transition]:  # pragma: no cover
        raise NotImplementedError

    def create(
        self,
        summary: t.Content,
        description: t.Content,
        type: str,
        parent: str | None = None,
        labels: list[str] | None = None,
        assignee: str | None = None,
    ) -> str:  # pragma: no cover
        raise NotImplementedError

    def edit(self, key: str, fields: dict[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError

    def transition(
        self,
        key: str,
        transition_id: str,
        fields: dict[str, Any] | None = None,
    ) -> t.TransitionResult:  # pragma: no cover
        raise NotImplementedError

    def comment(self, key: str, body: t.Content) -> None:  # pragma: no cover
        raise NotImplementedError

    def link(self, from_key: str, to_key: str, kind: str) -> None:  # pragma: no cover
        raise NotImplementedError

    def state(self, key: str) -> t.TicketState:  # pragma: no cover
        raise NotImplementedError

    def project_requires_pr(self) -> bool:  # pragma: no cover
        return False

    def is_shipped(self, key: str) -> t.ShipState:  # pragma: no cover
        raise NotImplementedError

    def set_sprint(self, key: str, sprint_id: str) -> None:  # pragma: no cover
        raise t.NotSupported

    def list_sprints(self, project: str) -> list[t.Sprint]:  # pragma: no cover
        raise t.NotSupported

    def add_watcher(self, key: str, account_id: str) -> None:  # pragma: no cover
        raise t.NotSupported

    def set_fix_versions(self, key: str, versions: list[str]) -> None:  # pragma: no cover
        raise t.NotSupported

    def set_components(self, key: str, components: list[str]) -> None:  # pragma: no cover
        raise t.NotSupported

    def set_epic_link(self, key: str, epic_key: str) -> None:  # pragma: no cover
        raise t.NotSupported

    def board_rank(self, key: str, after_key: str | None) -> None:  # pragma: no cover
        raise t.NotSupported

    def set_custom_field(
        self,
        key: str,
        field_key: str,
        value: Any,
        schema: t.FieldSpec,
    ) -> None:  # pragma: no cover
        raise t.NotSupported

    def get_attachments(self, key: str) -> list[t.Attachment]:  # pragma: no cover
        raise t.NotSupported

    def upload_attachment(self, key: str, path: str) -> str:  # pragma: no cover
        raise t.NotSupported


def test_fake_adapter_is_structurally_a_tracker() -> None:
    # @runtime_checkable Protocols verify method NAMES, not signatures. The
    # presence of every required attribute is what we assert here.
    adapter = _FakeAdapter()
    assert isinstance(adapter, t.Tracker)


def test_object_missing_methods_is_not_a_tracker() -> None:
    class Partial:
        backend = "partial"
        capabilities: list[t.Capability] = []  # noqa: RUF012 - test fixture

        def get(self, key: str) -> t.Ticket:
            raise NotImplementedError

    assert not isinstance(Partial(), t.Tracker)


def test_capability_gated_methods_raise_not_supported_when_unsupported() -> None:
    # The contract is "capability-gated methods raise NotSupported when the
    # corresponding capability advertises supported=false". Verify with the
    # fake adapter that advertises nothing.
    adapter = _FakeAdapter()
    with pytest.raises(t.NotSupported):
        adapter.set_sprint("FT-1", "sprint-42")
    with pytest.raises(t.NotSupported):
        adapter.upload_attachment("FT-1", "/tmp/x.png")


# ─── Type roundtrips ─────────────────────────────────────────────────────────


def test_ticket_ref_subset_of_ticket() -> None:
    ref: t.TicketRef = {
        "key": "FT-1",
        "summary": "hi",
        "status": "Open",
        "priority": "High",
    }
    # Ticket extends TicketRef with additional required keys; building a Ticket
    # from a TicketRef base is the canonical adapter pattern.
    full: t.Ticket = {
        **ref,
        "description": "body",
        "type": "Task",
        "assignee": None,
        "comments": [],
        "parent": None,
        "attachments": [],
        "links": [],
    }
    assert full["key"] == ref["key"]
    assert full["description"] == "body"


def test_ship_state_pure_read_shape() -> None:
    # Frozen evidence case.
    frozen: t.ShipState = {
        "state": "shipped",
        "shipped_at": "2026-05-27T18:00:00Z",
        "evidence": {"tracker": "jira", "tracker_status": "Done"},
        "source": "frozen_event_file",
    }
    # Fresh observation case (workspace must persist).
    fresh: t.ShipState = {
        "state": "not_yet_observed",
        "shipped_at": None,
        "evidence": {"tracker_status": "Done", "pr_merge_commit_sha": "abc"},
        "source": "live_backend_query",
    }
    # Negative / unknown case.
    not_shipped: t.ShipState = {
        "state": "not_shipped",
        "shipped_at": None,
        "evidence": None,
        "source": "none",
    }
    assert frozen["source"] == "frozen_event_file"
    assert fresh["state"] == "not_yet_observed"
    assert not_shipped["evidence"] is None


def test_transition_result_failure_shape() -> None:
    res: t.TransitionResult = {
        "success": False,
        "failure_kind": "permission_denied",
        "failure_detail": "user is not assignee",
        "new_state": None,
    }
    assert res["success"] is False
    assert res["failure_kind"] == "permission_denied"


# ─── Public surface ──────────────────────────────────────────────────────────


def test_public_surface_in_dunder_all() -> None:
    expected = {
        "CAPABILITY_ENUM",
        "NORMALIZED_STATES",
        "Tracker",
        "make_tracker",
        "Capability",
        "Ticket",
        "TicketRef",
        "TicketState",
        "Transition",
        "TransitionResult",
        "ShipState",
        "Content",
        "FieldSpec",
        "TrackerError",
        "NotSupported",
        "TrackerConfigError",
        "KNOWN_BACKENDS",
    }
    assert expected.issubset(set(t.__all__))
