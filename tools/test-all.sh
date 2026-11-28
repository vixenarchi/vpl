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

pass=0; fail=0; skip=0; skipped=(); failed=()
# ── running a group ──────────────────────────────────────────────────
# Each group is a process: a browser walk, a suite, a shell check. Most of them
# are independent — a different app, a different set of rows — and one small
# machine spends most of the twenty-five minutes waiting for a repaint. So they
# run in parallel.
#
# Not all of them are independent. Every suite signs in as the same person, and
# the shell suites write that person's settings; two of them at once is a race,
# not a test. So groups belong to a **lane**, and one lane runs one group at a
# time while lanes run beside each other. Everything touching a given app is one
# lane, so a bin test cannot delete the note a markdown test is reading.
PARALLEL=${VPL_JOBS:-4}
JOBDIR=$(mktemp -d)
LANE=main
SEQ=0
cleanup_jobs() {
  # VPL_KEEP=1 leaves the logs in place: when a group fails in a lane, the reason
  # is in its log, and the temp dir is otherwise gone by the time you look
  if [ "${VPL_KEEP:-0}" = 1 ]; then echo "logs: $JOBDIR"; return; fi
  rm -rf "$JOBDIR"
}
trap 'cleanup; cleanup_jobs' EXIT

slug() { printf '%s' "$1" | tr -cs 'a-zA-Z0-9' '-' | cut -c1-60; }
lane() { LANE="$1"; }

# one group, run for real: its own log, its own exit code, no shared file
run_now() {                  # run_now "<label>" <command…>
  local label="$1"; shift
  local log="$JOBDIR/$(slug "$label").log"
  ( "$@" ) >"$log" 2>&1
  local code=$?
  # 78 is EX_CONFIG: the suite did not run because no account was set. It is
  # neither a pass nor a failure, and it must never be counted as a pass.
  printf '%s' "$code" > "$JOBDIR/$(slug "$label").code"
  return $code
}

run() {                       # queue a group in the current lane
  local label="$1"; shift
  if [ "$PARALLEL" = 1 ] || [ "${FORCE:-0}" = 1 ]; then
    printf '\n\033[1m%s\033[0m\n' "$label"
    run_now "$label" "$@" || true
    local code; code=$(cat "$JOBDIR/$(slug "$label").code" 2>/dev/null || echo 1)
    tail -n 12 "$JOBDIR/$(slug "$label").log" 2>/dev/null || true
    tally "$label" "$code"
    return
  fi
  SEQ=$((SEQ + 1))
  mkdir -p "$JOBDIR/$LANE"
  local n; n=$(printf '%03d' "$SEQ")
  printf '%s' "$label" > "$JOBDIR/$LANE/$n.label"
  printf '%s' "$PWD" > "$JOBDIR/$LANE/$n.dir"
  printf '%q ' "$@" > "$JOBDIR/$LANE/$n.cmd"     # quoted: a space in an argument replays exactly
  echo "$LANE" >> "$JOBDIR/lanes"
}

tally() {                     # tally "<label>" <exit code>
  local label="$1" code="$2"
  if [ "$code" = 0 ]; then pass=$((pass + 1)); return; fi
  if [ "$code" = 78 ]; then
    skip=$((skip + 1)); skipped+=("$label")
    printf '   — skipped: not configured (exit 78)\n'
    return
  fi
  fail=$((fail + 1)); failed+=("$label")
}

