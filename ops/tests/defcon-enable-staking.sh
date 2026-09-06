#!/usr/bin/env bash
#
# Regression suite for ops/defcon-enable-staking against a fake defcon-cli.
#
# The bug this guards against: `setstaking` is a toggle, and the old script
# called it whenever a string match on `"staking": "true"` failed -- which was
# always, because the node answers a JSON boolean. So "ensure staking is on"
# could turn it off. Every case below drives the REAL script with a fake
# defcon-cli that records each RPC it receives, and asserts on the exit status
# and on exactly which calls were made.
#
# The last case is a negative control: the ORIGINAL script is run against the
# same fake, and the suite fails unless that script does call setstaking on a
# wallet that is already staking. A harness that cannot see the old bug has no
# business vouching for the fix.
#
# Needs bash and jq, nothing else, and never touches the host. Usage:
#
#     ops/tests/defcon-enable-staking.sh
set -euo pipefail
IFS=$'\n\t'

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT="$HERE/defcon-enable-staking"

command -v jq >/dev/null 2>&1 || { printf 'jq is required to run this suite\n' >&2; exit 1; }
[ -x "$SCRIPT" ] || { printf 'not executable: %s\n' "$SCRIPT" >&2; exit 1; }

TMP=$(mktemp -d)
cleanup() { rm -rf -- "$TMP"; }
trap cleanup EXIT
mkdir -p "$TMP/bin" "$TMP/mock" "$TMP/datadir"
MOCK="$TMP/mock"

# ── the fake defcon-cli ──────────────────────────────────────────────────────
# Real syntax is `defcon-cli -datadir=... -conf=... <command> [args]`. The fake
# skips the dash options, logs `<command> <args>` to calls.log, and answers from
# fixture files in $MOCK_DIR:
#   rpc-down            (exists)  getblockcount fails, as on a node in warmup
#   wallets.json                  liststakingwallets answer
#   info.json                     getstakinginfo answer before any setstaking
#   info_after.json               getstakinginfo answer after setstaking (else info.json)
#   setstaking.out                setstaking answer (default: true)
#   setstaking.rc                 setstaking exit status (default: 0)
# The single quotes are the point: every line is the body of the fake, written
# out unexpanded.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'd=${MOCK_DIR:?}' \
  'cmd=""; args=()' \
  'for a in "$@"; do' \
  '  if [ -z "$cmd" ]; then case "$a" in -*) ;; *) cmd=$a ;; esac' \
  '  else args+=("$a"); fi' \
  'done' \
  'printf "%s %s\n" "$cmd" "${args[*]:-}" >> "$d/calls.log"' \
  'case "$cmd" in' \
  '  getblockcount)' \
  '    if [ -e "$d/rpc-down" ]; then echo "error: couldn'"'"'t connect to server" >&2; exit 1; fi' \
  '    echo 9000 ;;' \
  '  liststakingwallets) cat "$d/wallets.json" ;;' \
  '  getstakinginfo)' \
  '    if [ -e "$d/toggled" ] && [ -e "$d/info_after.json" ]; then cat "$d/info_after.json"; else cat "$d/info.json"; fi ;;' \
  '  setstaking)' \
  '    touch "$d/toggled"' \
  '    if [ -e "$d/setstaking.out" ]; then cat "$d/setstaking.out"; else echo true; fi' \
  '    if [ -e "$d/setstaking.rc" ]; then exit "$(cat "$d/setstaking.rc")"; fi' \
  '    exit 0 ;;' \
  '  *) printf "unexpected defcon-cli command: %s\n" "$cmd" >&2; exit 64 ;;' \
  'esac' > "$TMP/bin/defcon-cli"
chmod +x "$TMP/bin/defcon-cli"

