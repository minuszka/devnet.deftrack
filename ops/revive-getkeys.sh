#!/bin/sh
# Runs ON THE JUMP HOST. Extract the operator keys of the masternodes that are
# PoSe-banned ON CHAIN right now, and of nothing else.
#
# The host is resolved here rather than passed in: a fleet node is asked for the
# deterministic masternode list, the banned entries' service addresses are read
# out of it, and those addresses are matched against this machine's inventory to
# find the login. So no address and no key crosses any other machine.
#
# Prints only "port secret" lines to stdout, so it can be piped straight into
# the node that must sign with them. With --count it prints how many matched and
# the secret length, revealing nothing.
set -u
K=/root/.ssh/defcon_nodes
INV=/root/fleet-nodes-all.txt
SSH="ssh -n -i $K -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=20"
# WITHOUT -n, for the calls where stdin IS the payload: -n points stdin at
# /dev/null, so `sudo -n bash -s` would run an empty script and print nothing.
# This exact trap has bitten this project before; -n is right only in a loop
# that reads an inventory on stdin.
SSH_IN="ssh -i $K -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=20"

# A fleet node that can answer for the chain: the first inventory entry.
first=$(grep -vE '^[[:space:]]*(#|$)' "$INV" | head -1)
case "$first" in *@*) ;; *) first="root@$first" ;; esac

# shellcheck disable=SC2016  # single quotes are the point: this block is
  # evaluated by the REMOTE shell, so $S, $C and $(id -u) must cross the wire
  # unexpanded. Expanding them here would send this machine's empty values.
list=$($SSH "$first" 'S=""; [ "$(id -u)" != "0" ] && S="sudo -n"; $S /opt/defcon-devnet/bin/defcon-cli -datadir=/opt/defcon-devnet/mn1 protx list registered 1 2>/dev/null')
[ -n "$list" ] || { echo "could not read the masternode list" >&2; exit 1; }

banned=$(printf '%s' "$list" | jq -r '.[] | select(.state.PoSeBanHeight != -1) | .state.service')
[ -n "$banned" ] || { echo "no masternode is PoSe-banned on chain" >&2; exit 1; }

if [ "${1:-}" = "--count" ]; then
  printf 'banned on chain: %s\n' "$(printf '%s\n' "$banned" | grep -c .)"
fi

# Group the banned services by host address, so each host is visited once.
addrs=$(printf '%s\n' "$banned" | sed 's/:.*//' | sort -u)
total=0
for a in $addrs; do
  entry=$(grep -E "(^|@)$a([[:space:]]|$)" "$INV" | head -1 | tr -d ' ')
  [ -n "$entry" ] || { echo "address not in the inventory" >&2; continue; }
  case "$entry" in *@*) t="$entry" ;; *) t="root@$entry" ;; esac
  ports=$(printf '%s\n' "$banned" | grep "^$a:" | sed 's/.*://' | sort -u)
  pat=$(printf '%s' "$ports" | tr '\n' '|' | sed 's/|$//')
  out=$($SSH_IN "$t" 'sudo -n bash -s' < /root/extract-keys.sh 2>/dev/null | grep -E "^($pat) ")
  n=$(printf '%s' "$out" | grep -c .)
  total=$((total + n))
  if [ "${1:-}" = "--count" ]; then
    printf 'host %s: ports wanted %s, keys matched %s, secret lengths %s\n' \
      "$(printf '%s' "$a" | sed 's/\.[0-9]*$/.x/')" \
      "$(printf '%s' "$ports" | tr '\n' ',' | sed 's/,$//')" "$n" \
      "$(printf '%s\n' "$out" | awk 'NF==2 {printf "%s ", length($2)}')"
  else
    printf '%s\n' "$out"
  fi
done
if [ "${1:-}" = "--count" ]; then
  printf 'total keys that would be piped: %s\n' "$total"
fi
