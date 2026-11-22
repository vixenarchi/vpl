#!/usr/bin/env bash
# Every vr check, one after another, against this machine or a host.
#
#   tools/test-vr.sh                       # local, starts its own server
#   VR_URL=https://vpl-vr.pages.dev tools/test-vr.sh
#
# The AI checks fake the model at the proxy — no key, no call, no cost.
set -u
cd "$(dirname "$0")/.." || exit 1

PORT_NUM=8101
STARTED=""
if [ -z "${VR_URL:-}" ]; then
  VR_URL="http://127.0.0.1:$PORT_NUM"
  if ! curl -sf -o /dev/null "$VR_URL/"; then
    PORT=$PORT_NUM OAUTH_PORT=0 ./serve vr >/tmp/vr-test-server.log 2>&1 &
    STARTED=$!
    for _ in $(seq 1 40); do
      curl -sf -o /dev/null "$VR_URL/" && break
      sleep 0.25
    done
  fi
fi

echo "vr at $VR_URL"
fail=0
for t in vr-check vr-paste vr-ai vr-share; do
  line=$(cd apps/vn/test && VR_URL="$VR_URL" node "$t.mjs" 2>&1 | grep -E "passed," | tail -1)
  printf '  %-9s %s\n' "$t" "${line:-FAILED (run it by hand to see why)}"
  case "$line" in *"0 failed"*) ;; *) fail=1 ;; esac
done

[ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null
[ "$fail" = 0 ] && echo "all vr checks passed" || echo "something failed — see above"
exit "$fail"
