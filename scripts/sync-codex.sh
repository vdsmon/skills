#!/usr/bin/env bash
# Regenerate every derived artifact from the authored sources (plugin.json + SKILL.md).
# Derived artifacts are generated, never hand-edited:
#   1. plugins/<p>/.codex-plugin  -> symlink to .claude-plugin (one manifest per plugin)
#   2. .claude-plugin/marketplace.json entries: description + version from each plugin.json
#   3. .agents/plugins/marketplace.json -> Codex marketplace, from the Claude marketplace
#   4. plugins/<p>/skills/<s>/agents/openai.yaml -> Codex policy for user-only skills
#   5. README.md plugin table between the BEGIN/END PLUGINS markers
#
# cc-* plugins are Claude-Code-only (hooks, dynamic ` !cmd ` injection, ${CLAUDE_SKILL_DIR},
# session-JSONL parsing) and won't function on Codex, so they get NO .codex-plugin symlink and
# are excluded from the Codex marketplace. A .codex-plugin dir means "Codex-installable".
#
# Idempotent. Does NOT commit. `mise run verify` and CI fail when it leaves a diff.
#
# Usage: scripts/sync-codex.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLAUDE_MARKET=".claude-plugin/marketplace.json"
[ -f "$CLAUDE_MARKET" ] || { echo "no $CLAUDE_MARKET" >&2; exit 1; }

# 1. Symlinks: one per Codex-eligible (non-cc-) plugin; remove any stray .codex-plugin on cc-* plugins.
for d in plugins/*/; do
  p="$(basename "$d")"
  link="$d.codex-plugin"
  if [[ "$p" == cc-* ]]; then
    rm -rf "$link"
    continue
  fi
  [ -d "$d.claude-plugin" ] || { echo "no .claude-plugin for '$p', skipping" >&2; continue; }
  rm -rf "$link"
  ln -s ".claude-plugin" "$link"
done

# 2-5 share the rules in scripts/repo_meta.py with scripts/check.py.
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$ROOT/scripts" python3 - <<'PY'
import json, re, sys
import repo_meta as rm

root = rm.ROOT

def write_if_changed(path, text, label):
    if path.exists() and path.read_text(encoding="utf-8") == text:
        print(f"{label}: up to date")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"{label}: updated")

# 2. Claude marketplace: each entry's description and version come from its plugin.json.
market = json.loads(rm.CLAUDE_MARKET.read_text(encoding="utf-8"))
manifests = {}
for entry in market["plugins"]:
    manifest = root / "plugins" / entry["name"] / ".claude-plugin" / "plugin.json"
    if not manifest.is_file():
        print(f"no plugin.json for marketplace entry '{entry['name']}', left as is", file=sys.stderr)
        continue
    pj = json.loads(manifest.read_text(encoding="utf-8"))
    manifests[entry["name"]] = pj
    entry["description"] = rm.marketplace_description(entry["name"], pj.get("description", ""))
    entry["version"] = pj.get("version", entry.get("version"))
write_if_changed(rm.CLAUDE_MARKET, json.dumps(market, indent=2, ensure_ascii=False) + "\n",
                 ".claude-plugin/marketplace.json")

# 3. Codex marketplace: the Claude marketplace minus cc-* plugins, remapped to Codex's schema.
codex = {
    "name": market["name"],
    "interface": {"displayName": market["name"]},
    "plugins": [
        {
            "name": p["name"],
            "source": {"source": "local", "path": p["source"]},
            "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            "category": "Engineering",
        }
        for p in market["plugins"]
        if not rm.is_cc(p["name"])
    ],
}
write_if_changed(root / ".agents/plugins/marketplace.json", json.dumps(codex, indent=2) + "\n",
                 f".agents/plugins/marketplace.json ({len(codex['plugins'])} plugins, cc-* excluded)")

# 4. Codex ignores disable-model-invocation. agents/openai.yaml with
#    allow_implicit_invocation: false hides the skill from Codex's model listing,
#    while an explicit $skill call still works.
wanted = rm.openai_yaml_targets()
written = removed = 0
for target in sorted(wanted):
    if target.exists() and not rm.is_generated_openai_yaml(target):
        print(f"{target.relative_to(root)}: hand-written, left alone", file=sys.stderr)
    elif not target.exists() or target.read_text(encoding="utf-8") != rm.OPENAI_YAML:
        target.parent.mkdir(exist_ok=True)
        target.write_text(rm.OPENAI_YAML, encoding="utf-8")
        written += 1
# The sweep also covers plugin dirs without a manifest, such as what a merge leaves
# behind of a removed plugin, and prunes the dirs it empties.
for target in sorted(root.glob("plugins/*/skills/*/agents/openai.yaml")):
    if target not in wanted and rm.is_generated_openai_yaml(target):
        target.unlink()
        removed += 1
        d = target.parent
        while d != root / "plugins" and not any(d.iterdir()):
            d.rmdir()
            d = d.parent
print(f"agents/openai.yaml: {written} written, {removed} removed")

# 5. README plugin table, one row per marketplace entry, text from plugin.json.
rows = [
    f"| `{p['name']}` | {'CC only' if rm.is_cc(p['name']) else 'any'} | "
    f"{rm.readme_blurb(manifests.get(p['name'], {}).get('description', p['description']))} |"
    for p in market["plugins"]
]
table = "\n".join(["| Plugin | Host | What it does |", "|---|---|---|", *rows])
block = f"<!-- BEGIN PLUGINS (generated) -->\n{table}\n<!-- END PLUGINS -->"
readme = root / "README.md"
text = readme.read_text(encoding="utf-8")
if "<!-- BEGIN PLUGINS (generated) -->" not in text:
    print("README: BEGIN/END PLUGINS markers not found, skipping", file=sys.stderr)
else:
    new = re.sub(r"<!-- BEGIN PLUGINS \(generated\) -->.*?<!-- END PLUGINS -->",
                 lambda _: block, text, flags=re.DOTALL)
    write_if_changed(readme, new, f"README.md ({len(rows)} plugins)")
PY

echo "Derived artifacts synced. Review the diff, then commit."
