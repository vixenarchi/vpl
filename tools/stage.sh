#!/usr/bin/env bash
# Stage the shared shell into an app.
#
#   tools/stage.sh vn
#
# vpl is a suite: apps/<name> is one product, packages/shell is what every
# product looks like. They are copied, never symlinked and never imported at
# runtime — an app must keep working when the rest of the repo is gone. That is
# the whole point of "independent apps, shared look".
#
# Idempotent and quiet: ./serve and ./deploy both call it.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP=${1:-}
[ -n "$APP" ] || { echo "usage: tools/stage.sh <app>" >&2; exit 2; }
SRC="$ROOT/packages/shell"
DST="$ROOT/apps/$APP/vendor"
[ -d "$ROOT/apps/$APP" ] || { echo "no such app: $APP" >&2; exit 2; }

mkdir -p "$DST"
rm -f "$DST"/*.css 2>/dev/null || true
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  cp "$f" "$DST/"
done
