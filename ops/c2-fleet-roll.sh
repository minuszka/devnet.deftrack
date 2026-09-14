#!/bin/bash
#
# The C2 roll (#235-#240, merged v22.1.x dc0db600e4) on the 16 fleet hosts.
# Runs ON THE JUMP HOST, after ops/c2-fleet-stage.sh has put the binary on every
# host. The binary moves and nothing else: no conf key, no activation height.
#
# Host by host: preflight (the deployed binary is the expected one, the #231 key
# is in every conf, the staged copy is intact), then apply
# (c2-fleet-roll-remote.sh). The roll STOPS at the first host that does not come
# back whole -- a half-understood failure repeated on fifteen more hosts is the
# worst outcome available.
#
#   ./c2-fleet-roll.sh --check    # preflight every host, change nothing
#   ./c2-fleet-roll.sh            # preflight, then roll
set -uo pipefail

NEW_MD5=c9898910b40a57d253dae73905e14845
OLD_MD5=455d516e2138dd81bdc58ba86c8b5c97
STAGED=/tmp/defcond-c2
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REMOTE=$HERE/c2-fleet-roll-remote.sh
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
  $SCP "$REMOTE" "$target:/tmp/c2-roll.sh" || { echo "  FAIL: helper copy"; failed=$((failed+1)); break; }
  pre=$($SSH "$target" "sh /tmp/c2-roll.sh $STAGED $NEW_MD5 $OLD_MD5 preflight" 2>&1)
  echo "  $pre"
  case "$pre" in
    *"diskmd5=$OLD_MD5 staged=$NEW_MD5"*) ;;
    *) echo "  FAIL: preflight not clean"; failed=$((failed+1)); break ;;
  esac
  if [ "$CHECK_ONLY" = 1 ]; then ok=$((ok+1)); continue; fi

  out=$($SSH "$target" "sh /tmp/c2-roll.sh $STAGED $NEW_MD5 $OLD_MD5 apply; echo rc=\$?; rm -f /tmp/c2-roll.sh" 2>&1)
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
