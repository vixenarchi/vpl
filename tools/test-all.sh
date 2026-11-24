#!/usr/bin/env bash
# Everything, in the order a launch should be checked.
#
#   ./tools/test-all.sh
#   VPL_PROD=1 ./tools/test-all.sh      # the same suites against the deployments
#
# Local mode expects the eight local servers to be up (they are started for you if
# they are not: `./serve <app>` on its own port, then killed on the way out).
# Nothing here spends a model key except where a suite says so in its own header,
# and `vp-check` uses its own ledger account rather than a real credit.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

PROD=${VPL_PROD:-0}
PORTS=(vn=8102 vi=8100 vr=8101 vz=8103 vd=8104 vc=8105 vp=8106 va=8107)
declare -A PORT
for p in "${PORTS[@]}"; do PORT[${p%%=*}]=${p#*=}; done

started=()
cleanup() { for pid in "${started[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

# the suites sign in as the agent account; the password lives outside the repo
# and so does anything else a test needs, in ~/.config/vpl/test.env
[ -f "$HOME/.config/vpl/test.env" ] && set -a && . "$HOME/.config/vpl/test.env" && set +a

if [ "$PROD" != "1" ]; then
  for app in vn vi vr vz vd vc vp va; do
    if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT[$app]}/"; then
      PORT="${PORT[$app]}" OAUTH_PORT=0 ./serve "$app" >"/tmp/test-all-$app.log" 2>&1 &
      started+=($!)
      echo "started $app on ${PORT[$app]}"
    fi
    # a server that answers "connection refused" is not a server yet; a suite that
    # starts too early reports a TimeoutError, which reads like a broken app
    for _ in $(seq 1 60); do
      curl -sf -o /dev/null "http://127.0.0.1:${PORT[$app]}/" && break
      sleep 0.5
    done
  done
fi

pass=0; fail=0; failed=()
run() {                       # run "<label>" <command…>
  local label="$1"; shift
  printf '\n\033[1m%s\033[0m\n' "$label"
  if "$@" 2>&1 | tail -n 12; then
    pass=$((pass + 1))
    return
  fi
  # Nine servers, one small machine, and a suite that waits 8 s for a repaint:
  # a single failure is usually a slow neighbour, not a break. A suite that fails
  # twice is a break, and the retry is printed so the first failure is not hidden.
  echo "   — failed once; retrying (a slow neighbour looks exactly like a break)"
  if "$@" 2>&1 | tail -n 12; then
    pass=$((pass + 1))
    echo "   — passed on the retry"
  else
    fail=$((fail + 1)); failed+=("$label")
  fi
}

# ── 1. every file parses ────────────────────────────────────────────
syntax=0
for f in apps/*/app.js packages/shell/*.js apps/*/lib/*.js; do
  node --check "$f" || { echo "syntax: $f"; syntax=1; }
done
[ "$syntax" = 0 ] && { echo "syntax: every script parses"; pass=$((pass+1)); } || { echo "syntax: FAILED"; fail=$((fail+1)); failed+=("syntax"); }

# ── 2. the shell: chrome, settings, auth ────────────────────────────
if [ "$PROD" = "1" ]; then
  run "chrome (deployments)" env VPL_PROD=1 ./tools/test-chrome.sh
else
  run "chrome (all eight)" ./tools/test-chrome.sh
fi
run "settings" ./tools/test-settings.sh

# ── 3. each app's own suite ─────────────────────────────────────────
cd apps/vn/test
if [ -n "${VPL_EMAIL:-}" ] && [ -n "${VPL_PASS:-}" ]; then
  run "vn · mode" env PORT="${PORT[vn]}" node mode-check.mjs
else
  echo "\n\033[1mvn · mode\033[0m\n  skipped: no VPL_EMAIL/VPL_PASS (see ~/.config/vpl/test.env)"
fi
run "vi · ideas" env VI_URL="${VI_URL:-http://127.0.0.1:${PORT[vi]}}" node vi-check.mjs
run "vr · requirements" env VR_URL="${VR_URL:-http://127.0.0.1:${PORT[vr]}}" node vr-check.mjs
run "vz · dictionary" env VZ_URL="${VZ_URL:-http://127.0.0.1:${PORT[vz]}}" node vz-check.mjs
run "vd · documents" env VD_URL="${VD_URL:-http://127.0.0.1:${PORT[vd]}}" node vd-check.mjs
run "vc · compliance" env VC_URL="${VC_URL:-http://127.0.0.1:${PORT[vc]}}" node vc-check.mjs
run "vp · keys & codes" env VP_URL="${VP_URL:-http://127.0.0.1:${PORT[vp]}}" node vp-check.mjs
run "va · desk + drawing + hand-off" node va-check.mjs
run "va · canvas" node va-canvas.mjs
run "va · hand-off" node va-handoff.mjs

# ── 4. the floor under every control, in all eight ───────────────────
for app in vn vi vr vz vd vc vp va; do
  if [ "$PROD" = "1" ]; then
    case "$app" in
      vn) url="${VN_PROD_URL:-https://vpl.pages.dev}" ;;
      *) url="${PROD_URL_PREFIX:-https://vpl}-$app.pages.dev" ;;
    esac
    run "ux · $app" env VPL_PROD=1 APP_URL="$url" APP_NAME="$app" node ux-sniff.mjs
  else
    run "ux · $app" env APP_URL="http://127.0.0.1:${PORT[$app]}" APP_NAME="$app" node ux-sniff.mjs
  fi
done

printf '\n\033[1m%s\033[0m\n' "── summary ──────────────────────────────────"
echo "  $pass passed, $fail failed"
for f in "${failed[@]:-}"; do [ -n "$f" ] && echo "  FAILED: $f"; done
[ "$fail" = 0 ] || exit 1
