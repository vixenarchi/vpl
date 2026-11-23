#!/usr/bin/env bash
# va — the desk, the drawing that reads it, and the hand-off.
# Needs a server (PORT=8107 ./serve va) and the agent's slip in
# ~/.config/vpl/agent.env for the hand-off half.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/apps/vn/test"
node va-check.mjs        # the desk: a job, inputs, versions, sharing, a phone
node va-canvas.mjs       # the drawing: the box list read as shapes, a drag writes x,y
node va-handoff.mjs      # the hand-off: a row and a folder, claimed and answered
