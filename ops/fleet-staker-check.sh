#!/bin/bash
# Runs ON THE JUMP HOST. Read-only. Is each thawed staker actually staking?
#
# getstakinginfo reports wallet state, not the minter thread: it says
# staking:true with a full weight whether or not ThreadStakeMiner is alive. The
# only place the difference shows is the log, where every start must be matched
# by one fewer exit than starts. So both are read, and they are different
# claims.
set -uo pipefail
KEY=/root/.ssh/defcon_nodes
INVENTORY=/root/fleet-nodes-all.txt
SSH="ssh -n -i $KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"

alive=0; dead=0
while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  # shellcheck disable=SC2016  # single quotes are the point: this block is
  # evaluated by the REMOTE shell, so $S, $C and $(id -u) must cross the wire
  # unexpanded. Expanding them here would send this machine's empty values.
  out=$($SSH "$target" '
    S=""; [ "$(id -u)" != "0" ] && S="sudo -n"
    D=/opt/defcon-devnet/mn11
    $S test -d $D || exit 0
    $S grep -qiE "^[[:space:]]*masternodeblsprivkey" $D/defcon.conf 2>/dev/null && exit 0
    C=/opt/defcon-devnet/bin/defcon-cli
    st=$($S $C -datadir=$D liststakingwallets 2>/dev/null | jq -r "[.[].enabled] | map(tostring) | join(\",\")" 2>/dev/null)
    h=$($S $C -datadir=$D getblockcount 2>/dev/null)
    p=$($S $C -datadir=$D getconnectioncount 2>/dev/null)
    L=$D/devnet-defcon-q60/debug.log
    # The LAST minter line, not a count. The node shrinks a debug.log over
    # 10 MB at startup, so the first "thread start" can be gone and
    # starts-vs-exits then reads equal on a perfectly live minter -- which is
    # exactly the false alarm this check gave before being fixed.
    last=$($S grep -E "threadstakeminer thread (start|exit)" $L 2>/dev/null | tail -1)
    echo "height=$h peers=$p staking=[$st] minter_last=[${last:-NONE}]"' 2>/dev/null)
  [ -z "$out" ] && continue
  printf '  %s\n' "$out"
  case "$out" in
    *"thread start]"*) alive=$((alive+1)) ;;
    *) dead=$((dead+1)) ;;
  esac
done < "$INVENTORY"
echo "---"
echo "stakers whose last minter line is a start: $alive ; without: $dead"
