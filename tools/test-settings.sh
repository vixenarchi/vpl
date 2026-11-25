#!/usr/bin/env bash
# The settings dialog and the session, in every app that has them.
#
#   ./tools/test-settings.sh              # the local servers (ports below)
#   VPL_PROD=1 ./tools/test-settings.sh   # the Pages deployments
#
# Local ports: vn 8102, vi 8100, vr 8101, vd 8104, vc 8105, va 8107.
# vn is in the list because it is the one app with the fifth (account) tab.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/apps/vn/test"

if [ -n "${VPL_PROD:-}" ]; then
  APPS="vn:https://vn.terg.hr va:https://vpl-va.pages.dev vi:https://vpl-vi.pages.dev vr:https://vpl-vr.pages.dev vd:https://vpl-vd.pages.dev vc:https://vpl-vc.pages.dev"
else
  APPS="vn:http://127.0.0.1:8102 vi:http://127.0.0.1:8100 vr:http://127.0.0.1:8101 vd:http://127.0.0.1:8104 vc:http://127.0.0.1:8105 va:http://127.0.0.1:8107"
fi

fail=0
run() { # app url suite
  local app="$1" url="$2" suite="$3" out rc
  out=$(APP_URL="$url" APP_NAME="$app" node "$suite" 2>&1); rc=$?
  echo "  $(printf '%-20s' "$suite")$(echo "$out" | grep -E 'passed,' | tail -1 | sed 's/^ *//')"
  if [ $rc -ne 0 ]; then
    echo "$out" | grep -E 'FAIL' | sed 's/^/    /'
    fail=1
  fi
}
for pair in $APPS; do
  app="${pair%%:*}"; url="${pair#*:}"
  echo "── $app"
  run "$app" "$url" settings-check.mjs
  run "$app" "$url" auth-check.mjs
done
exit $fail
