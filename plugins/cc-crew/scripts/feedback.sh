#!/bin/bash
# The crew's feedback ledger: one file per entry, open/<id>.md until closed/<id>.md.
# Where an entry's file sits is its state; nothing reads inside an entry to decide one,
# except the one-time cut of the old single-file ledger. Nothing here deletes an entry
# or rewrites one: close appends and moves, and the only unlink is of a staging name
# whose content already lives under open/.
usage() {
  cat >&2 <<'EOF'
usage: feedback.sh file <piece> [session-id] < entry-text
       feedback.sh open
       feedback.sh close <id> <outcome>
EOF
  exit 2
}
set -u
export LC_ALL=C

base=${CC_CREW_HOME:-$HOME/.claude/.cc-crew}
ledger=$base/feedback
incoming=$ledger/.incoming

ensure_dirs() {
  mkdir -p "$ledger/open" "$ledger/closed" "$ledger/adopted" "$incoming" || {
    echo "feedback: cannot create $ledger" >&2
    exit 1
  }
}

slug() {
  local s
  s=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+//' | cut -c1-40 | sed -E 's/-+$//')
  printf '%s' "${s:-entry}"
}

# publish <staged-file> <id>: links the staged file to open/<id>.md under the first
# free id (<id>, <id>-2, ...). ln refuses an existing name atomically, so two sessions
# never share a file, and the entry appears whole or not at all. Prints the id used.
publish() {
  local staged=$1 id=$2 try=$2 n=1
  while [ -e "$ledger/closed/$try.md" ] || ! ln "$staged" "$ledger/open/$try.md" 2>/dev/null; do
    n=$((n + 1))
    [ "$n" -gt 999 ] && return 1
    try=$id-$n
  done
  rm -f "$staged"
  printf '%s' "$try"
}

