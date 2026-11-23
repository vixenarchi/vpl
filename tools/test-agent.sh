#!/usr/bin/env bash
# The worker's mechanics, with no model and no network.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/agent"
node test/worker-test.mjs
