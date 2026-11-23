#!/usr/bin/env bash
# vp: the drawer and the door. Serves the app, then runs the UI checks and the
# door's logic (which fakes both ends and spends nothing).
set -euo pipefail
cd "$(dirname "$0")/.."
(PORT=8106 OAUTH_PORT=0 ./serve vp >/tmp/serve-vp.log 2>&1 &)
sleep 2
cd apps/vn/test
VP_URL=${VP_URL:-http://127.0.0.1:8106} node vp-check.mjs
node vp-proxy.mjs
