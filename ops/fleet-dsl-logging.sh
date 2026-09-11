#!/bin/bash
# Runs ON THE JUMP HOST. Turn the dsl log category on at RUNTIME -- no conf
# change, no restart -- on each host's instance 1 and on its staker if it has
# one.
#
# Why it matters: #228 gave the Sentinel layer its first log lines, and this
# fleet has just taken that binary. Until now not one absent epoch on this
# network could be explained from a log, because there was nothing to read. The
# decisive line for an absent epoch ("block built without the commitment",
# F-2026-140) is emitted by the PRODUCER, which is a staker, so the stakers are
# included and not only the masternodes.
#
# Runtime only, deliberately: it costs nothing to undo, and the measured volume
# is about 50 lines per epoch per node. It does NOT survive a restart -- which
# is how this roll silently switched off the instantsend logging the 2026-09-10
# runs had left on.
#
#   enable-dsl-log.sh on    include dsl
#   enable-dsl-log.sh off   exclude dsl
#   enable-dsl-log.sh show  report, change nothing
set -uo pipefail
ACTION="${1:?usage: enable-dsl-log.sh on|off|show}"
case "$ACTION" in on|off|show) ;; *) echo "unknown action"; exit 2 ;; esac

K=/root/.ssh/defcon_nodes
INV=/root/fleet-nodes-all.txt
SSH="ssh -n -i $K -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=20"

on=0; off=0; probs=0
while read -r e; do
  case "$e" in ""|\#*) continue ;; esac
  case "$e" in *@*) t="$e" ;; *) t="root@$e" ;; esac
  out=$($SSH "$t" "
    S=''; [ \"\$(id -u)\" != '0' ] && S='sudo -n'
    B=/opt/defcon-devnet/bin/defcon-cli
    res=''
    for d in /opt/defcon-devnet/mn1 /opt/defcon-devnet/mn11; do
      [ -d \$d ] || continue
      # mn11 is a staker only where it has no BLS key; a masternode there is
      # included too, which is harmless for logging, so no filter is needed.
      case '$ACTION' in
        on)   v=\$(\$S \$B -datadir=\$d logging '[\"dsl\"]' '[]' 2>/dev/null | jq -r '.dsl' 2>/dev/null) ;;
        off)  v=\$(\$S \$B -datadir=\$d logging '[]' '[\"dsl\"]' 2>/dev/null | jq -r '.dsl' 2>/dev/null) ;;
        show) v=\$(\$S \$B -datadir=\$d logging 2>/dev/null | jq -r '.dsl' 2>/dev/null) ;;
      esac
      res=\"\$res \${d##*/}=\${v:-?}\"
    done
    echo \"\$res\"" 2>/dev/null)
  [ -z "$out" ] && { printf '  %-14s NO ANSWER\n' "${t%%@*}@"; probs=$((probs+1)); continue; }
  printf '  %-14s %s\n' "${t%%@*}@" "$out"
  n_true=$(printf '%s' "$out" | grep -o '=true' | grep -c .)
  n_false=$(printf '%s' "$out" | grep -o '=false' | grep -c .)
  on=$((on + n_true)); off=$((off + n_false))
done < "$INV"
echo "---"
echo "action=$ACTION  daemons with dsl=true: $on  with dsl=false: $off  no answer: $probs"
