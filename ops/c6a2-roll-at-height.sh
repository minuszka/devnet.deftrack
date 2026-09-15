#!/bin/bash
# Start the C6a fleet roll at exactly START (a Q60 base + 10, the base not a
# multiple of 72). Runs ON THE JUMP HOST under nohup, from /root/roll-c6a2.
# Height is read from two fleet hosts' mn1 (the higher answer wins). If the first
# height seen at or above START is already past LATEST, it does NOT roll: the
# window +10..+19 would not hold a 16-host roll. It also refuses to start at or
# past HARD_STOP: every daemon must be on the new binary before the end height
# 13488, and a roll begun too close to it is a fork, not a roll.
#
#   usage: nohup ./c6a-roll-at-height.sh <START> <LATEST> > at-height.log 2>&1 &
START=${1:?start height}
LATEST=${2:?latest acceptable first-seen height}
HARD_STOP=13470
[ "$LATEST" -lt "$HARD_STOP" ] || { echo "REFUSING: latest $LATEST is not below the hard stop $HARD_STOP"; exit 4; }
DEADLINE=$(( $(date +%s) + 4*3600 ))
K=/root/.ssh/defcon_nodes
INV=/root/fleet-nodes-all.txt
SSH="ssh -n -i $K -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=no"
cd /root/roll-c6a2 || exit 1
height_of() {  # $1 = inventory entry
  local t=$1 u=root S=""; case "$t" in *@*) u=${t%%@*};; *) t="root@$t";; esac
  [ "$u" != root ] && S="sudo -n"
  $SSH "$t" "$S /opt/defcon-devnet/bin/defcon-cli -datadir=/opt/defcon-devnet/mn1 -conf=/opt/defcon-devnet/mn1/defcon.conf getblockcount" 2>/dev/null
}
A=$(grep -v '^[[:space:]]*\(#\|$\)' "$INV" | sed -n 2p)
B=$(grep -v '^[[:space:]]*\(#\|$\)' "$INV" | sed -n 3p)
echo "armed $(date -u +%FT%TZ) start=$START latest=$LATEST hard-stop=$HARD_STOP"
last=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ha=$(height_of "$A"); hb=$(height_of "$B")
  h=0
  [[ "$ha" =~ ^[0-9]+$ ]] && h=$ha
  [[ "$hb" =~ ^[0-9]+$ ]] && [ "$hb" -gt "$h" ] && h=$hb
  if [ "$h" != "$last" ]; then echo "$(date -u +%T) height $h"; last=$h; fi
  if [ "$h" -ge "$START" ]; then
    if [ "$h" -gt "$LATEST" ]; then echo "ABORT $(date -u +%T): first seen $h > $LATEST, not rolling"; exit 2; fi
    echo "ROLL START $(date -u +%FT%TZ) at height $h"
    ./c6a2-fleet-roll.sh > roll.log 2>&1
    rc=$?
    echo "ROLL END $(date -u +%FT%TZ) rc=$rc height $(height_of "$B")"
    exit $rc
  fi
  sleep 8
done
echo "DEADLINE reached without height $START"; exit 3