# ── the original script, verbatim, for the negative control ─────────────────
# This is the body that shipped on the VPS and the fleet (only the defcon-cli
# path differed between the two); the path is parameterised here so it can be
# pointed at the fake.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -u' \
  'DATADIR="$1"' \
  'CLI="${DEFCON_CLI} -datadir=${DATADIR} -conf=${DATADIR}/defcon.conf"' \
  'for _ in $(seq 1 60); do' \
  '    if $CLI getblockcount >/dev/null 2>&1; then' \
  '        for id in $($CLI liststakingwallets 2>/dev/null | grep -oP '"'"'^\s{2}"\K[0-9]+'"'"'); do' \
  '            state=$($CLI getstakinginfo 2>/dev/null | grep -o '"'"'"staking": "[a-z]*"'"'"' | head -1)' \
  '            [ "$state" = '"'"'"staking": "true"'"'"' ] || $CLI setstaking "$id" >/dev/null 2>&1' \
  '        done' \
  '        exit 0' \
  '    fi' \
  '    sleep 5' \
  'done' \
  'exit 0' > "$TMP/bin/defcon-enable-staking.orig"
chmod +x "$TMP/bin/defcon-enable-staking.orig"

# ── harness ──────────────────────────────────────────────────────────────────
passed=0
fail() { printf 'FAIL [%s]: %s\n' "$CASE" "$*" >&2; exit 1; }
pass() { passed=$((passed + 1)); printf 'ok   %s\n' "$CASE"; }

# Fixtures are pretty-printed the way the real defcon-cli prints them (two-space
# indent, one key per line). The old script's grep depends on exactly that
# layout, so a compact fixture would make the negative control pass for the
# wrong reason -- it would never find a wallet id and never reach the toggle.
fixture() { printf '%s' "$2" | jq . > "$MOCK/$1"; }

# The node's real answer shape (v22.1.5, read from devnet2 on 2026-09-06): a map
# keyed by wallet id, `staking` a JSON boolean inside each entry.
info_with() { printf '{"0":{"name":"w","staking":%s,"minter_running":true,"weight":1}}' "$1"; }

reset_mock() {
  rm -rf -- "$MOCK"
  mkdir -p "$MOCK"
  fixture wallets.json '{"0":{"name":"w","enabled":true,"balance":"1.00"}}'
  fixture info.json "$(info_with false)"
}

# run_script [script]: runs the script under test with the fake cli; captures
# status, stdout and stderr, and the call log.
RC=0; ERR=''; CALLS=''
run_script() {
  local script=${1:-$SCRIPT}
  RC=0
  ERR=$(MOCK_DIR="$MOCK" DEFCON_CLI="$TMP/bin/defcon-cli" \
        DEFCON_ENABLE_STAKING_TRIES=2 DEFCON_ENABLE_STAKING_SLEEP=0 \
        "$script" "$TMP/datadir" 2>&1 >/dev/null) || RC=$?
  CALLS=$(cat "$MOCK/calls.log" 2>/dev/null || true)
}
count_calls() { printf '%s\n' "$CALLS" | grep -c "^$1" || true; }
expect_rc()   { [ "$RC" -eq "$1" ] || fail "expected exit $1, got $RC; stderr: $ERR"; }
expect_calls() {
  # expect_calls <command> <n>
  local n
  n=$(count_calls "$1")
  [ "$n" -eq "$2" ] || fail "expected $2 call(s) to $1, got $n; calls:"$'\n'"$CALLS"
}
expect_err() { printf '%s' "$ERR" | grep -qF -- "$1" || fail "stderr lacks '$1'; got: $ERR"; }

# ── cases ────────────────────────────────────────────────────────────────────

CASE='staking already true -> no setstaking call'
reset_mock; fixture info.json "$(info_with true)"
run_script
expect_rc 0
expect_calls setstaking 0
expect_calls getstakinginfo 1
pass

