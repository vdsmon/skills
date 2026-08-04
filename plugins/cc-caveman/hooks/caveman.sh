#!/usr/bin/env bash
# SessionStart hook: injects the full-mode caveman ruleset when opted in.
#
# Opt-in via ~/.cc-caveman flag file (existence = on, contents ignored).
# Cheapest check first: non-opt-in users pay one stat(2) and get zero output.
#
# Re-firing on resume/clear/compact is intentional - compaction prunes the
# ruleset out of context, and re-injection is what brings it back. With a
# single level there is no mid-session mode to clobber, so no source check.
#
# Fail open = fail silent: a missing SKILL.md must never break session start,
# so every error path exits 0 with no output.
set -u

FLAG="${HOME}/.cc-caveman"
[ -f "$FLAG" ] || exit 0
[ -n "${CC_CAVEMAN_OFF:-}" ] && exit 0

# Drain stdin (hook payload) so the parent never blocks on a full pipe.
[ -t 0 ] || cat >/dev/null 2>&1 || true

# Ruleset source of truth is the caveman skill body - read at runtime so
# SKILL.md edits propagate without touching this hook.
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL="${ROOT}/skills/caveman/SKILL.md"
[ -f "$SKILL" ] || exit 0

echo "<cc-caveman>"
echo "CAVEMAN MODE ACTIVE — level: full"
echo ""
# Body only: print everything after the closing --- of the YAML frontmatter.
awk 'f{print} /^---[[:space:]]*$/{if(++n==2) f=1}' "$SKILL"
echo "</cc-caveman>"
exit 0
