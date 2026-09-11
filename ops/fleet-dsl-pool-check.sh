#!/bin/bash
# Runs ON THE JUMP HOST. Read-only. Does every fleet masternode agree on the
# report pool the Sentinel commitment will be signed over?
#
# The decisive number is the count of DISTINCT poolhash values. One means the
# quorum has converged; more means it has not, and a commitment needs agreement
# on the exact set. Sampled on instance 1 of every host, so a host-local fault
# shows as one outlier rather than hiding in an average.
set -uo pipefail
K=/root/.ssh/defcon_nodes
INV=/root/fleet-nodes-all.txt
SSH="ssh -n -i $K -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=20"

tmp=$(mktemp)
hosts=0; answered=0
while read -r e; do
  case "$e" in ""|\#*) continue ;; esac
  case "$e" in *@*) t="$e" ;; *) t="root@$e" ;; esac
  hosts=$((hosts+1))
  # shellcheck disable=SC2016  # single quotes are the point: this block is
  # evaluated by the REMOTE shell, so $S, $C and $(id -u) must cross the wire
  # unexpanded. Expanding them here would send this machine's empty values.
  out=$($SSH "$t" 'S=""; [ "$(id -u)" != "0" ] && S="sudo -n"
    D=/opt/defcon-devnet/mn1
    C="/opt/defcon-devnet/bin/defcon-cli -datadir=$D -conf=$D/defcon.conf"
    $S $C dslstatus 2>/dev/null | jq -r "[.epoch, .respondedcount, .epochreports, .missedreports, .poolhash] | @tsv" 2>/dev/null' 2>/dev/null)
  if [ -z "$out" ]; then printf '  %-14s NO ANSWER\n' "${t%%@*}@"; continue; fi
  answered=$((answered+1))
  epoch=$(printf '%s' "$out" | cut -f1)
  resp=$(printf '%s' "$out" | cut -f2)
  reps=$(printf '%s' "$out" | cut -f3)
  miss=$(printf '%s' "$out" | cut -f4)
  ph=$(printf '%s' "$out" | cut -f5)
  printf '  %-14s epoch=%s responded=%s reports=%s missed=%s poolhash=%s\n' \
    "${t%%@*}@" "$epoch" "$resp" "$reps" "$miss" "${ph:0:16}"
  printf '%s\n' "$ph" >> "$tmp"
done < "$INV"

echo "---"
echo "hosts asked: $hosts, answered: $answered"
echo "distinct poolhash values: $(sort -u "$tmp" | grep -c .)"
sort "$tmp" | uniq -c | sed 's/^/   /' | cut -c1-40
rm -f "$tmp"
