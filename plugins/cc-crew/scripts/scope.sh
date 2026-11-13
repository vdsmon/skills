#!/bin/bash
# Turns the chief engineer role on or off in a repository, by setting or removing
# one key in its untracked .claude/settings.local.json. Every other key is kept.
# Usage: scope.sh on|off <repo>...
set -u

mode=${1:-}
if [ "$mode" != on ] && [ "$mode" != off ] || [ $# -lt 2 ]; then
  echo "usage: scope.sh on|off <repo>..." >&2
  exit 2
fi
shift

for repo in "$@"; do
  python3 - "$mode" "$repo" <<'PY' || exit 1
import json
import pathlib
import sys

mode, repo = sys.argv[1], pathlib.Path(sys.argv[2]).expanduser()
if not repo.is_dir():
    sys.exit(f"{repo}: not a folder")
path = repo / ".claude" / "settings.local.json"
data = json.loads(path.read_text()) if path.exists() else {}
if mode == "on":
    data["outputStyle"] = "cc-crew:chief-engineer"
else:
    data.pop("outputStyle", None)
if data or path.exists():
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
print(f"{repo}: role {mode}")
PY
  # The file must stay out of a team repository's history.
  if git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 && ! git -C "$repo" check-ignore -q .claude/settings.local.json; then
    echo "$repo: .claude/settings.local.json is not ignored by git; do not commit it" >&2
  fi
done
