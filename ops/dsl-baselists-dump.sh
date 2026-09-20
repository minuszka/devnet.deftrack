#!/usr/bin/env bash
#
# The deterministic masternode list at every Sentinel epoch base, as JSONL, for
# ops/dsl-enforcement-replay.py.
#
# Runs on the explorer VPS against the seed's RPC, read-only and paced: one
# `protx diff 1 <base>` per epoch, reduced to proRegTxHash, confirmedHash and
# isValid, which is all the replay needs to reproduce the commitment's bit order
# (the list sorted by proTxHash in the node's internal byte order). The explorer
# stores the bit indices and, where it could resolve them, the proTxHashes; it
# does not store the list itself, and its resolver refuses a partial answer.
#
# Usage:  ops/dsl-baselists-dump.sh [first-epoch] [last-epoch] > baselists.jsonl
#   defaults: from the devnet's first committable epoch (228, base 5472) to the
#   tip's epoch. ~0.3 s per epoch.
set -euo pipefail

CLI="${DEFCON_CLI:-/usr/local/bin/defcon-cli -datadir=/home/defcon/.defcon -conf=/home/defcon/.defcon/defcon.conf}"
EPOCH_INTERVAL=24
FIRST="${1:-228}"
TIP=$($CLI getblockcount)
LAST="${2:-$(( TIP / EPOCH_INTERVAL ))}"

for e in $(seq "$FIRST" "$LAST"); do
  b=$(( e * EPOCH_INTERVAL ))
  hash=$($CLI getblockhash "$b") || continue
  $CLI protx diff 1 "$b" | jq -c --argjson e "$e" --argjson b "$b" --arg h "$hash" \
    '{epoch: $e, base: $b, baseHash: $h, mnList: [.mnList[] | {proRegTxHash, confirmedHash, isValid}]}'
  sleep 0.2
done
