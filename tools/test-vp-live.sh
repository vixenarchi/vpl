#!/usr/bin/env bash
# One real call through the door, with a real vp key. Costs one credit.
#
#   . ~/.config/vpl/agent.env && ./tools/test-vp-live.sh
#
# The proxy tests fake the database, which is how a broken `vp_spend` survived
# them: the ambiguous column could only be reached by a real slip on a real row.
# This is the two-second version of that reach.
set -euo pipefail

: "${VPL_MODEL_KEY:?source a file with VPL_MODEL_KEY (a vp_ key) first}"
base="${VPL_DOOR:-https://api.terg.hr/vp/v1}"

body=$(mktemp); head=$(mktemp); trap 'rm -f "$body" "$head"' EXIT

code=$(curl -s -D "$head" -o "$body" -w '%{http_code}' --max-time 120 \
  "$base/chat/completions" \
  -H "Authorization: Bearer $VPL_MODEL_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"smoke","messages":[{"role":"user","content":"Reply with exactly: door-ok"}],"max_tokens":32}')

credits=$(grep -i '^x-vpl-credits:' "$head" | tr -d '\r' | awk '{print $2}')
calls=$(grep -i '^x-vpl-calls:' "$head" | tr -d '\r' | awk '{print $2}')

echo "status  $code"
echo "credits $credits · calls $calls"
head -c 200 "$body"; echo

[ "$code" = "200" ] || { echo "FAIL: the door did not answer 200"; exit 1; }
[ -n "$credits" ] || { echo "FAIL: no X-Vpl-Credits header, so nothing was spent or settled"; exit 1; }
grep -q 'choices' "$body" || { echo "FAIL: no choices in the answer"; exit 1; }
echo "ok — one credit spent, one answer returned"
