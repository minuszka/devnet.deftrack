#!/bin/bash
#
# Runs ON THE JUMP HOST. Read-only. The protocol-floor half of the acceptance
# matrix, which no existing tool measures: md5 says what a host installed, but
# only the peer table says whether the floor is actually in force.
#
# Per host, from instance 1: the version this daemon advertises, its tip, and
# how many of its peers sit below the floor. A fully rolled network answers
# proto=70242 everywhere with below_floor=0; any non-zero count names a daemon
# that has not been replaced, wherever it is.
set -uo pipefail
FLOOR=70242
KEY=/root/.ssh/defcon_nodes
INVENTORY="${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}"
SSH="ssh -n -i $KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"

hosts=0; at_floor=0; below=0; total_below_peers=0; problems=0
declare -A tips

while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  hosts=$((hosts+1))
  # Two attempts: a single large getpeerinfo dump timed out once on this fleet
  # and a checker that reports NO-RESPONSE would read as "not rolled", which is
  # the wrong alarm in the wrong direction.
  out=""
  for attempt in 1 2; do
  out=$($SSH "$target" "
    S=''
    if [ \"\$(id -u)\" != '0' ]; then S='sudo -n'; \$S true 2>/dev/null || { echo 'NO-SUDO'; exit 1; }; fi
    C=/opt/defcon-devnet/bin/defcon-cli
    D=/opt/defcon-devnet/mn1
    pv=\$(\$S \$C -datadir=\$D getnetworkinfo 2>/dev/null | grep -m1 '\"protocolversion\"' | tr -dc '0-9')
    h=\$(\$S \$C -datadir=\$D getblockcount 2>/dev/null | tr -dc '0-9')
    bh=\$(\$S \$C -datadir=\$D getbestblockhash 2>/dev/null | tr -dc 'a-f0-9')
    # Peer protocol versions: the field is \"version\" inside each peer entry.
    # jq, not a text scrape: a peer entry carries more than one line that
    # looks like a version field, so grep counted three per peer and called
    # two of them below the floor -- 4930 fake stragglers on a fleet that was
    # fully rolled. jq reads the actual .version of each peer.
    low=\$(\$S \$C -datadir=\$D getpeerinfo 2>/dev/null | jq '[.[] | select(.version < $FLOOR)] | length')
    np=\$(\$S \$C -datadir=\$D getpeerinfo 2>/dev/null | jq 'length')
    md5=\$(\$S md5sum /opt/defcon-devnet/bin/defcond 2>/dev/null | cut -c1-8)
    echo \"md5=\$md5 proto=\$pv height=\$h hash=\${bh:0:12} peers=\$np below_floor=\$low\"" 2>/dev/null)
    case "$out" in ""|NO-SUDO) [ "$attempt" = 1 ] && sleep 3 && continue ;; esac
    break
  done

  [ -z "$out" ] && out="NO-RESPONSE"
  printf '  %-14s %s\n' "${target%%@*}@" "$out"
  case "$out" in
    *proto=$FLOOR*) at_floor=$((at_floor+1)) ;;
    NO-RESPONSE|NO-SUDO) problems=$((problems+1)); continue ;;
    *) below=$((below+1)) ;;
  esac
  n=${out##*below_floor=}
  case "$n" in ''|*[!0-9]*) ;; *) total_below_peers=$((total_below_peers+n)) ;; esac
  hh=${out#*hash=}; hh=${hh%% *}
  [ -n "$hh" ] && tips[$hh]=$(( ${tips[$hh]:-0} + 1 ))
done < "$INVENTORY"

echo "---"
echo "distinct tip hashes across hosts:"
for k in "${!tips[@]}"; do echo "   $k on ${tips[$k]} hosts"; done
echo "hosts=$hosts at_floor($FLOOR)=$at_floor below_floor_hosts=$below peers_below_floor_total=$total_below_peers problems=$problems"
[ "$problems" -eq 0 ] && [ "$below" -eq 0 ] && [ "$total_below_peers" -eq 0 ] && echo "VERDICT: floor in force everywhere" || echo "VERDICT: NOT fully rolled"
