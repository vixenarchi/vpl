#!/usr/bin/env bash
# Every vc check, against one origin — local by default.
#
#   tools/test-vc.sh
#   VC_URL=https://vc.terg.hr tools/test-vc.sh
#
# It starts ./serve vc itself when the origin is local and nothing is listening.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=${VC_URL:-http://127.0.0.1:8105}
PORT_N=${PORT_N:-8105}

cd "$ROOT"
if [[ "$URL" == *127.0.0.1* || "$URL" == *localhost* ]]; then
  if ! curl -s -o /dev/null "$URL/"; then
    echo "starting vc on $PORT_N"
    PORT=$PORT_N OAUTH_PORT=0 ./serve vc
    sleep 2
  fi
fi

echo "vc at $URL"
cd apps/vn/test
fail=0
for suite in vc-check.mjs vc-lib.mjs vc-batch.mjs; do
  out=$(VC_URL="$URL" node "$suite" 2>&1); rc=$?
  echo "$out" | grep -E "FAIL|passed," | sed 's/^/  /'
  [ $rc -ne 0 ] && fail=1
done

if [ $fail -eq 1 ]; then
  echo "something failed — see above"
  exit 1
fi
echo "all vc checks passed"
