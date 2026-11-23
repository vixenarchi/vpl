#!/usr/bin/env bash
# Every vd check, against one origin — local by default.
#
#   tools/test-vd.sh
#   VD_URL=https://vd.terg.hr tools/test-vd.sh
#
# It starts ./serve vd itself when the origin is local and nothing is listening.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=${VD_URL:-http://127.0.0.1:8104}
PORT_N=${PORT_N:-8104}

cd "$ROOT"
if [[ "$URL" == *127.0.0.1* || "$URL" == *localhost* ]]; then
  if ! curl -s -o /dev/null "$URL/"; then
    echo "starting vd on $PORT_N"
    PORT=$PORT_N OAUTH_PORT=0 ./serve vd
    sleep 2
  fi
fi

echo "vd at $URL"
cd apps/vn/test
fail=0
out=$(VD_URL="$URL" node vd-check.mjs 2>&1); rc=$?
echo "$out" | grep -E "FAIL|passed," | sed 's/^/  /'
[ $rc -ne 0 ] && fail=1

if [ $fail -eq 1 ]; then
  echo "something failed — see above"
  exit 1
fi
echo "all vd checks passed"
