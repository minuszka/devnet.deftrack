#!/bin/bash
#
# Put the roll's binary on every fleet host AHEAD of the roll window, so the
# window itself contains only stop -> install -> key -> start.
#
# Runs ON THE JUMP HOST. It writes one file to /tmp on each host and nothing
# else: no daemon is stopped, no conf is touched, nothing is installed. The
# copy is ~395 MB per host and is the slow part of the roll; moving it out of
# the window is the difference between a roll that fits comfortably between two
# DKG phases and one that is racing them.
#
#   usage: ./fleet-roll-dslv2-stage.sh <staged-defcond>
#
# Afterwards ./fleet-roll-dslv2.sh sees the file already in place, verifies its
# md5 on the host, and skips the copy.
set -uo pipefail

EXPECT_MD5=455d516e2138dd81bdc58ba86c8b5c97
DEST=/tmp/defcond-dslv2
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}

DAEMON=${1:?usage: fleet-roll-dslv2-stage.sh <staged-defcond>}
[ -f "$DAEMON" ] || { echo "no such file: $DAEMON"; exit 1; }
LOCAL_MD5=$(md5sum "$DAEMON" | cut -d' ' -f1)
echo "==> staging md5 $LOCAL_MD5 to $DEST on every host"
[ "$LOCAL_MD5" = "$EXPECT_MD5" ] || { echo "    REFUSING: expected $EXPECT_MD5"; exit 1; }
echo

SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

ok=0; failed=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  printf '%-34s ' "$entry"

  have=$($SSH "$target" "md5sum $DEST 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
  if [ "$have" = "$LOCAL_MD5" ]; then
    echo "already staged"
    ok=$((ok+1)); continue
  fi

  if ! $SCP "$DAEMON" "$target:$DEST"; then
    echo "COPY FAILED"
    failed=$((failed+1)); continue
  fi
  # the copy is only done when the host says the bytes match, not when scp exits 0
  got=$($SSH "$target" "md5sum $DEST 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
  if [ "$got" = "$LOCAL_MD5" ]; then
    echo "staged, md5 verified on the host"
    ok=$((ok+1))
  else
    echo "COPIED BUT md5 IS $got"
    failed=$((failed+1))
  fi
done < "$INVENTORY"

echo
echo "==> staged=$ok failed=$failed"
echo "    Nothing was installed and no daemon was touched. The roll window now"
echo "    carries only stop -> install -> key -> start."
[ "$failed" = 0 ] || exit 1
