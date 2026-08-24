#!/usr/bin/env bash
#
# Wipe the devnet chain from every masternode instance on ONE fullnode host and
# restart them, so they resync the current chain from genesis.
#
# Why a wipe and not just a restart: the chain was rebuilt, so the data these
# instances hold belongs to a chain that no longer exists. Restarting alone
# leaves them sitting on a dead fork, connected to nothing, looking exactly like
# a network fault.
#
# Two safety properties this script depends on, both verified against the seed
# node's layout:
#
#   * The devnet chain lives entirely in <datadir>/devnet-<network>/. Removing
#     that directory cannot touch the mainnet node running on the same host, and
#     cannot touch defcon.conf -- which holds masternodeblsprivkey and is NOT
#     recoverable from here if deleted.
#
#   * The datadir is read from the unit itself rather than assumed, so a host
#     with a different layout is skipped loudly instead of having the wrong
#     directory deleted.
#
# Usage, on a fullnode host:   ./fleet-reset.sh [instance-count]   (default 10)
# Dry run:                     DRY_RUN=1 ./fleet-reset.sh
set -euo pipefail

NETWORK="${NETWORK:-defcon-q60}"
UNIT_PREFIX="${UNIT_PREFIX:-defcon-devnet-mn}"
COUNT="${1:-10}"
DRY_RUN="${DRY_RUN:-0}"

say() { printf '%s\n' "$*"; }

wiped=0
skipped=0

for i in $(seq 1 "$COUNT"); do
  unit="${UNIT_PREFIX}@${i}"

  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    say "  $unit: no such unit -- skipped"
    skipped=$((skipped + 1))
    continue
  fi

  # -datadir= as the unit itself declares it, never guessed -- and read from
  # `systemctl show`, not `systemctl cat`, because the unit is templated and
  # the file still holds the literal %i rather than the instance number.
  datadir=$(systemctl show -p ExecStart --value "$unit" 2>/dev/null |
    tr ' ' '\012' | grep -oP '(?<=^-datadir=).+' | head -1 || true)

  if [ -z "$datadir" ] || [ "$datadir" = "/" ] || [ ! -d "$datadir" ]; then
    say "  $unit: could not resolve a datadir from the unit -- skipped"
    skipped=$((skipped + 1))
    continue
  fi

  chaindir="$datadir/devnet-$NETWORK"

  if [ ! -f "$datadir/defcon.conf" ]; then
    say "  $unit: $datadir holds no defcon.conf -- refusing to touch it"
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    say "  $unit: would stop, remove $chaindir, start"
    continue
  fi

  systemctl stop "$unit" || true
  # Only the chain data. defcon.conf, and with it the operator key, stays.
  # Often already absent -- an instance stopped before the chain was rebuilt has
  # nothing stale to remove, and then this is simply a start.
  if [ -d "$chaindir" ]; then
    rm -rf "$chaindir"
    action="wiped and started"
  else
    action="started (no stale chain data)"
  fi
  systemctl start "$unit"
  say "  $unit: $action"
  wiped=$((wiped + 1))
done

say ""
say "  $(hostname -s): $wiped restarted, $skipped skipped"

if [ "$DRY_RUN" = "1" ]; then
  exit 0
fi

# A masternode refuses to start below maxconnections=125 and needs the file
# descriptors for it, so a unit that comes back up is worth confirming rather
# than assuming.
sleep 8
say ""
say "  active units:"
for i in $(seq 1 "$COUNT"); do
  unit="${UNIT_PREFIX}@${i}"
  systemctl cat "$unit" >/dev/null 2>&1 || continue
  printf '    %s %s\n' "$unit" "$(systemctl is-active "$unit")"
done
