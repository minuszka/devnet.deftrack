#!/bin/bash
#
# The C6a end-height move (#244, end 13488) on the 16 fleet hosts.
# Runs ON THE JUMP HOST, after c6a2-fleet-stage.sh has put the binary on every
# host. The binary moves and nothing else: no conf key. #243 activates by itself
# at height 13488, so every daemon must be on this binary before that height.
#
# Host by host: preflight (the deployed binary is the expected one, the #231 key
# is in every conf, the staged copy is intact), then apply
# (c6a2-fleet-roll-remote.sh). The roll STOPS at the first host that does not come
# back whole -- a half-understood failure repeated on fifteen more hosts is the
# worst outcome available.
#
#   ./c6a2-fleet-roll.sh --check    # preflight every host, change nothing
#   ./c6a2-fleet-roll.sh            # preflight, then roll
set -uo pipefail

NEW_MD5=14583e7c2b40e8de2afb265d5bc1dfea
OLD_MD5=7bf411b0eb08731b6e050868b1d2ff72
STAGED=/tmp/defcond-c6a2
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REMOTE=$HERE/c6a2-fleet-roll-remote.sh
[ -f "$REMOTE" ] || { echo "missing helper: $REMOTE"; exit 1; }

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

echo "==> $(date -u +%FT%TZ) new $NEW_MD5, replacing $OLD_MD5, inventory $INVENTORY, check-only=$CHECK_ONLY"
ok=0; failed=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  label=$(echo "$entry" | sed -E 's/([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.x/')
  echo "=== $label  $(date -u +%T)"
  $SCP "$REMOTE" "$target:/tmp/c6a2-roll.sh" || { echo "  FAIL: helper copy"; failed=$((failed+1)); break; }
  pre=$($SSH "$target" "sh /tmp/c6a2-roll.sh $STAGED $NEW_MD5 $OLD_MD5 preflight" 2>&1)
  echo "  $pre"
  case "$pre" in
    *"diskmd5=$OLD_MD5 staged=$NEW_MD5"*) ;;
    *) echo "  FAIL: preflight not clean"; failed=$((failed+1)); break ;;
  esac
  if [ "$CHECK_ONLY" = 1 ]; then ok=$((ok+1)); continue; fi

  out=$($SSH "$target" "sh /tmp/c6a2-roll.sh $STAGED $NEW_MD5 $OLD_MD5 apply; echo rc=\$?; rm -f /tmp/c6a2-roll.sh" 2>&1)
  echo "$out" | awk '{print "  " $0}'
  if echo "$out" | grep -q '^rc=0$' && echo "$out" | grep -q "diskmd5=$NEW_MD5"; then
    ok=$((ok+1))
  else
    echo "  FAIL: this host did not come back whole -- stopping the roll here"
    failed=$((failed+1)); break
  fi
done < "$INVENTORY"

echo
echo "==> $(date -u +%FT%TZ) hosts ok=$ok failed=$failed"
[ "$failed" = 0 ] || exit 1
