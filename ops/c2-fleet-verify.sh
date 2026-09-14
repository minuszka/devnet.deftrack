#!/bin/bash
#
# After the C2 roll: is every fleet daemon on the new binary, still carrying the
# #231 key, and on one chain? Runs ON THE JUMP HOST, read-only. Starts nothing,
# writes nothing, edits no conf. Reuses the #231 per-host helper, which reports
# running (md5 of /proc/<pid>/exe), keyed, logged and the distinct tips per host.
#
#   usage: ./c2-fleet-verify.sh <expected-md5> [helper]
#   helper defaults to /root/roll-231/fleet-roll-dslv2-verify-remote.sh
set -uo pipefail

EXPECT_MD5=${1:?usage: c2-fleet-verify.sh <expected-md5> [helper]}
REMOTE=${2:-/root/roll-231/fleet-roll-dslv2-verify-remote.sh}
H=12744
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}

[ -f "$REMOTE" ] || { echo "missing helper: $REMOTE"; exit 1; }
SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

echo "==> $(date -u +%FT%TZ) expecting md5 $EXPECT_MD5 on every fleet daemon, key height $H"
T=0; UP=0; RAN=0; KEYED=0; LOGGED=0; HOSTS=0; BAD=0; SPLIT=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  $SCP "$REMOTE" "$target:/tmp/roll-verify.sh" || { echo "FAIL copy"; BAD=$((BAD+1)); continue; }
  out=$($SSH "$target" "sh /tmp/roll-verify.sh $H $EXPECT_MD5; rm -f /tmp/roll-verify.sh" 2>&1)
  echo "$out" | awk '{print "  " $0}'
  line=$(echo "$out" | grep '^HOST ')
  [ -n "$line" ] || { BAD=$((BAD+1)); continue; }
  HOSTS=$((HOSTS+1))
  field() { echo "$line" | tr ' ' '\n' | grep "^$1=" | cut -d= -f2; }
  T=$((T + $(field total))); UP=$((UP + $(field up)))
  RAN=$((RAN + $(field running-new))); KEYED=$((KEYED + $(field keyed))); LOGGED=$((LOGGED + $(field logged)))
  [ "$(field distinct-tips)" -le 1 ] || SPLIT=$((SPLIT+1))
done < "$INVENTORY"

echo
echo "==> fleet: hosts=$HOSTS unreachable=$BAD daemons=$T up=$UP running-new=$RAN keyed=$KEYED logged=$LOGGED hosts-with-split-tips=$SPLIT"
echo "    (a host can read two tips while a block propagates; one chain is settled by fleet-chain-check2.sh)"
if [ "$T" -gt 0 ] && [ "$BAD" = 0 ] && [ "$UP" = "$T" ] && [ "$RAN" = "$T" ] && [ "$KEYED" = "$T" ]; then
  echo "    every fleet daemon runs $EXPECT_MD5 and keeps the key."
else
  echo "    NOT WHOLE."
  exit 1
fi