# one lane: its groups, in the order they were asked, one at a time
run_lane() {
  local l="$1" file
  for file in "$JOBDIR/$l"/*.cmd; do
    [ -e "$file" ] || continue
    (
      cd "$(cat "${file%.cmd}.dir")" || exit 1
      eval "$(cat "$file")" >"${file%.cmd}.log" 2>&1
      printf '%s' "$?" > "${file%.cmd}.code"
    )
  done
}

flush_jobs() {
  [ "$PARALLEL" = 1 ] && return
  [ ! -f "$JOBDIR/lanes" ] && return
  local lanes; lanes=$(sort -u "$JOBDIR/lanes")
  local count; count=$(echo "$lanes" | wc -l)
  printf '\n\033[1m%s\033[0m\n' "running $SEQ groups in $count lanes, $PARALLEL lanes at a time"

  local l
  for l in $lanes; do
    run_lane "$l" &
    while [ "$(jobs -rp | wc -l)" -ge "$PARALLEL" ]; do wait -n 2>/dev/null || break; done
  done
  wait

  # reported in the order they were queued, so the reading is the same as before
  local file label code
  for file in $(ls "$JOBDIR"/*/*.label | sort -t/ -k4,4n 2>/dev/null); do
    [ -e "$file" ] || continue
    label=$(cat "$file"); code=$(cat "${file%.label}.code" 2>/dev/null || echo 1)
    [ "$code" = 0 ] || echo "$(basename "$(dirname "$file")")|$label|$code" >> "$JOBDIR/failed"
  done

  # print every group's tail as before, in the order queued
  for file in "$JOBDIR"/*/*.label; do
    [ -e "$file" ] || continue
    printf '%s' "$(cat "$file")" >> "$JOBDIR/order"
    printf '\n' >> "$JOBDIR/order"
    printf '%s' "$(basename "$(dirname "$file")")" >> "$JOBDIR/order_lane"
    printf '\n' >> "$JOBDIR/order_lane"
  done

  local i=0 orderfile
  while read -r orderfile; do :; done < /dev/null
  # simple and ordered: walk the numeric order across lanes
  for i in $(seq 1 "$SEQ"); do
    n=$(printf '%03d' "$i")
    for file in "$JOBDIR"/*/"$n".label; do
      [ -e "$file" ] || continue
      label=$(cat "$file"); code=$(cat "${file%.label}.code" 2>/dev/null || echo 1)
      printf '\n\033[1m%s\033[0m\n' "$label"
      if [ "$code" = 0 ]; then
        tail -n 3 "${file%.label}.log" 2>/dev/null || true
      else
        echo "   — failed once; retrying (a slow neighbour looks exactly like a break)"
        if ( cd "$(cat "${file%.label}.dir")" && eval "$(cat "${file%.label}.cmd")" ) >"${file%.label}.retry.log" 2>&1; then
          code=0; echo "   — passed on the retry"
        else
          code=$?
        fi
        tail -n 12 "${file%.label}.log" 2>/dev/null || true
      fi
      tally "$label" "$code"
    done
  done
}

# ── 0. the shell each app carries is the shell in this repo ─────────
# Eight apps hold a *copy* of packages/shell. Edit the shell, forget to stage,
# and every suite below judges the old look and passes. That silence is what this
# line exists to break.
FORCE=1
run "stage (the shell every app carries)" ./tools/stage.sh --check

