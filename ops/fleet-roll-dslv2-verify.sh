#!/bin/bash
#
# After the #231 roll: did every fleet daemon take BOTH halves? Runs ON THE JUMP
# HOST, read-only. Starts nothing, writes nothing, edits no conf.
#
# The two halves fail differently and must be counted separately:
#   a daemon on the new binary WITHOUT the key rejects the next v1 commitment
#   and forks at the next epoch boundary -- so `logged` is the number that
#   matters, not `keyed`. A key in the file that the running process never read
#   is exactly the state that looks fine and is not.
#
#   usage: ./fleet-roll-dslv2-verify.sh
set -uo pipefail

H=12744
EXPECT_MD5=455d516e2138dd81bdc58ba86c8b5c97
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REMOTE=$HERE/fleet-roll-dslv2-verify-remote.sh

[ -f "$REMOTE" ] || { echo "missing helper: $REMOTE"; exit 1; }
SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

echo "==> expecting md5 $EXPECT_MD5 and height $H on every fleet daemon"
echo

T=0; UP=0; RAN=0; KEYED=0; LOGGED=0; HOSTS=0; BAD=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  $SCP "$REMOTE" "$target:/tmp/roll-verify.sh" || { echo "$entry: FAIL copy"; BAD=$((BAD+1)); continue; }
  out=$($SSH "$target" "sh /tmp/roll-verify.sh $H $EXPECT_MD5; rm -f /tmp/roll-verify.sh" 2>&1)
  echo "$out" | awk '{print "  " $0}'
  line=$(echo "$out" | grep '^HOST ')
  [ -n "$line" ] || { BAD=$((BAD+1)); continue; }
  HOSTS=$((HOSTS+1))
  # read the fields by name rather than eval-ing a line that came off another
  # machine: the numbers are needed, an eval of remote text is not
  field() { echo "$line" | tr ' ' '\n' | grep "^$1=" | cut -d= -f2; }
  T=$((T + $(field total))); UP=$((UP + $(field up)))
  RAN=$((RAN + $(field running-new))); KEYED=$((KEYED + $(field keyed))); LOGGED=$((LOGGED + $(field logged)))
done < "$INVENTORY"

echo
echo "==> fleet: hosts=$HOSTS unreachable=$BAD daemons=$T up=$UP running-new=$RAN keyed=$KEYED logged=$LOGGED"
if [ "$T" -gt 0 ] && [ "$UP" = "$T" ] && [ "$RAN" = "$T" ] && [ "$LOGGED" = "$T" ]; then
  echo "    every fleet daemon has both halves."
else
  echo "    NOT WHOLE. A daemon with the binary and without the key forks at the"
  echo "    next epoch boundary, so fix it before that boundary, not before H."
  exit 1
fi
echo
echo "    Still owed after this: the seed and devnet2 (ops/seed-roll-dslv2.sh"
echo "    prints the same three facts), one chain across the network, and the"
echo "    FIRST epoch boundary after the roll -- which is the real checkpoint."