CASE='staking false -> exactly one setstaking, then re-check reads true'
reset_mock; fixture info_after.json "$(info_with true)"
run_script
expect_rc 0
expect_calls 'setstaking 0' 1
expect_calls getstakinginfo 2
# Order matters: read, toggle, read again.
[ "$(printf '%s\n' "$CALLS" | grep -E '^(getstakinginfo|setstaking)' | tr '\n' ' ')" = 'getstakinginfo  setstaking 0 getstakinginfo  ' ] \
  || fail "unexpected call order:"$'\n'"$CALLS"
pass

CASE='invalid JSON from getstakinginfo -> no call, error'
reset_mock; printf '{"0":{"staking":tru\n' > "$MOCK/info.json"
run_script
expect_rc 1
expect_calls setstaking 0
expect_err 'not a JSON object'
pass

CASE='missing staking field -> no call, error'
reset_mock; fixture info.json '{"0":{"name":"w","minter_running":true}}'
run_script
expect_rc 1
expect_calls setstaking 0
expect_err 'no "staking" field'
pass

CASE='second read still false -> error, and no second toggle'
reset_mock; fixture info_after.json "$(info_with false)"
run_script
expect_rc 1
expect_calls setstaking 1
expect_calls getstakinginfo 2
expect_err 'not toggling again'
pass

CASE='staking as the string "true" (old binary) -> no call, error'
reset_mock; fixture info.json '{"0":{"name":"w","staking":"true"}}'
run_script
expect_rc 1
expect_calls setstaking 0
expect_err 'is a string, not a JSON boolean'
pass

CASE='wallet id absent from getstakinginfo -> no call, error'
reset_mock; fixture info.json '{"staking":true}'
run_script
expect_rc 1
expect_calls setstaking 0
expect_err 'no entry for wallet 0'
pass

CASE='two wallets, one on and one off -> only the off one is toggled'
reset_mock
fixture wallets.json '{"0":{"name":"a","enabled":true,"balance":"1.00"},"1":{"name":"b","enabled":false,"balance":"1.00"}}'
fixture info.json '{"0":{"name":"a","staking":true},"1":{"name":"b","staking":false}}'
fixture info_after.json '{"0":{"name":"a","staking":true},"1":{"name":"b","staking":true}}'
run_script
expect_rc 0
expect_calls setstaking 1
expect_calls 'setstaking 1' 1
pass

CASE='setstaking answers null (unknown id) -> error, no re-toggle'
reset_mock; printf 'null\n' > "$MOCK/setstaking.out"
run_script
expect_rc 1
expect_calls setstaking 1
expect_err 'did not report the switch as on'
pass

CASE='setstaking RPC fails -> error, no re-toggle'
reset_mock; printf '1\n' > "$MOCK/setstaking.rc"
run_script
expect_rc 1
expect_calls setstaking 1
pass

CASE='liststakingwallets not JSON -> no call, error'
reset_mock; printf 'garbage\n' > "$MOCK/wallets.json"
run_script
expect_rc 1
expect_calls setstaking 0
expect_err 'liststakingwallets'
pass

CASE='no staking wallet within the deadline -> no call, error'
reset_mock; fixture wallets.json '{}'
run_script
expect_rc 1
expect_calls setstaking 0
expect_calls getblockcount 2
expect_err 'no staking wallet listed'
pass

CASE='RPC never ready -> no call, error'
reset_mock; touch "$MOCK/rpc-down"
run_script
expect_rc 1
expect_calls setstaking 0
expect_calls getstakinginfo 0
pass

CASE='missing datadir argument -> usage error'
reset_mock
RC=0; ERR=$(DEFCON_CLI="$TMP/bin/defcon-cli" "$SCRIPT" 2>&1 >/dev/null) || RC=$?
expect_rc 2
pass

CASE='negative control: the original script toggles a wallet that is already staking'
reset_mock; fixture info.json "$(info_with true)"
run_script "$TMP/bin/defcon-enable-staking.orig"
expect_rc 0
expect_calls 'setstaking 0' 1
pass

printf 'all %d cases passed\n' "$passed"
