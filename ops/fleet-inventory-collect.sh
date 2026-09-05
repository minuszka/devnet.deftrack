#!/bin/bash
# Runs ON THE JUMP HOST. Reads every host in /root/fleet-nodes-all.txt and asks
# each one, read-only, what it carries: the binary's sha256, the observer label
# if an observer runs there, and per masternode unit its port, external
# address, role and proTxHash. Output: /root/fleet-manifest-raw.txt, one line
# per unit, fields separated by '|'. Nothing is written on any fleet host.
set -u
KEY=/root/.ssh/defcon_nodes
INV=/root/fleet-nodes-all.txt
OUT=/root/fleet-manifest-raw.txt

read -r -d '' BODY <<'REMOTE' || true
set -u
CLI=/opt/defcon-devnet/bin/defcon-cli
hn=$(hostname)
build=$(sha256sum /opt/defcon-devnet/bin/defcond 2>/dev/null | cut -d' ' -f1)
obs=
if [ -f /etc/devnet-observer.env ]; then
  obs=$(sed -n 's/^OBSERVER_HOST=//p' /etc/devnet-observer.env | head -1)
fi
echo "HOST|$hn|$build|$obs"
for d in /opt/defcon-devnet/mn*; do
  [ -d "$d" ] || continue
  n=${d##*/mn}
  c="$d/defcon.conf"
  [ -f "$c" ] || { echo "UNIT|$n|missing-conf"; continue; }
  port=$(sed -n 's/^port=//p' "$c" | head -1)
  ext=$(sed -n 's/^externalip=//p' "$c" | head -1)
  active=$(systemctl is-active "defcon-devnet-mn@$n" 2>/dev/null)
  if grep -q '^masternodeblsprivkey=' "$c"; then
    role=masternode
    ptx=$($CLI -conf="$c" -datadir="$d" masternode status 2>/dev/null | grep -a '"proTxHash"' | grep -o '[0-9a-f]\{64\}' | head -1)
  else
    role=staker
    ptx=
  fi
  echo "UNIT|$n|$port|$ext|$role|$ptx|$active"
done
REMOTE

BLOB=$(printf '%s' "$BODY" | base64 -w0)
: > "$OUT"
n=0; fail=0
while read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in \#*) continue;; esac
  n=$((n+1))
  ip=${entry#*@}
  if ! ssh -n -i "$KEY" -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no "$entry" \
       "if [ \"\$(id -u)\" = 0 ]; then P=; else P='sudo -n'; fi; echo '$BLOB' | base64 -d | \$P bash -s" \
       | sed "s/^/$ip|/" >> "$OUT"; then
    echo "  [$n] HOST FAILED"; fail=$((fail+1))
  else
    echo "  [$n] ok"
  fi
done < <(grep -v '^#' "$INV" | grep -v '^$')
chmod 600 "$OUT"
echo "hosts=$n failed=$fail lines=$(wc -l < "$OUT")"
echo "masternodes=$(grep -c '|masternode|' "$OUT") stakers=$(grep -c '|staker|' "$OUT") missing-proTx=$(grep '|masternode|' "$OUT" | grep -c '|masternode||')"
[ "$fail" = 0 ]
