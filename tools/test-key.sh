#!/usr/bin/env bash
# the key of record: one key on the account, adopted by every app and browser.
# Needs two servers, because adoption has to be seen across origins.
set -euo pipefail
cd "$(dirname "$0")/.."
(PORT=8104 OAUTH_PORT=0 ./serve vd >/tmp/serve-vd.log 2>&1 &)
(PORT=8101 OAUTH_PORT=0 ./serve vr >/tmp/serve-vr.log 2>&1 &)
sleep 2
cd apps/vn/test
VD_URL=${VD_URL:-http://127.0.0.1:8104} \
VR_URL=${VR_URL:-http://127.0.0.1:8101} \
  node key-check.mjs
