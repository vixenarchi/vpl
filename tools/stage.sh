#!/usr/bin/env bash
# Stage the shared shell into an app — or say which app is holding an old copy.
#
#   tools/stage.sh vn              # copy packages/shell into apps/vn/vendor
#   tools/stage.sh --check         # say nothing; exit 1 if any copy is stale
#   tools/stage.sh --check vn      # the same, for one app
#
# vpl is a suite: apps/<name> is one product, packages/shell is what every
# product looks like. They are copied, never symlinked and never imported at
# runtime — an app must keep working when the rest of the repo is gone. That is
# the whole point of "independent apps, shared look".
#
# The copy is also the one thing that goes quietly wrong: edit tokens.css, forget
# to stage, and eight apps go on being judged against the old look — with the
# whole suite green, because the suite reads what is deployed. `--check` is what
# turns that silence into a red line, and tools/test-all.sh runs it.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/packages/shell"
APPS=(vn vi vr vz vd vc vp va)

check_one() {                 # check_one <app>; prints nothing, exits non-zero
  # one name per `local`: bash expands every word of a `local` line before it
  # assigns any of them, so `local a=$1 b=$a` reads an unset a under set -u
  local app="$1"
  local dst="$ROOT/apps/$app/vendor"
  local f stale=0
  [ -d "$dst" ] || { echo "no vendor/ in $app (run: tools/stage.sh $app)" >&2; return 1; }
  for f in "$SRC"/*; do
    [ -f "$f" ] || continue
    local name base
    name=$(basename "$f")
    # only what the shell owns is judged; an app may keep its own files in there
    case "$name" in
      *.css|ai.js|engine.js|settings.js|who.js|dock.js|notices.js|words.js) ;;
      *) continue ;;
    esac
    if [ ! -f "$dst/$name" ]; then
      echo "$app vendor/$name is missing (run: tools/stage.sh $app)" >&2
      stale=1
    elif ! cmp -s "$f" "$dst/$name"; then
      echo "$app vendor/$name is stale (run: tools/stage.sh $app)" >&2
      stale=1
    fi
  done
  return "$stale"
}

case "${1:-}" in
  --check)
    [ -n "$HOME" ] || true
    if [ -n "${2:-}" ]; then
      check_one "$2"
      exit $?
    fi
    bad=0
    for a in "${APPS[@]}"; do
      check_one "$a" || bad=1
    done
    [ "$bad" = 0 ] && echo "stage: every app carries the current shell"
    exit "$bad"
    ;;
  "")
    echo "usage: tools/stage.sh <app> | --check [app]" >&2
    exit 2
    ;;
esac

APP=$1
DST="$ROOT/apps/$APP/vendor"
[ -d "$ROOT/apps/$APP" ] || { echo "no such app: $APP" >&2; exit 2; }

mkdir -p "$DST"
# everything the shell owns is a copy, so an app keeps working when the rest of
# the repo is gone; rm first so a file deleted upstream does not linger
rm -f "$DST"/*.css "$DST"/ai.js "$DST"/engine.js "$DST"/settings.js \
      "$DST"/who.js "$DST"/dock.js "$DST"/notices.js "$DST"/words.js 2>/dev/null || true
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  cp "$f" "$DST/"
done
