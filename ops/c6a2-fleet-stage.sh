#!/bin/bash
#
# The C6a end-height move (#244, end 13488): put the fleet artefact on
# every fleet host AHEAD of the roll window, and prove on each host that it is
# the right file and that it can run there. Runs ON THE JUMP HOST.
#
# It writes one file to /tmp on each host and nothing else: no daemon is
# stopped, no conf is touched, nothing is installed. On each host it checks the
# md5 of the copy AS THAT HOST SEES IT (scp exiting 0 proves nothing), runs ldd
# on it (a build that links a library the target lacks has already been
# installed once on this project and would not start), and asks the binary for
# its version.
#
#   usage: ./c6a2-fleet-stage.sh <fleet-defcond>
set -uo pipefail

EXPECT_MD5=14583e7c2b40e8de2afb265d5bc1dfea
DEST=/tmp/defcond-c6a2
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}

DAEMON=${1:?usage: c6a2-fleet-stage.sh <fleet-defcond>}
[ -f "$DAEMON" ] || { echo "no such file: $DAEMON"; exit 1; }
LOCAL_MD5=$(md5sum "$DAEMON" | cut -d' ' -f1)
echo "==> staging md5 $LOCAL_MD5 to $DEST on every host in $INVENTORY"
[ "$LOCAL_MD5" = "$EXPECT_MD5" ] || { echo "    REFUSING: expected $EXPECT_MD5"; exit 1; }

SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

ok=0; failed=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  label=$(echo "$entry" | sed -E 's/([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.x/')
  printf '%-30s ' "$label"

  have=$($SSH "$target" "md5sum $DEST 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
  if [ "$have" != "$LOCAL_MD5" ]; then
    # a single transport failure to one of the production hosts has been transient before
    $SCP "$DAEMON" "$target:$DEST" || $SCP "$DAEMON" "$target:$DEST" || { echo "COPY FAILED"; failed=$((failed+1)); continue; }
  fi
  out=$($SSH "$target" "chmod 0755 $DEST; echo md5=\$(md5sum $DEST | cut -d' ' -f1) missing=\$(ldd $DEST 2>/dev/null | grep -c 'not found') version=\$($DEST -version 2>/dev/null | head -1 | tr ' ' '_')" 2>/dev/null)
  echo "$out"
  case "$out" in
    *"md5=$LOCAL_MD5 missing=0 version=DeFCoN"*) ok=$((ok+1)) ;;
    *) failed=$((failed+1)) ;;
  esac
done < "$INVENTORY"

echo
echo "==> staged-and-runnable=$ok failed=$failed"
echo "    Nothing was installed and no daemon was touched."
[ "$failed" = 0 ] || exit 1
