#!/usr/bin/env bash
# va — the desk. Needs a server: PORT=8107 ./serve va
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/apps/vn/test"
node va-check.mjs