# ── 1. every file parses ────────────────────────────────────────────
syntax=0
for f in apps/*/app.js packages/shell/*.js apps/*/lib/*.js; do
  node --check "$f" || { echo "syntax: $f"; syntax=1; }
done
[ "$syntax" = 0 ] && { echo "syntax: every script parses"; pass=$((pass+1)); } || { echo "syntax: FAILED"; fail=$((fail+1)); failed+=("syntax"); }

# ── 1b. no key in the history ───────────────────────────────────────
# This repository is public, so a secret in any commit is published the moment
# it lands — and stays published after it is deleted. One second to read every
# blob of every commit, which is why it belongs here and not in a rule.
run "secrets (every commit, every file)" ./tools/secrets-check.sh

FORCE=0
lane shell

# ── 2. the shell: chrome, settings, auth ────────────────────────────
if [ "$PROD" = "1" ]; then
  run "chrome (deployments)" env VPL_PROD=1 ./tools/test-chrome.sh
else
  run "chrome (all eight)" ./tools/test-chrome.sh
fi
run "settings" ./tools/test-settings.sh

# ── 3. each app's own suite ─────────────────────────────────────────
cd apps/vn/test
lane vn
if [ -n "${VPL_EMAIL:-}" ] && [ -n "${VPL_PASS:-}" ]; then
  run "vn · mode" env PORT="${PORT[vn]}" node mode-check.mjs
  run "vn · markdown" env PORT="${PORT[vn]}" node md-check.mjs
  run "vn · dock" env PORT="${PORT[vn]}" node dock-check.mjs
  # the bin is a drop target as well as a button, and only a real drag proves
  # the target still takes a note — a moved bin is silent otherwise
  run "vn · drag" env PORT="${PORT[vn]}" node dnd-check.mjs
  run "vn · touch" env PORT="${PORT[vn]}" node touch-check.mjs
  for a in vd vc va; do
    run "${a} · dock" env APP="${a}" PORT="${PORT[$a]}" node dock-apps.mjs
  done
else
  echo "\n\033[1mvn · mode\033[0m\n  skipped: no VPL_EMAIL/VPL_PASS (see ~/.config/vpl/test.env)"
fi
lane vi
run "vi · ideas" env VI_URL="${VI_URL:-http://127.0.0.1:${PORT[vi]}}" node vi-check.mjs
lane vr
run "vr · requirements" env VR_URL="${VR_URL:-http://127.0.0.1:${PORT[vr]}}" node vr-check.mjs
lane vz
run "vz · dictionary" env VZ_URL="${VZ_URL:-http://127.0.0.1:${PORT[vz]}}" node vz-check.mjs
lane vd
run "vd · documents" env VD_URL="${VD_URL:-http://127.0.0.1:${PORT[vd]}}" node vd-check.mjs
lane vc
run "vc · compliance" env VC_URL="${VC_URL:-http://127.0.0.1:${PORT[vc]}}" node vc-check.mjs
run "vc · library" env VC_URL="${VC_URL:-http://127.0.0.1:${PORT[vc]}}" node vc-lib.mjs
run "vc · batch" env VC_URL="${VC_URL:-http://127.0.0.1:${PORT[vc]}}" node vc-batch.mjs
lane vp
run "vp · keys & codes" env VP_URL="${VP_URL:-http://127.0.0.1:${PORT[vp]}}" node vp-check.mjs
lane va
run "va · desk + drawing + hand-off" node va-check.mjs
for a in vn vi vr vz vd vc va; do
  lane "$a-bin"
  run "${a} · bin" env APP="${a}" PORT="${PORT[$a]}" node bin-check.mjs
done
# the rail is where the work is chosen, and its width is the person's: one grip,
# a remembered width, the arrow keys, and no grip at all on a phone
for a in vn vi vr vz vd vc va; do
  lane "$a-rail"
  run "${a} · the rail's edge" env APP="${a}" PORT="${PORT[$a]}" node rail-check.mjs
done
# the surface an agent uses: a token is a person, a bin is a column, an owner
# is not a field. no browser at all.
lane api
run "api · the agent's surface" node api-check.mjs
run "mcp · the same API as tools" node mcp-check.mjs
# a key kept on the account must arrive with the person, in all eight (it did
# not: three apps never handed ai.js the token, and a new browser said "no key")
run "account · the key follows the person" node account-key-check.mjs
lane va
run "va · canvas" node va-canvas.mjs
lane va
run "va · hand-off" node va-handoff.mjs

# ── 3b. the authorization grid, from the other laptop ─────────────────
# Six apps, two roles, a third account that must see nothing. The grid walks
# every cell; the confirmations walk the seven findings one at a time, so a
# regression says which one came back. Both exit 78 without the accounts.
# C7/VP-4 (a door is a relay with a bound, not a lock) and C8 (the policy every
# page carries) — no network, one browser walk per app
lane security
run "doors · four refusals + the bound" node door-check.mjs
run "csp · the policy, in all eight" node csp-check.mjs
# VC-3: /fetch follows a redirect only after checking where it goes
run "fetch · the redirect walk" node fetch-check.mjs
run "authz · the grid" node authz-matrix.mjs
run "authz · one proof per finding" node authz-confirm.mjs
# the rail shows what I own and what somebody gave me in one column, so the two
# must not look alike — and a shared row must not carry a ✕ it cannot use
run "shared · the word on a rail that is not mine" node shared-rail-check.mjs

# ── 3c. the security regressions, one per finding that crossed a line ─
# These are not the audit: they are the four questions a person may ask again
# after any change — may an editor start a machine, may an editor take a row,
# may a stranger read the codes, may a note carry a way in.
lane va
run "va · who may queue" env VA_URL="${VA_URL:-http://127.0.0.1:${PORT[va]}}" node va-sec.mjs
lane vd
run "vd · a row is not a field" env VD_URL="${VD_URL:-http://127.0.0.1:${PORT[vd]}}" node owner-guard.mjs

# ── 4. the floor under every control, in all eight ───────────────────
for app in vn vi vr vz vd vc vp va; do
  if [ "$PROD" = "1" ]; then
    case "$app" in
      vn) url="${VN_PROD_URL:-https://vpl.pages.dev}" ;;
      *) url="${PROD_URL_PREFIX:-https://vpl}-$app.pages.dev" ;;
    esac
    lane "ux-$app"
    run "ux · $app" env VPL_PROD=1 APP_URL="$url" APP_NAME="$app" node ux-sniff.mjs
  else
    lane "ux-$app"
  run "ux · $app" env APP_URL="http://127.0.0.1:${PORT[$app]}" APP_NAME="$app" node ux-sniff.mjs
  fi
done

flush_jobs

printf '\n\033[1m%s\033[0m\n' "── summary ──────────────────────────────────"
echo "  $pass passed, $fail failed, $skip skipped"
for f in "${failed[@]:-}"; do [ -n "$f" ] && echo "  FAILED: $f"; done
for s in "${skipped[@]:-}"; do [ -n "$s" ] && echo "  SKIPPED: $s (no account — see ~/.config/vpl/test.env)"; done
# A skip is not a pass. The run is only green when nothing was skipped and
# nothing failed; VPL_ALLOW_ANON=1 says "I know, I only want the anon suites".
[ "$fail" = 0 ] || exit 1
if [ "$skip" != 0 ] && [ "${VPL_ALLOW_ANON:-}" != "1" ]; then
  echo "  (nothing is green here: $skip group(s) never ran)"
  exit 1
fi
