#!/usr/bin/env bash
# Bump a plugin's version and sync its marketplace.json entry in lockstep.
# The two version fields (plugins/<p>/.claude-plugin/plugin.json and the
# marketplace.json entry) are the marketplace contract; a drift makes the
# published version lie. This keeps them equal with a surgical line edit, so
# no other plugin's entry is reformatted or touched.
#
# It does NOT commit. Review the diff, update the description in BOTH files if
# behavior changed (they differ: marketplace adds a portability suffix), then
# commit the plugin's files + the marketplace.json hunk and push (or open a PR).
#
# Usage: scripts/bump-plugin.sh <plugin-name> [patch|minor|major]   (default: patch)
#   patch = bug/wording fix   minor = new behavior or arg   major = breaking change
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="${1:?usage: bump-plugin.sh <plugin-name> [patch|minor|major]}"
LEVEL="${2:-patch}"

MANIFEST="$ROOT/plugins/$PLUGIN/.claude-plugin/plugin.json"
MARKET="$ROOT/.claude-plugin/marketplace.json"
[ -f "$MANIFEST" ] || { echo "no plugin.json for '$PLUGIN' at $MANIFEST" >&2; exit 1; }
[ -f "$MARKET" ]   || { echo "no marketplace.json at $MARKET" >&2; exit 1; }

python3 - "$PLUGIN" "$LEVEL" "$MANIFEST" "$MARKET" <<'PY'
import json, re, sys
plugin, level, manifest, market = sys.argv[1:5]

cur = json.load(open(manifest)).get("version", "")
m = re.match(r'^(\d+)\.(\d+)\.(\d+)$', cur)
if not m:
    sys.exit(f"version '{cur}' in {manifest} is not MAJOR.MINOR.PATCH")
major, minor, patch = (int(x) for x in m.groups())
if level == "major":   major, minor, patch = major + 1, 0, 0
elif level == "minor": minor, patch = minor + 1, 0
elif level == "patch": patch = patch + 1
else: sys.exit(f"level must be patch|minor|major, got '{level}'")
new = f"{major}.{minor}.{patch}"

def bump_scoped(path, name, newver):
    # Replace the version line belonging to `name`. name=None means single-object
    # file (plugin.json). Surgical: no json.dump, so sibling entries keep byte-identical.
    lines = open(path).read().splitlines(keepends=True)
    in_scope = name is None
    for i, ln in enumerate(lines):
        if name is not None and re.search(rf'"name"\s*:\s*"{re.escape(name)}"', ln):
            in_scope = True
        if in_scope and re.search(r'"version"\s*:\s*"[^"]*"', ln):
            lines[i] = re.sub(r'("version"\s*:\s*")[^"]*(")', rf'\g<1>{newver}\g<2>', ln)
            open(path, "w").write("".join(lines))
            return
    sys.exit(f"could not find a version line for {name or 'the manifest'} in {path}")

bump_scoped(manifest, None, new)
bump_scoped(market, plugin, new)

# both must still be valid JSON after the edit
for p in (manifest, market):
    json.load(open(p))

print(f"{plugin}: {cur} -> {new}")
PY

echo
echo "Synced version in plugin.json + marketplace.json (descriptions NOT touched)."
echo "If behavior changed, update the description in BOTH files, then commit the"
echo "plugin's files + the marketplace.json hunk and push (or open a PR)."
