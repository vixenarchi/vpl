#!/usr/bin/env bash
# Every vz check, against one origin — local by default.
#
#   tools/test-vz.sh
#   VZ_URL=https://vz.terg.hr tools/test-vz.sh
#
# It starts ./serve vz itself when the origin is local and nothing is listening.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
URL=${VZ_URL:-http://127.0.0.1:8103}
PORT_N=${PORT_N:-8103}

cd "$ROOT"
if [[ "$URL" == *127.0.0.1* || "$URL" == *localhost* ]]; then
  if ! curl -s -o /dev/null "$URL/"; then
    echo "starting vz on $PORT_N"
    PORT=$PORT_N OAUTH_PORT=0 ./serve vz
    sleep 2
  fi
fi

echo "vz at $URL"
cd apps/vn/test
fail=0
out=$(VZ_URL="$URL" node vz-check.mjs 2>&1); rc=$?
echo "$out" | grep -E "FAIL|passed," | sed 's/^/  /'
[ $rc -ne 0 ] && fail=1

if [ $fail -eq 1 ]; then
  echo "something failed — see above"
  exit 1
fi
echo "all vz checks passed"