cmd_file() {
  [ $# -ge 1 ] && [ $# -le 2 ] && [ -n "$1" ] || usage
  local piece=$1 session=${2:-unknown} stamp id staged
  ensure_dirs
  stamp=$(date '+%Y%m%d-%H%M%S %Y-%m-%d %H:%M')
  staged=$(mktemp "$incoming/file.XXXXXX") || exit 1
  if ! {
    printf '## %s · %s\n\n' "${stamp#* }" "$piece" &&
    printf -- '- Session: %s\n' "$session" &&
    printf -- '- Repository: %s\n\n' "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" &&
    cat &&
    printf '\n'
  } > "$staged"; then
    echo "feedback: could not write the entry; nothing filed (partial copy left at $staged)" >&2
    exit 1
  fi
  id=$(publish "$staged" "${stamp%% *}-$(slug "$piece")") || {
    echo "feedback: no free id; nothing filed (entry left at $staged)" >&2
    exit 1
  }
  echo "Filed as $id in $ledger/open/$id.md"
  exit 0
}

# cut <adopted-dir>: copies each entry of <dir>/feedback.md to its own file under open/,
# at each line shaped "## YYYY-MM-DD HH:MM · <piece>", then marks the dir done. A cut
# cut short by a crash is redone by the next open: duplicates show, lost entries would not.
cut_ledger() {
  local dir=$1 parts header d t piece id count=0 part
  parts=$(mktemp -d "$incoming/cut.XXXXXX") || return 1
  awk -v out="$parts" '
    BEGIN { f = out "/00000" }
    /^## [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9] · ./ {
      close(f); f = sprintf("%s/%05d", out, ++n)
    }
    { print > f }
  ' "$dir/feedback.md" || return 1
  for part in "$parts"/*; do
    [ -e "$part" ] || continue
    if [ "${part##*/}" = 00000 ]; then
      # Text before the first header: blank lines are dropped, anything else is an entry.
      grep -q '[^[:space:]]' "$part" || { rm -f "$part"; continue; }
      id=${dir##*/feedback-}
      id=${id%-*}-untitled
    else
      header=$(head -n 1 "$part")
      d=${header:3:10} t=${header:14:5} piece=${header#* · }
      id=${d//-/}-${t/:/}00-$(slug "$piece")
    fi
    publish "$part" "$id" >/dev/null || return 1
    count=$((count + 1))
  done
  rmdir "$parts" 2>/dev/null
  touch "$dir/cut-done" || return 1
  echo "$count"
}

# Adopts the old single-file ledger: move it whole into its own new dir under adopted/
# first (a rename, so a session still appending to it starts a fresh feedback.md and
# only one open wins), then cut copies from there.
adopt() {
  local dir n ok=0
  if [ -f "$base/feedback.md" ]; then
    if dir=$(mktemp -d "$ledger/adopted/feedback-$(date '+%Y%m%d-%H%M%S')-XXXXXX"); then
      mv "$base/feedback.md" "$dir/feedback.md" 2>/dev/null || rmdir "$dir"
    else
      echo "feedback: could not adopt $base/feedback.md; the next open retries" >&2
      ok=1
    fi
  fi
  for dir in "$ledger"/adopted/feedback-*; do
    [ -f "$dir/feedback.md" ] && [ ! -e "$dir/cut-done" ] || continue
    if n=$(cut_ledger "$dir"); then
      echo "Adopted $n entries from the old ledger, kept whole at $dir/feedback.md."
    else
      echo "feedback: could not finish adopting $dir/feedback.md; the next open retries" >&2
      ok=1
    fi
  done
  return "$ok"
}

cmd_open() {
  [ $# -eq 0 ] || usage
  ensure_dirs
  # An unfinished adoption leaves entries only under adopted/: print what is open, then
  # exit 1 so the caller does not take the list for the whole ledger.
  local adopted=0 ids id n_open n_closed
  adopt || adopted=1
  ids=$(ls "$ledger/open" | sed -n 's/\.md$//p' | sort)
  n_open=$(printf '%s' "$ids" | grep -c .)
  set -- "$ledger"/closed/*.md
  if [ -e "$1" ]; then n_closed=$#; else n_closed=0; fi
  if [ "$n_open" -eq 0 ]; then
    echo "No open entries; $n_closed closed."
    exit "$adopted"
  fi
  while IFS= read -r id; do
    printf '=== entry %s ===\n\n' "$id"
    cat "$ledger/open/$id.md"
    echo
  done <<< "$ids"
  echo "$n_open open, $n_closed closed."
  exit "$adopted"
}

cmd_close() {
  [ $# -eq 2 ] || usage
  local id=$1 outcome=$2 file
  case $id in
    '' | .* | *[!A-Za-z0-9._-]*)
      echo "feedback: '$id' is not an entry id" >&2
      exit 1
      ;;
  esac
  file=$ledger/open/$id.md
  if [ ! -f "$file" ]; then
    echo "feedback: no open entry $id" >&2
    exit 1
  fi
  if ! printf '%s' "$outcome" | grep -q '[^[:space:]]'; then
    echo "feedback: the outcome is empty; $id stays open" >&2
    exit 1
  fi
  if [ -e "$ledger/closed/$id.md" ]; then
    echo "feedback: closed/$id.md already exists; $id stays open" >&2
    exit 1
  fi
  # Append, then move: a failure in between leaves a visible open entry.
  printf '\n### Outcome · %s\n\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$outcome" >> "$file" || {
    echo "feedback: could not write the outcome to $file" >&2
    exit 1
  }
  mv -n "$file" "$ledger/closed/$id.md" && [ ! -e "$file" ] || {
    echo "feedback: outcome written but $id is still open at $file" >&2
    exit 1
  }
  echo "Closed $id: $ledger/closed/$id.md"
  exit 0
}

case ${1:-} in
  file) shift; cmd_file "$@" ;;
  open) shift; cmd_open "$@" ;;
  close) shift; cmd_close "$@" ;;
  *) usage ;;
esac
