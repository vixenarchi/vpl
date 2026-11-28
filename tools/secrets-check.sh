#!/usr/bin/env bash
# Every commit, every file: no key in the history.
#
# This repository is public. That changes what a leak means: a secret pushed here
# is not "in a private repo for a while", it is published, indexed, and in
# somebody's clone before the next commit. A password that was rotated after the
# fact is still a password that was public, and the history is the part nobody
# remembers to fix.
#
# So the check is over the history, not the working tree: `git log --all`, every
# blob of every commit, because a key that was removed in the next commit is
# exactly the key this is looking for. It is cheap — one second for the whole
# repository — so it runs in the gate rather than in a good intention.
#
# The rules are gitleaks' own, plus one allowlist in .gitleaks.toml: the anon
# key, which is public by design. A config file replaces the bundled rules
# instead of adding to them, so that file starts with `useDefault` — without it
# the scan reports nothing and looks like a pass.
#
#   ./tools/secrets-check.sh            # the gate's form
#   ./tools/secrets-check.sh --full     # print every finding, secrets redacted
#
# Exit codes: 0 clean, 1 leaks, 78 not configured (gitleaks is not installed).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FULL=""
[ "${1:-}" = "--full" ] && FULL="--redact=0"
cd "$ROOT" || exit 2

BIN=${GITLEAKS:-$(command -v gitleaks 2>/dev/null || true)}
if [ -z "$BIN" ] && [ -x "$HOME/.local/bin/gitleaks" ]; then BIN="$HOME/.local/bin/gitleaks"; fi
if [ -z "$BIN" ]; then
  echo "secrets: SKIPPED — gitleaks is not installed, so the history was not read"
  echo "secrets: install it (https://github.com/gitleaks/gitleaks) or set GITLEAKS=/path/to/gitleaks"
  exit 78
fi

REPORT=$(mktemp)
trap 'rm -f "$REPORT"' EXIT

"$BIN" git --log-opts="--all" --config .gitleaks.toml --no-banner \
  $FULL --report-format=json --report-path="$REPORT" >/dev/null 2>&1
STATUS=$?

COMMITS=$(git rev-list --all | wc -l)

if [ "$STATUS" -eq 0 ]; then
  echo "secrets: no key in $COMMITS commits, every file, every branch"
  exit 0
fi

if [ "$STATUS" -eq 126 ] || [ "$STATUS" -eq 127 ]; then
  echo "secrets: SKIPPED — gitleaks could not run"
  exit 78
fi

echo "secrets: a key in the history of a public repository — this is a leak, not a warning"
node -e '
  const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const r of rows) {
    const where = `${r.File}:${r.StartLine ?? "?"}`;
    const commit = String(r.Commit || "").slice(0, 8);
    console.log(`  ${r.RuleID.padEnd(10)} ${where}  commit ${commit}`);
  }
  console.log(`  ${rows.length} finding(s)`);
' "$REPORT" 2>/dev/null || cat "$REPORT"
echo "secrets: rotate the key first, then read docs/security.md for the history rewrite"
exit 1
