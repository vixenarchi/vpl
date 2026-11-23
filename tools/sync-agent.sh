#!/usr/bin/env bash
# Put the agent from this repo into the workspace where it runs.
#
# The agent is developed here and executed in the eva workshop (which mounts
# ~/user_interface, not this repository). Jobs and secrets never travel.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-$HOME/user_interface/va-agent}"

mkdir -p "$target"
rsync -a --delete \
  --exclude jobs --exclude var --exclude '*.env' \
  "$root/agent/" "$target/"

echo "synced agent → $target"
