#!/usr/bin/env bash
# The chrome every app shares: the name in the bar, one settings gear, one
# sign-in card, one chat dock at the bottom. Runs against the local dev
# servers by default; VPL_PROD=1 walks the deployments instead.
#
#   ./tools/test-chrome.sh
#   VPL_PROD=1 ./tools/test-chrome.sh
set -u
cd "$(dirname "$0")/.." || exit 1

apps=(vn vi vr vz vd vc va vp)
ports=(8102 8100 8101 8103 8104 8105 8107 8106)
fails=0

for i in "${!apps[@]}"; do
  app="${apps[$i]}"
  if [ -n "${VPL_PROD:-}" ]; then
    # vn is the project called `vpl`, and it answers on its own address
    if [ "$app" = "vn" ]; then url="https://vn.terg.hr"; else url="https://vpl-${app}.pages.dev"; fi
  else
    url="http://127.0.0.1:${ports[$i]}"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url/" || true)
    if [ "$code" != "200" ]; then
      echo "== $app: no server on ${ports[$i]} — start it with PORT=${ports[$i]} OAUTH_PORT=0 ./serve $app"
      fails=$((fails + 1))
      continue
    fi
  fi
  echo "== $app ($url)"
  if ! (cd apps/vn/test && APP_URL="$url" APP_NAME="$app" node chrome-check.mjs); then
    fails=$((fails + 1))
  fi
done

echo
if [ "$fails" -eq 0 ]; then echo "chrome: every app says who you are, opens the same settings, and has a dock."; else echo "chrome: $fails app(s) failed."; fi
exit "$fails"
