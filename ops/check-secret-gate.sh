#!/usr/bin/env bash
#
# The secret scan, and proof that it can fail.
#
# A scanner that reports "no leaks found" is indistinguishable from a scanner
# with no rules loaded, a scanner pointed at the wrong directory, and a scanner
# that crashed politely. This project has already been burned three times in one
# day by tools that gave clean, wrong answers, so the gate runs twice: once over
# the tree as it stands, which must be clean, and once with a credential planted
# in it, which must trip.
#
# The planted value is generated at random on every run. That matters: gitleaks
# filters obvious placeholders, and the first version of this check planted
# "ghp_" followed by the alphabet and the digits -- which it ignored, exactly as
# designed, leaving a negative control that could never fail. A control built
# from a value the scanner is meant to skip proves nothing.
#
# Usage:  ops/check-secret-gate.sh [path-to-gitleaks]
set -euo pipefail

GITLEAKS=${1:-gitleaks}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$HERE"

command -v "$GITLEAKS" >/dev/null 2>&1 || {
  printf 'gitleaks not found (%s)\n' "$GITLEAKS" >&2
  exit 1
}

probe="$HERE/.secret-gate-probe.txt"
cleanup() { rm -f "$probe"; }
trap cleanup EXIT

scan() {
  # --no-git: the tree about to be published, not the history. See .gitleaks.toml.
  "$GITLEAKS" detect --no-git --redact --config "$HERE/.gitleaks.toml" "$@"
}

echo "==> scanning the working tree"
if ! scan --log-level warn; then
  echo "    FAILED: the tree contains something that looks like a credential" >&2
  echo "    Nothing is committed. Rotate it if it is real; allowlist it in" >&2
  echo "    .gitleaks.toml, by exact value and with a reason, if it is not." >&2
  exit 1
fi
echo "    clean"

echo "==> proving the scan can fail"
# Random, and shaped like a real token: a placeholder-looking value is filtered
# by the default ruleset and would make this control vacuous.
secret=$(head -c 40 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 36)
printf 'github_pat_probe = "ghp_%s"\n' "$secret" > "$probe"

if scan --log-level error >/dev/null 2>&1; then
  echo "    FAILED: a planted credential was not detected." >&2
  echo "    The scan is not measuring anything -- check the rules, the config" >&2
  echo "    path, and that the allowlist has not grown a pattern that swallows" >&2
  echo "    everything." >&2
  exit 1
fi
rm -f "$probe"
echo "    a planted credential trips it"

echo "==> secret gate: clean, and proven able to fail"
