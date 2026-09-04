#!/usr/bin/env bash
# Static package verification; CI runs this before TypeScript checks.
set -euo pipefail
IFS=$'\n\t'

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
syntax_scripts=(defcon-chaos defcon-chaos-ssh install.sh uninstall.sh verify.sh tests/run.sh)
for script in "${syntax_scripts[@]}"; do
  bash -n "$HERE/$script"
done

command -v shellcheck >/dev/null 2>&1 || {
  printf '%s\n' 'shellcheck is required for the chaos-wrapper verification gate' >&2
  exit 1
}
shellcheck -x -S warning "$HERE/defcon-chaos" "$HERE/defcon-chaos-ssh" "$HERE/install.sh" "$HERE/uninstall.sh" "$HERE/verify.sh"
bash "$HERE/tests/run.sh"
