#!/usr/bin/env bash
# Regenerate the Codex marketplace artifacts from the Claude source of truth.
# Source of truth is .claude-plugin/* — derived artifacts are generated, never hand-edited:
#   1. plugins/<p>/.codex-plugin  -> symlink to .claude-plugin (manifest dedup, no version/description drift)
#   2. .agents/plugins/marketplace.json -> generated from .claude-plugin/marketplace.json
#   3. README.md plugin table -> generated between the BEGIN/END PLUGINS markers
#
# cc-* plugins are Claude-Code-only (hooks, dynamic ` !cmd ` injection, ${CLAUDE_SKILL_DIR},
# session-JSONL parsing) and won't function on Codex, so they get NO .codex-plugin symlink and
# are excluded from the Codex marketplace. A .codex-plugin dir means "Codex-installable".
#
# Idempotent: run after adding/removing/renaming a plugin. Does NOT commit.
#
# Usage: scripts/sync-codex.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLAUDE_MARKET=".claude-plugin/marketplace.json"
AGENTS_MARKET=".agents/plugins/marketplace.json"
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

# 2. Codex marketplace: derive from the Claude marketplace, dropping cc-* plugins, remapping schema.
mkdir -p "$(dirname "$AGENTS_MARKET")"
python3 - "$CLAUDE_MARKET" "$AGENTS_MARKET" <<'PY'
import json, sys
src, dst = sys.argv[1:3]
m = json.load(open(src))
plugins = [
    {
        "name": p["name"],
        "source": {"source": "local", "path": p["source"]},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Engineering",
    }
    for p in m["plugins"]
    if not p["name"].startswith("cc-")
]
out = {"name": m["name"], "interface": {"displayName": m["name"]}, "plugins": plugins}
with open(dst, "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
print(f"{dst}: {len(plugins)} plugins (cc-* excluded)")
PY

# 3. README plugin table: regenerate between the markers from the Claude marketplace.
python3 - "$CLAUDE_MARKET" README.md <<'PY'
import json, re, sys
src, readme = sys.argv[1:3]
m = json.load(open(src))

def short(desc, cap=170):
    # whole sentences only, up to the cap; drop any sentence that would
    # overflow rather than truncating it. Never adds an ellipsis. The first
    # sentence is always kept even if it alone exceeds the cap.
    parts = desc.strip().split(". ")
    out = parts[0]
    for p in parts[1:]:
        cand = f"{out}. {p}"
        if len(cand.rstrip(".")) + 1 > cap:
            break
        out = cand
    return (out.rstrip(".") + ".").replace("|", "\\|")

rows = [
    f"| `{p['name']}` | {'CC only' if p['name'].startswith('cc-') else 'any'} | {short(p['description'])} |"
    for p in m["plugins"]
]
table = "\n".join(["| Plugin | Host | What it does |", "|---|---|---|", *rows])
block = f"<!-- BEGIN PLUGINS (generated) -->\n{table}\n<!-- END PLUGINS -->"

text = open(readme).read()
new = re.sub(
    r"<!-- BEGIN PLUGINS \(generated\) -->.*?<!-- END PLUGINS -->",
    lambda _: block,
    text,
    flags=re.DOTALL,
)
if "<!-- BEGIN PLUGINS (generated) -->" not in text:
    print("README: BEGIN/END PLUGINS markers not found, skipping", file=sys.stderr)
elif new != text:
    open(readme, "w").write(new)
    print(f"README.md: {len(rows)} plugins")
else:
    print(f"README.md: up to date ({len(rows)} plugins)")
PY

echo "Codex artifacts synced. Review the diff, then commit."
