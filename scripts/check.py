#!/usr/bin/env python3
"""Check the repo invariants that CLAUDE.md states. Stdlib only.

Run from `mise run verify` and CI: python3 scripts/check.py
Exits 1 when any FAIL is printed. WARN lines never fail the run.
"""
import json
import re
import sys

sys.dont_write_bytecode = True
import repo_meta as rm

ROOT = rm.ROOT
SKILL_DESC_MAX = 280
PLUGIN_DESC_MAX = 300
FIRST_SENTENCE_MAX = 170
SKILL_LINES_AIM = 100
# prep-exit ships its own copy of prep-compact's audit script; they must not diverge.
IDENTICAL_COPIES = [
    ("plugins/prep-compact/skills/prep-compact/scripts/baseline.sh",
     "plugins/prep-exit/skills/prep-exit/scripts/baseline.sh"),
]

# Claude-Code-only features that an unprefixed (portable) plugin must not use.
INJECTION = re.compile(r"(?:^|\s)!`[^`\n]+`|^```!", re.MULTILINE)
CC_ONLY_TEXT = [
    (re.compile(r"\$\{?CLAUDE_SKILL_DIR\b"), "${CLAUDE_SKILL_DIR}"),
    (re.compile(r"\$\{?CLAUDE_PLUGIN_ROOT\b"), "${CLAUDE_PLUGIN_ROOT}"),
    (re.compile(r"\bclaude\s+(?:-p|--print)\b|[\"']claude[\"']\s*,\s*[\"'](?:-p|--print)[\"']"),
     "a `claude -p` call"),
]

fails, warns = [], []


def fail(where, msg):
    fails.append(f"FAIL {where}: {msg}")


def warn(where, msg):
    warns.append(f"WARN {where}: {msg}")


def rel(path):
    return path.relative_to(ROOT).as_posix()


def read_text(path):
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


def check_marketplace():
    market = json.loads(rm.CLAUDE_MARKET.read_text(encoding="utf-8"))
    entries = {p["name"]: p for p in market["plugins"]}
    dirs = {d.name for d in (ROOT / "plugins").iterdir() if d.is_dir()}
    for name in sorted(dirs - entries.keys()):
        fail(f"plugins/{name}", "plugin dir has no entry in .claude-plugin/marketplace.json")
    for name in sorted(entries.keys() - dirs):
        fail(".claude-plugin/marketplace.json", f"entry '{name}' has no plugins/{name} dir")
    manifests = {}
    for name in sorted(dirs & entries.keys()):
        entry = entries[name]
        where = f"plugins/{name}/.claude-plugin/plugin.json"
        if entry.get("source") != f"./plugins/{name}":
            fail(".claude-plugin/marketplace.json", f"'{name}' source must be ./plugins/{name}")
        path = ROOT / where
        if not path.is_file():
            fail(where, "missing")
            continue
        pj = json.loads(path.read_text(encoding="utf-8"))
        manifests[name] = pj
        if pj.get("name") != name:
            fail(where, f"name '{pj.get('name')}' must match the dir name '{name}'")
        if entry.get("version") != pj.get("version"):
            fail(".claude-plugin/marketplace.json",
                 f"'{name}' version {entry.get('version')} != plugin.json {pj.get('version')} (run scripts/sync-codex.sh)")
        desc = pj.get("description", "")
        if entry.get("description") != rm.marketplace_description(name, desc):
            fail(".claude-plugin/marketplace.json",
                 f"'{name}' description is not generated from plugin.json (edit plugin.json, then run scripts/sync-codex.sh)")
        check_plugin_description(where, desc)
    return manifests


def check_plugin_description(where, desc):
    if not desc:
        fail(where, "description is empty")
        return
    if len(desc) > PLUGIN_DESC_MAX:
        fail(where, f"description is {len(desc)} chars (max {PLUGIN_DESC_MAX})")
    first = rm.sentences(desc)[0]
    if len(first) > FIRST_SENTENCE_MAX:
        fail(where, f"first sentence is {len(first)} chars (max {FIRST_SENTENCE_MAX}); it becomes the README row")
    if rm.base_description(desc) != " ".join(desc.split()):
        warn(where, "description ends with a host note; sync-codex.sh adds the suffix, so drop it here")


def check_skills():
    for _plugin, skill_md in rm.skill_files():
        where = rel(skill_md)
        fm = rm.frontmatter(skill_md)
        if fm is None:
            fail(where, "no closed --- frontmatter block")
            continue
        for key in ("name", "description"):
            if not fm.get(key):
                fail(where, f"frontmatter has no {key}")
        desc = fm.get("description") or ""
        if len(desc) > SKILL_DESC_MAX:
            fail(where, f"description is {len(desc)} chars (max {SKILL_DESC_MAX})")
        if rm.is_user_only(fm) and "when_to_use" in fm:
            fail(where, "when_to_use is ignored on a disable-model-invocation skill; delete it")
        lines = skill_md.read_text(encoding="utf-8").count("\n")
        if lines > SKILL_LINES_AIM:
            warn(where, f"{lines} lines (aim for {SKILL_LINES_AIM} or fewer)")


def check_openai_yaml():
    wanted = rm.openai_yaml_targets()
    for target in sorted(wanted):
        where = rel(target)
        if not target.is_file():
            fail(where, "missing for a user-only skill (run scripts/sync-codex.sh)")
        elif rm.is_generated_openai_yaml(target):
            if target.read_text(encoding="utf-8") != rm.OPENAI_YAML:
                fail(where, "stale (run scripts/sync-codex.sh)")
        elif not re.search(r"^\s*allow_implicit_invocation:\s*false\b", target.read_text(encoding="utf-8"), re.MULTILINE):
            fail(where, "hand-written file must set policy.allow_implicit_invocation: false")
    for target in sorted(ROOT.glob("plugins/*/skills/*/agents/openai.yaml")):
        if target not in wanted and rm.is_generated_openai_yaml(target):
            fail(rel(target), "generated, but its skill is not a user-only skill of a portable plugin (run scripts/sync-codex.sh)")


def check_portable(manifests):
    for name, pj in sorted(manifests.items()):
        if rm.is_cc(name):
            continue
        plugin_dir = ROOT / "plugins" / name
        if "hooks" in pj or (plugin_dir / "hooks").exists():
            fail(f"plugins/{name}", "hooks are Claude-Code-only; rename the plugin to cc-* or drop them")
        for path in sorted(p for p in plugin_dir.rglob("*") if p.is_file() and not p.is_symlink()):
            text = read_text(path)
            if text is None:
                continue
            if path.suffix == ".md" and INJECTION.search(text):
                fail(rel(path), "uses !`cmd` dynamic injection, which is Claude-Code-only")
            for pattern, label in CC_ONLY_TEXT:
                if pattern.search(text):
                    fail(rel(path), f"uses {label}, which is Claude-Code-only")


def check_identical_copies():
    for a, b in IDENTICAL_COPIES:
        pa, pb = ROOT / a, ROOT / b
        if pa.is_file() and pb.is_file() and pa.read_bytes() != pb.read_bytes():
            fail(b, f"must stay byte-identical to {a}")


def main():
    manifests = check_marketplace()
    check_skills()
    check_openai_yaml()
    check_portable(manifests)
    check_identical_copies()
    for line in warns + fails:
        print(line)
    print(f"check.py: {len(fails)} failures, {len(warns)} warnings")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
