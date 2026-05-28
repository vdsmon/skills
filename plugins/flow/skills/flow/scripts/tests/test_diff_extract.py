"""Tests for diff_extract.py — git diff capture for flow stages.

Uses real tmp git repos for fidelity (binary capture, rename detection, blob
sha behavior are git-internal and not worth mocking).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

import diff_extract
import state

# ─── Tmp git repo fixture ────────────────────────────────────────────────────


def _git(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    """Initialize a tmp git repo with one initial commit."""
    _git(["init", "--initial-branch=main"], tmp_path)
    _git(["config", "user.email", "test@example.com"], tmp_path)
    _git(["config", "user.name", "test"], tmp_path)
    (tmp_path / "README.md").write_text("# initial\n", encoding="utf-8")
    _git(["add", "README.md"], tmp_path)
    _git(["commit", "-m", "initial"], tmp_path)
    return tmp_path


# ─── since ───────────────────────────────────────────────────────────────────


def test_since_returns_files_touched(tmp_repo: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    (tmp_repo / "a.py").write_text("print('hi')\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "add a"], tmp_repo)
    payload = diff_extract.diff_since(initial, tmp_repo)
    assert payload["files_touched"] == ["a.py"]
    assert payload["insertions"] == 1
    assert payload["deletions"] == 0
    assert payload["binary"] is False


def test_since_counts_insertions_deletions(tmp_repo: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    (tmp_repo / "a.py").write_text("line1\nline2\nline3\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "add"], tmp_repo)
    (tmp_repo / "a.py").write_text("line1\nline2-changed\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "modify"], tmp_repo)
    payload = diff_extract.diff_since(initial, tmp_repo)
    assert payload["insertions"] == 2
    assert payload["deletions"] == 0


def test_since_detects_binary(tmp_repo: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    (tmp_repo / "blob.bin").write_bytes(bytes(range(256)))
    _git(["add", "blob.bin"], tmp_repo)
    _git(["commit", "-m", "add binary"], tmp_repo)
    payload = diff_extract.diff_since(initial, tmp_repo)
    assert payload["binary"] is True


def test_since_multiple_files(tmp_repo: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    (tmp_repo / "a.py").write_text("a\n", encoding="utf-8")
    (tmp_repo / "b.py").write_text("b\n", encoding="utf-8")
    _git(["add", "."], tmp_repo)
    _git(["commit", "-m", "add multi"], tmp_repo)
    payload = diff_extract.diff_since(initial, tmp_repo)
    assert sorted(payload["files_touched"]) == ["a.py", "b.py"]


def test_since_no_changes(tmp_repo: Path) -> None:
    head = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    payload = diff_extract.diff_since(head, tmp_repo)
    assert payload["files_touched"] == []
    assert payload["insertions"] == 0
    assert payload["deletions"] == 0


def test_since_invalid_ref_raises(tmp_repo: Path) -> None:
    with pytest.raises(diff_extract._GitError, match="git diff"):
        diff_extract.diff_since("not-a-ref", tmp_repo)


# ─── since-stage ─────────────────────────────────────────────────────────────


def _seed_state(ticket_dir: Path, stage: str, head_sha: str) -> None:
    state.init(ticket_dir, "FT-1", "jira", [stage])
    state.begin_stage(ticket_dir, stage, head_sha)


def test_since_stage_reads_started_at_sha(tmp_repo: Path, tmp_path: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    ticket_dir = tmp_path / "runs" / "FT-1"
    _seed_state(ticket_dir, "implement", initial)
    (tmp_repo / "a.py").write_text("x\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "add a"], tmp_repo)
    payload = diff_extract.diff_since_stage("implement", ticket_dir, tmp_repo)
    assert payload["files_touched"] == ["a.py"]


def test_since_stage_missing_state_exits_1(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "missing"
    with pytest.raises(diff_extract._BaselineMissing):
        diff_extract.diff_since_stage("implement", ticket_dir, tmp_repo)


def test_since_stage_missing_stage_record_exits_1(tmp_repo: Path, tmp_path: Path) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    ticket_dir = tmp_path / "runs" / "FT-1"
    _seed_state(ticket_dir, "implement", initial)
    with pytest.raises(diff_extract._BaselineMissing, match=r"not in state\.json"):
        diff_extract.diff_since_stage("commit", ticket_dir, tmp_repo)


def test_since_stage_pending_no_started_sha_raises(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    state.init(ticket_dir, "FT-1", "jira", ["implement"])
    with pytest.raises(diff_extract._BaselineMissing, match="no started_at_sha"):
        diff_extract.diff_since_stage("implement", ticket_dir, tmp_repo)


# ─── record-baseline ─────────────────────────────────────────────────────────


def test_record_baseline_writes_file(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    payload = diff_extract.record_baseline("implement", ticket_dir, tmp_repo)
    bpath = ticket_dir / "baseline.json"
    assert bpath.exists()
    loaded = json.loads(bpath.read_text(encoding="utf-8"))
    assert loaded["stage"] == "implement"
    assert loaded["head_sha"] == payload["head_sha"]
    assert loaded["planned_files"] == []
    assert loaded["blobs"] == {}


def test_record_baseline_with_files(tmp_repo: Path, tmp_path: Path) -> None:
    (tmp_repo / "src").mkdir()
    (tmp_repo / "src" / "a.py").write_text("a\n", encoding="utf-8")
    _git(["add", "src/a.py"], tmp_repo)
    _git(["commit", "-m", "seed"], tmp_repo)
    ticket_dir = tmp_path / "runs" / "FT-1"
    payload = diff_extract.record_baseline("implement", ticket_dir, tmp_repo, files=["src/a.py"])
    assert payload["planned_files"] == ["src/a.py"]


def test_record_baseline_capture_blobs(tmp_repo: Path, tmp_path: Path) -> None:
    (tmp_repo / "src").mkdir()
    (tmp_repo / "src" / "a.py").write_text("a\n", encoding="utf-8")
    _git(["add", "src/a.py"], tmp_repo)
    _git(["commit", "-m", "seed"], tmp_repo)
    ticket_dir = tmp_path / "runs" / "FT-1"
    payload = diff_extract.record_baseline(
        "implement",
        ticket_dir,
        tmp_repo,
        files=["src/a.py"],
        capture_blobs=True,
    )
    assert "src/a.py" in payload["blobs"]
    entry = payload["blobs"]["src/a.py"]
    assert entry["mode"] == "100644"
    assert entry["type"] == "blob"
    assert len(entry["sha"]) == 40


def test_record_baseline_atomic_write(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    diff_extract.record_baseline("implement", ticket_dir, tmp_repo)
    diff_extract.record_baseline("implement", ticket_dir, tmp_repo, files=["x"])
    payload = json.loads((ticket_dir / "baseline.json").read_text(encoding="utf-8"))
    assert payload["planned_files"] == ["x"]


def test_record_baseline_outside_git_raises(tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    with pytest.raises(diff_extract._GitError, match="git rev-parse"):
        diff_extract.record_baseline("implement", ticket_dir, tmp_path)


# ─── capture-implement-diff ──────────────────────────────────────────────────


def test_capture_implement_diff_writes_file(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    diff_extract.record_baseline(
        "implement", ticket_dir, tmp_repo, files=["a.py"], capture_blobs=False
    )
    (tmp_repo / "a.py").write_text("hello\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "add a"], tmp_repo)
    out = diff_extract.capture_implement_diff(ticket_dir, tmp_repo)
    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert "a.py" in content


def test_capture_implement_diff_missing_baseline_raises(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    with pytest.raises(diff_extract._BaselineMissing, match=r"no baseline\.json"):
        diff_extract.capture_implement_diff(ticket_dir, tmp_repo)


def test_capture_implement_diff_malformed_baseline_raises(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    ticket_dir.mkdir(parents=True)
    (ticket_dir / "baseline.json").write_text("not json", encoding="utf-8")
    with pytest.raises(diff_extract._BaselineMissing, match="malformed"):
        diff_extract.capture_implement_diff(ticket_dir, tmp_repo)


def test_capture_implement_diff_binary_content(tmp_repo: Path, tmp_path: Path) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    diff_extract.record_baseline("implement", ticket_dir, tmp_repo, files=["blob.bin"])
    (tmp_repo / "blob.bin").write_bytes(bytes(range(256)))
    _git(["add", "blob.bin"], tmp_repo)
    _git(["commit", "-m", "add binary"], tmp_repo)
    out = diff_extract.capture_implement_diff(ticket_dir, tmp_repo)
    content = out.read_text(encoding="utf-8")
    assert "GIT binary patch" in content or "blob.bin" in content


def test_capture_implement_diff_with_rename(tmp_repo: Path, tmp_path: Path) -> None:
    """--raw flag surfaces rename metadata."""
    (tmp_repo / "old.py").write_text("content\n", encoding="utf-8")
    _git(["add", "old.py"], tmp_repo)
    _git(["commit", "-m", "add old"], tmp_repo)
    ticket_dir = tmp_path / "runs" / "FT-1"
    diff_extract.record_baseline("implement", ticket_dir, tmp_repo, files=["new.py"])
    _git(["mv", "old.py", "new.py"], tmp_repo)
    _git(["commit", "-m", "rename"], tmp_repo)
    out = diff_extract.capture_implement_diff(ticket_dir, tmp_repo)
    assert out.exists()


# ─── CLI ─────────────────────────────────────────────────────────────────────


def test_cli_since_emits_json(tmp_repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    (tmp_repo / "a.py").write_text("x\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "a"], tmp_repo)
    rc = diff_extract.cli_main(["since", "--ref", initial, "--cwd", str(tmp_repo)])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["files_touched"] == ["a.py"]


def test_cli_record_baseline_writes_and_exits_0(
    tmp_repo: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    rc = diff_extract.cli_main(
        [
            "record-baseline",
            "--stage",
            "implement",
            "--ticket",
            "FT-1",
            "--ticket-dir",
            str(ticket_dir),
            "--files",
            "a.py,b.py",
            "--cwd",
            str(tmp_repo),
        ]
    )
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["planned_files"] == ["a.py", "b.py"]


def test_cli_capture_implement_diff_missing_baseline_exits_1(
    tmp_repo: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    rc = diff_extract.cli_main(
        [
            "capture-implement-diff",
            "--ticket",
            "FT-1",
            "--ticket-dir",
            str(ticket_dir),
            "--cwd",
            str(tmp_repo),
        ]
    )
    assert rc == 1
    assert "no baseline.json" in capsys.readouterr().err


def test_cli_since_invalid_ref_exits_2(tmp_repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rc = diff_extract.cli_main(["since", "--ref", "garbage-ref", "--cwd", str(tmp_repo)])
    assert rc == 2
    assert "git diff" in capsys.readouterr().err


def test_cli_since_stage_uses_state(
    tmp_repo: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    initial = _git(["rev-parse", "HEAD"], tmp_repo).strip()
    ticket_dir = tmp_path / "runs" / "FT-1"
    _seed_state(ticket_dir, "implement", initial)
    (tmp_repo / "a.py").write_text("x\n", encoding="utf-8")
    _git(["add", "a.py"], tmp_repo)
    _git(["commit", "-m", "a"], tmp_repo)
    rc = diff_extract.cli_main(
        [
            "since-stage",
            "--stage",
            "implement",
            "--ticket",
            "FT-1",
            "--ticket-dir",
            str(ticket_dir),
            "--cwd",
            str(tmp_repo),
        ]
    )
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["files_touched"] == ["a.py"]


def test_cli_empty_files_list_normalized(
    tmp_repo: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ticket_dir = tmp_path / "runs" / "FT-1"
    rc = diff_extract.cli_main(
        [
            "record-baseline",
            "--stage",
            "implement",
            "--ticket",
            "FT-1",
            "--ticket-dir",
            str(ticket_dir),
            "--files",
            "  ,  ,",
            "--cwd",
            str(tmp_repo),
        ]
    )
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["planned_files"] == []
