#!/bin/sh
#
# Runs ON ONE FLEET HOST, copied there by ops/fleet-roll-dslv2-verify.sh.
# Read-only: it starts nothing, writes nothing, and touches no conf.
#
# Three separate claims per daemon, because on this project they have come
# apart before:
#   running   -- md5 of /proc/<pid>/exe, the inode the process actually holds.
#                `defcond -version` has named three different builds here.
#   keyed     -- the line is in the conf.
#   logged    -- the node SAID it read the height (chainparams.cpp:1736). The
#                key can be in the file and not in the process if the daemon
#                was started before the edit, and only the log separates those.
#
#   usage: fleet-roll-dslv2-verify-remote.sh <height> <expected-md5>
set -u
H=${1:?height}
WANT=${2:?expected md5}

S=""
[ "$(id -u)" != 0 ] && S="sudo -n"
CLI=/opt/defcon-devnet/bin/defcon-cli
DIRS=$($S sh -c 'ls -d /opt/defcon-devnet/mn* 2>/dev/null')
[ -n "$DIRS" ] || { echo "HOST $(hostname) dirs=0"; exit 0; }

total=0; up=0; ran=0; keyed=0; logged=0; old=0
tips=""
for d in $DIRS; do
  i=${d##*/mn}
  total=$((total + 1))
  [ "$($S systemctl is-active "defcon-devnet-mn@$i")" = active ] && up=$((up + 1))
  pid=$($S systemctl show -p MainPID --value "defcon-devnet-mn@$i")
  m=$($S md5sum "/proc/$pid/exe" 2>/dev/null | cut -d' ' -f1)
  if [ "$m" = "$WANT" ]; then ran=$((ran + 1)); else old=$((old + 1)); echo "  STALE mn$i running=$m"; fi
  $S grep -qx "dslcommitmentv2height=$H" "$d/defcon.conf" && keyed=$((keyed + 1))
  $S grep -q "Setting dslcommitmentv2height to $H" "$d/devnet-defcon-q60/debug.log" 2>/dev/null && logged=$((logged + 1)) || echo "  NOLOG mn$i"
  t=$($S $CLI -datadir="$d" getbestblockhash 2>/dev/null)
  [ -n "$t" ] && tips="$tips $t"
done

# one chain, or say how many
distinct=$(echo "$tips" | tr ' ' '\n' | grep -v '^$' | sort -u | wc -l)
height=$($S $CLI -datadir="$(echo "$DIRS" | head -1)" getblockcount 2>/dev/null)
echo "HOST $(hostname) total=$total up=$up running-new=$ran stale=$old keyed=$keyed logged=$logged height=$height distinct-tips=$distinct"
