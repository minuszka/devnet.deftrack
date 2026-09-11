#!/bin/bash
#
# Runs ON THE JUMP HOST. Freeze or thaw devnet block production by acting on the
# fleet stakers and on nothing else.
#
#   freeze-fleet.sh status   report what each host's instance 11 is, change nothing
#   freeze-fleet.sh freeze   stop and mask the staker unit on staker hosts
#   freeze-fleet.sh thaw     unmask and start it again
#
# WHICH UNIT IS A STAKER is read from the host, never from an inventory line,
# and "mn11 exists" is NOT the test: the host carrying 14 masternodes has an
# mn11 that IS a masternode, and masking it would take a masternode off the
# network for the whole roll -- the surest way to manufacture a PoSe ban wave.
# The decisive local test is the BLS key: init.cpp soft-sets disablewallet=1
# whenever masternodeblsprivkey is present and a masternode can never stake, so
#     conf carries masternodeblsprivkey -> MASTERNODE, leave alone
#     conf carries no such key          -> STAKER, a block producer
# The key is never printed; only whether the line exists.
#
# Every filesystem test goes through sudo on hosts that do not log in as root:
# the datadirs are mode 0700 owned by another user, so a bare `[ -f ]` answers
# "absent" for a file that is there -- measured on this fleet, and it
# misclassified a host before this guard existed.
#
# Fail closed: anything not positively identified as a staker is skipped.
#
# Masking rather than merely stopping: ops/fleet-deploy.sh restarts every
# instance it finds, so a stopped staker would come back up mid-roll. A masked
# unit refuses to start and the deploy's `|| true` passes over it, which is what
# keeps the chain frozen for the whole roll rather than until the first host.
set -uo pipefail

ACTION="${1:?usage: freeze-fleet.sh status|freeze|thaw}"
case "$ACTION" in status|freeze|thaw) ;; *) echo "unknown action: $ACTION"; exit 2 ;; esac

KEY=/root/.ssh/defcon_nodes
INVENTORY="${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}"
SSH="ssh -n -i $KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"

[ -r "$INVENTORY" ] || { echo "no inventory at $INVENTORY"; exit 2; }

stakers=0; acted=0; skipped=0; problems=0; hosts=0

while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  hosts=$((hosts+1))

  out=$($SSH "$target" "
    S=''
    if [ \"\$(id -u)\" != '0' ]; then
      S='sudo -n'
      \$S true 2>/dev/null || { echo 'NO-SUDO'; exit 1; }
    fi
    D=/opt/defcon-devnet/mn11
    C=\$D/defcon.conf
    \$S test -d \$D || { echo 'no-staker-dir'; exit 0; }
    \$S test -f \$C || { echo 'UNCLASSIFIED-no-conf'; exit 0; }
    if \$S grep -qiE '^[[:space:]]*masternodeblsprivkey' \$C; then
      echo 'masternode-at-11'; exit 0
    fi
    st=\$(systemctl is-active defcon-devnet-mn@11 2>/dev/null || true)
    en=\$(systemctl is-enabled defcon-devnet-mn@11 2>/dev/null || true)
    case '$ACTION' in
      status) echo \"STAKER state=\$st enabled=\$en\" ;;
      freeze)
        \$S systemctl stop defcon-devnet-mn@11 || true
        \$S systemctl mask defcon-devnet-mn@11 >/dev/null 2>&1 || true
        echo \"STAKER froze: state=\$(systemctl is-active defcon-devnet-mn@11 2>/dev/null || true) enabled=\$(systemctl is-enabled defcon-devnet-mn@11 2>/dev/null || true)\"
        ;;
      thaw)
        \$S systemctl unmask defcon-devnet-mn@11 >/dev/null 2>&1 || true
        \$S systemctl start defcon-devnet-mn@11 || true
        sleep 5
        echo \"STAKER thawed: state=\$(systemctl is-active defcon-devnet-mn@11 2>/dev/null || true) enabled=\$(systemctl is-enabled defcon-devnet-mn@11 2>/dev/null || true)\"
        ;;
    esac" 2>/dev/null)

  [ -z "$out" ] && out="NO-RESPONSE"
  printf '  %-14s %s\n' "${target%%@*}@" "$out"
  case "$out" in
    STAKER*)            stakers=$((stakers+1)); [ "$ACTION" = status ] || acted=$((acted+1)) ;;
    masternode-at-11)   skipped=$((skipped+1)) ;;
    no-staker-dir)      ;;
    *)                  problems=$((problems+1)) ;;
  esac
done < "$INVENTORY"

echo "---"
echo "action=$ACTION hosts=$hosts stakers=$stakers acted=$acted left_alone_masternode_at_11=$skipped problems=$problems"
[ "$problems" -eq 0 ] || exit 1
