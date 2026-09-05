#!/usr/bin/env bash
#
# ShellCheck over every shell script in the repository, including the ones
# without a .sh on the end.
#
# The two most safety-critical files here are `ops/chaos/defcon-chaos` and
# `ops/chaos/defcon-chaos-ssh` -- a root command and an SSH forced-command on
# production hosts -- and neither has an extension. A `*.sh` glob checks
# everything except them, which is the wrong half.
#
# Severity is left at the default, so info-level findings count too. Every
# suppression in this repository is a `# shellcheck disable=` directive with a
# sentence saying why, at the line it applies to; a blanket `--severity=warning`
# would hide the same findings with no record that anybody looked.
#
# Usage:  ops/check-shell.sh [path-to-shellcheck]
set -euo pipefail

SHELLCHECK=${1:-shellcheck}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$HERE"

command -v "$SHELLCHECK" >/dev/null 2>&1 || {
  printf 'shellcheck not found (%s)\n' "$SHELLCHECK" >&2
  exit 1
}

mapfile -t scripts < <(
  {
    find ops -type f -name '*.sh'
    # Extensionless: anything whose first line is a sh/bash shebang.
    find ops -type f ! -name '*.*' -exec sh -c 'head -1 "$1" | grep -q "^#!.*\b\(bash\|sh\)$"' _ {} \; -print
  } | sort -u
)

if [ "${#scripts[@]}" -eq 0 ]; then
  # An empty list would pass silently, which is the failure mode this whole
  # day of work is about.
  printf 'no shell scripts found -- the search is broken, not the tree\n' >&2
  exit 1
fi

printf '==> shellcheck (%d scripts)\n' "${#scripts[@]}"
printf '    %s\n' "${scripts[@]}"

# -x: follow `source`d files, so a helper is checked in the context that uses it.
"$SHELLCHECK" -x "${scripts[@]}"
printf '    clean\n'
