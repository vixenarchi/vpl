#!/usr/bin/env bash
# A backup you can restore from without any of this machine surviving.
#
#   ./tools/backup.sh              # into ~/backups
#   VPL_BACKUP_DIR=/mnt/usb ./tools/backup.sh
#
# It writes two things:
#   vpl-<date>.bundle   every branch, every tag, every commit — a full clone in
#                       one file, `git clone vpl-<date>.bundle vpl`
#   vpl-<date>.tar.gz   the working tree as it is, including anything not yet
#                       committed and the .git directory
#
# Secrets are not in here: config.local.js, agent.env and ~/.config/vpl are
# ignored by git and excluded from the tarball. A backup of the code is not a
# backup of the keys, and mixing them is how keys end up in a backup nobody
# thinks about.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${VPL_BACKUP_DIR:-$HOME/backups}"
stamp="$(date +%Y-%m-%d-%H%M)"
mkdir -p "$out"

cd "$root"
if [ -n "$(git status --porcelain)" ]; then
  echo "note: the tree is not clean — the tarball has the work, the bundle has the commits" >&2
fi

bundle="$out/vpl-$stamp.bundle"
git bundle create "$bundle" --all --quiet
git bundle verify "$bundle" >/dev/null 2>&1 && echo "bundle ok   $bundle"

tarball="$out/vpl-$stamp.tar.gz"
tar --create --gzip --file "$tarball" \
  --exclude='.git/hooks' \
  --exclude='**/node_modules' \
  --exclude='**/vendor' \
  --exclude='*.env' \
  --exclude='config.local.js' \
  --exclude='.DS_Store' \
  --exclude='jobs/*/out' \
  -C "$(dirname "$root")" "$(basename "$root")"
echo "tarball ok  $tarball"

du -h "$bundle" "$tarball" | sed 's/^/            /'
echo
echo "restore the history:  git clone $(basename "$bundle") vpl"
echo "restore the files:    tar -xzf $(basename "$tarball")"
echo "then put the keys back by hand: config.local.js, ~/.config/vpl/*, agent.env"
