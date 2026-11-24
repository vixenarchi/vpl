#!/usr/bin/env bash
# vpl · swap tuning, one guarded step.
#
# Why: this box swaps out hot anonymous memory instead of dropping cold page
# cache, because vm.swappiness is 60 (the Ubuntu default). Everything here is
# reversible, and the reload of the swap file is the only part that touches
# memory — so it refuses to run unless there is room to take it back.
#
#   sudo ./tools/swap-tune.sh          do it
#   ./tools/swap-tune.sh               only print what it would do
#
# Nothing is killed. Services holding memory are named, not stopped: that is a
# decision for the person paying for the machine.

set -u
DRY=1
[ "${1:-}" = "--apply" ] && DRY=0
[ "$(id -u)" -eq 0 ] || DRY=1

CONF=/etc/sysctl.d/60-vpl-swap.conf
WANT=10          # swap only to answer real pressure, not to look busy
ROOM_MB=1536     # leave this much free after reloading the swap file

say() { printf '%s\n' "$*"; }
kb() { awk -v v="$1" 'BEGIN { printf "%d", v / 1024 }'; }

meminfo() { awk -v k="$1" '$1 == k":" { print $2 }' /proc/meminfo; }

SWAP_USED_KB=0
for f in /proc/swaps; do
  [ -r "$f" ] || continue
  SWAP_USED_KB=$(awk 'NR > 1 { s += $4 } END { printf "%d", s }' "$f")
done
AVAIL_MB=$(kb "$(meminfo MemAvailable)")
SWAP_MB=$(kb "$SWAP_USED_KB")
CONF_OLD=60
[ -r /proc/sys/vm/swappiness ] && CONF_OLD=$(cat /proc/sys/vm/swappiness)

say "before: ${AVAIL_MB} MB available, ${SWAP_MB} MB in swap, vm.swappiness=${CONF_OLD}"
say ""

# ── 1. the setting ───────────────────────────────────────────────────────
say "1. vm.swappiness ${CONF_OLD} → ${WANT}, and again at every boot"
if [ "$DRY" = 0 ]; then
  printf '# vpl: keep hot pages in RAM; swap answers pressure, not idleness\nvm.swappiness = %s\n' "$WANT" > "$CONF"
  sysctl -q -p "$CONF"
  say "   now: $(cat /proc/sys/vm/swappiness)  (${CONF})"
else
  say "   would write ${CONF} and run sysctl -p"
fi
say ""

# ── 2. the swap file, only when it can be taken back ─────────────────────
say "2. reload /swap.img so what is in it now comes back into RAM"
if [ "$SWAP_MB" -eq 0 ]; then
  say "   nothing is in swap — nothing to reload"
elif [ "$AVAIL_MB" -lt $((SWAP_MB + ROOM_MB)) ]; then
  say "   refusing: ${SWAP_MB} MB to bring back, ${AVAIL_MB} MB available,"
  say "   and ${ROOM_MB} MB has to stay free. Close the heavy browser tab first:"
  say "     ps -eo rss,comm --sort=-rss | head -5"
  say "   then run this again."
else
  say "   room: ${SWAP_MB} MB back against ${AVAIL_MB} MB available"
  if [ "$DRY" = 0 ]; then
    swapoff -a && swapon -a && say "   done"
  else
    say "   would run: swapoff -a && swapon -a"
  fi
fi
say ""

# ── 3. what is holding the RAM (named, never killed) ─────────────────────
say "3. the biggest residents right now — a browser tab, usually:"
ps -eo rss=,comm= --sort=-rss | head -5 | while read -r rss comm; do
  printf '   %6s MB  %s\n' "$((rss / 1024))" "$comm"
done
say ""
say "remember: swap tells you what happened, not what is happening."
