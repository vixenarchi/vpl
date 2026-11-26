#!/usr/bin/env bash
# What is where. Generated, never hand-written, so it cannot be out of date.
#
#   tools/map.sh
#
# An agent (or a person three months from now) needs one page that answers
# "which tables does this app own, which port does it answer on, which test
# proves it still works". Everything below is read from the repository itself:
# migrations for tables, this script's own lists for ports and purposes, the
# suite files for proofs. If you change the repo and the map looks wrong, fix the
# map's source — not this output.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PORTS=(vn=8102 vi=8100 vr=8101 vz=8103 vd=8104 vc=8105 vp=8106 va=8107)
declare -A PORT
for p in "${PORTS[@]}"; do PORT[${p%%=*}]=${p#*=}; done

what() {
  case "$1" in
    vn) echo "notes with chapters, sharing, an assistant";;
    vi) echo "an idea funnel: context, ideate, explore, simulate";;
    vr) echo "requirements: a sheet of testable sentences";;
    vz) echo "a dictionary of keys and values, publishable";;
    vd) echo "documents: papers in, the thing you have to write out";;
    vc) echo "compliance: rules and proofs in, a verdict per control out";;
    vp) echo "a key drawer and credit codes; one credit is one call";;
    va) echo "architecture: the pile in, a box list out";;
  esac
}

# a table can arrive by create or by rename (vn's did: the app was built first
# and given its namespace after), so both spellings count
tables_of() {
  {
    grep -hoiE "create table (if not exists )?(public\.)?$1_[a-z0-9_]+" supabase/migrations/*.sql 2>/dev/null \
      | grep -oiE "$1_[a-z0-9_]+"
    # a rename counts only when it renames a *table*: functions and triggers
    # carry the same prefix and are not tables
    grep -hiE "^alter table .*rename to $1_[a-z0-9_]+" supabase/migrations/*.sql 2>/dev/null \
      | grep -oiE "rename to $1_[a-z0-9_]+" | grep -oiE "$1_[a-z0-9_]+"
    grep -hiE "^create table .*$1_[a-z0-9_]+" supabase/migrations/*.sql 2>/dev/null \
      | grep -oiE "$1_[a-z0-9_]+" | head -0
  } | sort -u
}

echo "vpl — the map (generated: tools/map.sh)"
echo
printf '%-4s %-6s %s\n' "app" "port" "tables, then what it is"
printf '%-4s %-6s %s\n' "---" "----" "---------------------"
for app in vn vi vr vz vd vc vp va; do
  t=$(tables_of "$app" | tr '\n' ' ')
  printf '%-4s %-6s %s\n' "$app" "${PORT[$app]}" "$t"
  printf '%-4s %-6s — %s\n' "" "" "$(what "$app")"
done

echo
echo "shared in the same database: $(grep -hoiE 'create table (if not exists )?(public\.)?vpl_[a-z0-9_]+' supabase/migrations/*.sql | grep -oiE 'vpl_[a-z0-9_]+' | sort -u | tr '\n' ' ')"
echo "row-level functions (the permissions that are not policies):"
grep -hoiE "create or replace function public\.[a-z0-9_]+" supabase/migrations/*.sql \
  | sed -E 's/.*public\./  /' | sort -u | tr '\n' ' ' | fold -s -w 100; echo

echo
echo "the doors (one origin for the browser; providers send no CORS headers)"
find apps/api/functions -name '*.js' | sort | sed 's/^/  /'

echo
echo "the shell every app is painted with — a copy, never an import"
purpose() {                   # purpose <file> — the first line of its own header
  sed -n '1,4p' "$1" | tr -d '\r' \
    | sed -E 's@^[[:space:]]*/\*+[[:space:]]*@@; s@^[[:space:]]*\*+[[:space:]]*@@; s@[[:space:]]*\*/$@@; s@^vpl *· *@@; s@^[a-z_]+\.(js|css) *— *@@' \
    | grep -E '.{20,}' | head -1
}
for f in packages/shell/*; do
  [ -f "$f" ] || continue
  printf '  %-12s %s\n' "$(basename "$f")" "$(purpose "$f")"
done

echo
echo "the proofs (apps/vn/test holds every app's suite)"
echo "  the app names on the right are a grep, not a promise — a suite names its apps"
for f in apps/vn/test/*.mjs; do
  name=$(basename "$f")
  case "$name" in _*|plain.mjs) continue;; esac
  apps=$(tr 'A-Z' 'a-z' <"$f" 2>/dev/null \
         | grep -ohE "app_name=[a-z]{2}|app=[a-z]{2}|(vn|vi|vr|vz|vd|vc|vp|va)_url|^  (vn|vi|vr|vz|vd|vc|vp|va): " \
         | grep -oE "vn|vi|vr|vz|vd|vc|vp|va" | sort -u | tr '\n' ',' | sed 's/,$//')
  printf '  %-22s %-18s %s\n' "$name" "${apps:-(the shell)}" "$(purpose "$f")"
done

echo
echo "one command that says whether the house still stands: ./tools/test-all.sh"
echo "one command that changes nothing: ./tools/stage.sh --check"
