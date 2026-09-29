#!/usr/bin/env bash
# scan.sh: emit a categorized hit list for the strip-migration-cruft skill.
# This file is the single source of the scan patterns.
#
# Usage:
#   scan.sh <repo-root> [--include-archive]
#
# Output is grouped by bucket so the model can copy it directly into the
# proposal template. Uses ripgrep when it is on PATH, else grep -RIn.

set -euo pipefail

ROOT="${1:-.}"
INCLUDE_ARCHIVE=0
shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --include-archive) INCLUDE_ARCHIVE=1 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
    shift
done

if [[ ! -d "$ROOT" ]]; then
    echo "not a directory: $ROOT" >&2
    exit 2
fi
# The exclude globs are relative to the search root, so search from inside it.
cd "$ROOT"

RG=$(command -v rg || true)

SKIP_DIRS=(.git node_modules dist build .venv target)
if [[ $INCLUDE_ARCHIVE -eq 0 ]]; then
    SKIP_DIRS+=(archive)
fi

RG_EXCLUDES=()
GREP_EXCLUDES=()
FIND_PRUNE=(-name "${SKIP_DIRS[0]}")
for d in "${SKIP_DIRS[@]}"; do
    RG_EXCLUDES+=("--glob=!**/$d/**")
    GREP_EXCLUDES+=("--exclude-dir=$d")
    FIND_PRUNE+=(-o -name "$d")
done

SEEN=$(mktemp "${TMPDIR:-/tmp}/scan-seen.XXXXXX")
trap 'rm -f "$SEEN"' EXIT

scan() {
    local pattern="$1"
    if [[ -n "$RG" ]]; then
        "$RG" -n -i --no-heading "${RG_EXCLUDES[@]}" "$pattern" . 2>/dev/null || true
    else
        grep -RInEi "${GREP_EXCLUDES[@]}" "$pattern" . 2>/dev/null || true
    fi
}

# Bucket hits are remembered so Borderline only shows lines no bucket claimed.
hits() { scan "$1" | tee -a "$SEEN"; }

section() { printf '\n## %s\n\n' "$1"; }

section "A: Transitional preamble candidates"
hits '(old (server|box|host|lenovo|dell|imac)|replaced (on |20[0-9]{2}-)|salvaged from|died (apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar) 20|read-only legacy|historical reference only|EXECUTED on [0-9]|now (lives on|runs on|owned by))'

section "B: Wave/Story/Phase narrative candidates"
hits '(\(wave [0-9]\)|\(story [0-9]+\)|\(track [0-9]\)|authored (as part of|: story|: wave)|shipped in (wave|phase|track) [0-9]|wave [0-9] gotcha|wave [0-9] punchlist|wave [0-9] sweep|closed roadmap)'

section "C: Migration/roadmap doc candidates"
if [[ -n "$RG" ]]; then
    "$RG" --files "${RG_EXCLUDES[@]}" . 2>/dev/null | grep -Ei '(migration-matrix|MIGRATION|PHASES|migration_plan|ROADMAP|WAVE-[0-9])\.(md|MD)$' || true
else
    find . \( -type d \( "${FIND_PRUNE[@]}" \) -prune \) -o -type f \( -iname 'migration-matrix*' -o -iname 'MIGRATION*' -o -iname 'PHASES*' -o -iname 'migration_plan*' -o -iname 'ROADMAP*' -o -iname 'WAVE-*' \) -print 2>/dev/null || true
fi
hits '(phase 0 gate|status as of 20[0-9]{2}|🟢|🔵)'

section "D: Procedural step labels (likely KEEP, check RUNBOOK/PLAYBOOK/GUIDE/HOWTO context)"
hits '^## phase [0-9] — '
hits '^### [0-9]\.[0-9] — '

section "E: Code-semantic refs (likely KEEP, check surrounding code)"
hits '(# legacy (alias|field|attempts|schema|tracks)|# backfill path|# synthesize.*from legacy fields|# (mirror|matches) the legacy .*schema|live-migration|legacy pci|schema migration|migration trap)'

section "Borderline (raw migration/phase/wave/legacy/formerly/previously hits not listed above, manual classify)"
scan '(phase [0-9]|wave[ -][0-9]|story [0-9]+|track [0-9]|migration|migrated|formerly|previously|legacy|backfill|rollout|cutover|punchlist|roadmap|replaced with|transitioned from|moved (from|to) )' \
    | awk -v seen_file="$SEEN" '
        FILENAME == seen_file { split($0, k, ":"); seen[k[1] ":" k[2]] = 1; next }
        { split($0, k, ":"); if (!((k[1] ":" k[2]) in seen)) print }' "$SEEN" - \
    | head -200 || true
