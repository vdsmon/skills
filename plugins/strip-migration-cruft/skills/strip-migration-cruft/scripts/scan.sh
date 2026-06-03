#!/usr/bin/env bash
# scan.sh — emit a categorized hit list for the strip-migration-cruft skill.
#
# Usage:
#   scan.sh <repo-root> [--include-archive]
#
# Output is grouped by bucket so the model can copy it directly into the
# proposal template. Tries to use ripgrep at /opt/homebrew/bin/rg; falls
# back to system rg, then grep -RIn.

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

if command -v /opt/homebrew/bin/rg >/dev/null 2>&1; then
    RG=/opt/homebrew/bin/rg
elif command -v rg >/dev/null 2>&1; then
    RG=$(command -v rg)
else
    RG=""
fi

EXCLUDES=(
    "--glob=!.git/**"
    "--glob=!node_modules/**"
    "--glob=!dist/**"
    "--glob=!build/**"
    "--glob=!.venv/**"
    "--glob=!target/**"
)
if [[ $INCLUDE_ARCHIVE -eq 0 ]]; then
    EXCLUDES+=("--glob=!docs/archive/**" "--glob=!archive/**")
fi

scan() {
    local pattern="$1"
    if [[ -n "$RG" ]]; then
        "$RG" -n -i --no-heading "${EXCLUDES[@]}" "$pattern" "$ROOT" 2>/dev/null || true
    else
        grep -RInE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
            --exclude-dir=build --exclude-dir=.venv --exclude-dir=target \
            "$pattern" "$ROOT" 2>/dev/null || true
    fi
}

section() { printf '\n## %s\n\n' "$1"; }

section "A — Transitional preamble candidates"
scan '(old (server|box|host|lenovo|dell|imac)|replaced (on |20[0-9]{2}-)|salvaged from|died (apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar) 20|read-only legacy|historical reference only|EXECUTED on [0-9])'

section "B — Wave/Story/Phase narrative candidates"
scan '(\(wave [0-9]\)|\(story [0-9]+\)|\(track [0-9]\)|authored: story [0-9]+, wave [0-9]|shipped in (wave|phase|track) [0-9]|wave [0-9] gotcha|wave [0-9] punchlist|wave [0-9] sweep|closed roadmap)'

section "C — Migration/roadmap doc candidates"
if [[ -n "$RG" ]]; then
    "$RG" --files "${EXCLUDES[@]}" "$ROOT" 2>/dev/null | grep -Ei '(migration-matrix|MIGRATION|PHASES|migration_plan|ROADMAP|WAVE-[0-9])\.(md|MD)$' || true
else
    find "$ROOT" -type f \( -iname 'migration-matrix*' -o -iname 'MIGRATION*' -o -iname 'PHASES*' -o -iname 'migration_plan*' -o -iname 'ROADMAP*' -o -iname 'WAVE-*' \) 2>/dev/null || true
fi
scan '(phase 0 gate|status as of 20[0-9]{2}|🟢|🔵)'

section "D — Procedural step labels (likely KEEP — check RUNBOOK/PLAYBOOK/GUIDE/HOWTO context)"
scan '^## phase [0-9] — '
scan '^### [0-9]\.[0-9] — '

section "E — Code-semantic refs (likely KEEP — check surrounding code)"
scan '(# legacy (alias|field|attempts|schema|tracks)|# backfill path|# synthesize.*from legacy fields|# (mirror|matches) the legacy .*schema|live-migration|legacy pci|schema migration|migration trap)'

section "Borderline (raw migration/phase/wave/legacy/formerly/previously hits — manual classify)"
scan '(phase [0-9]|wave[ -][0-9]|story [0-9]+|migration|migrated|formerly|previously|legacy|backfill|rollout|cutover|punchlist|transitioned from|moved (from|to) )' | head -200
