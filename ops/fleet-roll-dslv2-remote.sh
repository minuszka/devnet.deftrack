#!/bin/sh
#
# Runs ON ONE FLEET HOST, copied there by ops/fleet-roll-dslv2.sh. It is a file
# rather than a quoted block inside the ssh command on purpose: this step edits
# every conf on the host, and a quoting bug three levels deep would write a
# wrong file silently. Nothing here needs escaping by the calling shell.
#
#   usage: fleet-roll-dslv2-remote.sh <height> <staged-binary> preflight|apply
#
# preflight changes nothing and prints what apply would find.
set -u
H=${1:?height}
SRC=${2:?staged binary}
MODE=${3:?preflight|apply}

S=""
[ "$(id -u)" != 0 ] && S="sudo -n"
B=/opt/defcon-devnet/bin
DIRS=$($S sh -c 'ls -d /opt/defcon-devnet/mn* 2>/dev/null')

if [ -z "$DIRS" ]; then
  echo "PRE dirs=0"
  exit 0
fi

confs=0; nodevnet=0; haskey=0
for d in $DIRS; do
  c=$d/defcon.conf
  if ! $S test -f "$c"; then nodevnet=$((nodevnet + 1)); continue; fi
  confs=$((confs + 1))
  $S grep -q '^\[devnet\]' "$c" || nodevnet=$((nodevnet + 1))
  $S grep -qi 'dslcommitmentv2height' "$c" && haskey=$((haskey + 1))
done
echo "PRE confs=$confs nodevnet=$nodevnet haskey=$haskey diskmd5=$($S md5sum $B/defcond 2>/dev/null | cut -d' ' -f1)"

[ "$MODE" = preflight ] && exit 0

# A host is taken whole or not at all.
if [ "$confs" = 0 ] || [ "$nodevnet" != 0 ] || [ "$haskey" != 0 ]; then
  echo "APPLY refused: pre-flight is not clean on this host"
  exit 2
fi

# shellcheck disable=SC2001  # DIRS is a multi-line list, not one value, so
# ${var##pattern} cannot strip the prefix from each line; sed is the shape here.
IDX=$(echo "$DIRS" | sed 's#.*/mn##' | sort -n)
STAMP=$(date +%Y%m%d-%H%M)

# stop -> install -> key -> start. The key under the old binary is a start
# failure; the new binary without the key forks at the next commitment. Neither
# state is ever reachable by Restart=on-failure inside this window.
for i in $IDX; do $S systemctl stop "defcon-devnet-mn@$i"; done

$S cp -a $B/defcond "$B/defcond.bak-$STAMP" || { echo "APPLY backup failed"; exit 3; }
$S install -m 0755 "$SRC" $B/defcond || { echo "APPLY install failed"; exit 3; }

for d in $DIRS; do
  c=$d/defcon.conf
  $S cp -a "$c" "$c.bak-$STAMP"
  # append after the section header, so the key is read for devnet and not for
  # whatever section happens to be last in the file
  $S sed -i "/^\[devnet\]/a dslcommitmentv2height=$H" "$c"
done

for i in $IDX; do $S systemctl start "defcon-devnet-mn@$i"; done
sleep 8

up=0; total=0; keyed=0; logged=0; ran=0
NEW=$(md5sum "$SRC" | cut -d' ' -f1)
for d in $DIRS; do
  i=${d##*/mn}
  total=$((total + 1))
  [ "$($S systemctl is-active "defcon-devnet-mn@$i")" = active ] && up=$((up + 1))
  $S grep -qx "dslcommitmentv2height=$H" "$d/defcon.conf" && keyed=$((keyed + 1))
  $S grep -q "Setting dslcommitmentv2height to $H" "$d/devnet-defcon-q60/debug.log" 2>/dev/null && logged=$((logged + 1))
  pid=$($S systemctl show -p MainPID --value "defcon-devnet-mn@$i")
  [ "$($S md5sum "/proc/$pid/exe" 2>/dev/null | cut -d' ' -f1)" = "$NEW" ] && ran=$((ran + 1))
done
$S rm -f "$SRC"
echo "POST up=$up/$total keyed=$keyed/$total logged=$logged/$total running-new=$ran/$total diskmd5=$($S md5sum $B/defcond | cut -d' ' -f1)"

[ "$up" = "$total" ] && [ "$keyed" = "$total" ] && [ "$ran" = "$total" ] || exit 4
exit 0
