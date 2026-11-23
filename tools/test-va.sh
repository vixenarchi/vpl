#!/usr/bin/env bash
# va — the desk and the hand-off of that desk.
# Needs a server (PORT=8107 ./serve va) and the agent's slip in
# ~/.config/vpl/agent.env for the hand-off half.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/apps/vn/test"
node va-check.mjs
node va-handoff.mjs
