#!/usr/bin/env bash
#
# Ship a node binary to the masternode fleet.
#
# The fleet binary is a separate artefact from the seed's and drifts from it
# silently: both report the same -version string while carrying different
# consensus code. Comparing md5sums is the only way to know what is running,
# so this script does that at every step rather than trusting the version.
#
# Two failures this script exists to prevent, both met in production:
#
#   1. A binary that compiles is not a binary that runs. A build picked up the
#      build host's libminiupnpc and libnatpmp, which the target does not have;
#      it was installed, and the node it replaced would not start. Nothing in
#      the build output said so -- ldd on the target did, in one second. This
#      script runs that check on a real fleet host before installing anywhere.
#
#   2. A rollout that starts is not a rollout that finished. Copying to eight
#      hosts and restarting 88 services has many places to fail quietly, so
#      every host reports back its md5 and how many of its instances came up.
#
# Inventory lives on the jump host, never here: this repository is public and
# the fleet addresses are not. Provide it as one address per line in
# $FLEET_INVENTORY (default /root/fleet-nodes.txt) on the jump host.
#
# Usage:
#   ops/fleet-deploy.sh <defcond> <defcon-cli>          # deploy
#   ops/fleet-deploy.sh --check <defcond> <defcon-cli>  # verify only, install nothing

set -euo pipefail

JUMP="${JUMP_HOST:-devnet-jump}"
NODE_KEY="${FLEET_KEY:-/root/.ssh/defcon_nodes}"
INVENTORY="${FLEET_INVENTORY:-/root/fleet-nodes.txt}"
STAGE="/root/fleet-bin-new"
# Ten masternodes plus instance 11, the staker: a masternode cannot stake
# itself, so block production needs its own daemon per host.
INSTANCES="${FLEET_INSTANCES:-11}"

check_only=0
if [ "${1:-}" = "--check" ]; then check_only=1; shift; fi

DAEMON="${1:?usage: fleet-deploy.sh [--check] <defcond> <defcon-cli>}"
CLI="${2:?usage: fleet-deploy.sh [--check] <defcond> <defcon-cli>}"

for f in "$DAEMON" "$CLI"; do
  [ -f "$f" ] || { echo "not a file: $f" >&2; exit 1; }
done

echo "==> what is being shipped"
LOCAL_MD5=$(md5sum "$DAEMON" | cut -d' ' -f1)
echo "    defcond md5 $LOCAL_MD5"

# The fleet runs Debian without libdb, so its binary must be built --without-bdb.
# Shipping the seed's binary here produces a node that cannot open its wallet.
# grep -a rather than strings: the check has to work wherever this is run from,
# and strings is not everywhere.
if ! grep -aq 'Compiled without bdb support' "$DAEMON"; then
  echo "    REFUSING: this is not a --without-bdb build; the fleet cannot use it" >&2
  exit 1
fi
echo "    --without-bdb: yes"

echo "==> staging on the jump host"
ssh "$JUMP" "mkdir -p $STAGE"
scp -q "$DAEMON" "$JUMP:$STAGE/defcond"
scp -q "$CLI" "$JUMP:$STAGE/defcon-cli"

echo "==> does it run on a fleet host"
# One host, no install. A missing shared library is invisible in the build log
# and fatal on the target.
ssh "$JUMP" "bash -s" <<REMOTE_CHECK
set -euo pipefail
first=\$(head -1 "$INVENTORY")
[ -n "\$first" ] || { echo "empty inventory: $INVENTORY" >&2; exit 1; }
SSH="ssh -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
\$SCP "$STAGE/defcond" "root@\$first:/tmp/fleet-deploy-probe"
\$SSH "root@\$first" 'chmod +x /tmp/fleet-deploy-probe
  missing=\$(ldd /tmp/fleet-deploy-probe 2>/dev/null | grep -c "not found" || true)
  if [ "\$missing" != "0" ]; then
    echo "    REFUSING: \$missing shared librar(ies) missing on the target:"
    ldd /tmp/fleet-deploy-probe | grep "not found"
    rm -f /tmp/fleet-deploy-probe
    exit 1
  fi
  echo "    ldd: nothing missing"
  echo "    runs: \$(/tmp/fleet-deploy-probe -version | head -1)"
  rm -f /tmp/fleet-deploy-probe'
REMOTE_CHECK

if [ "$check_only" = "1" ]; then
  echo "==> --check given, nothing installed"
  exit 0
fi

echo "==> rolling out"
ssh "$JUMP" "bash -s" <<REMOTE_DEPLOY
set -uo pipefail
SSH="ssh -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
failed=0
while read -r ip; do
  [ -n "\$ip" ] || continue
  printf '    %-18s ' "\$ip"
  if ! \$SCP "$STAGE/defcond" "$STAGE/defcon-cli" "root@\$ip:/tmp/" 2>/dev/null; then
    echo "COPY FAILED"; failed=\$((failed+1)); continue
  fi
  out=\$(\$SSH "root@\$ip" 'set -e
    B=/opt/defcon-devnet/bin
    cp -a \$B/defcond \$B/defcond.bak-\$(date +%Y%m%d-%H%M)
    install -m 0755 /tmp/defcond \$B/defcond
    install -m 0755 /tmp/defcon-cli \$B/defcon-cli
    for i in \$(seq 1 '"$INSTANCES"'); do systemctl restart defcon-devnet-mn@\$i || true; done
    sleep 6
    up=0
    for i in \$(seq 1 '"$INSTANCES"'); do
      [ "\$(systemctl is-active defcon-devnet-mn@\$i)" = "active" ] && up=\$((up+1))
    done
    echo "md5=\$(md5sum \$B/defcond | cut -d" " -f1) up=\$up/'"$INSTANCES"'"' 2>/dev/null)
  if [ -z "\$out" ]; then echo "NO RESPONSE"; failed=\$((failed+1)); continue; fi
  echo "\$out"
  case "\$out" in
    md5=$LOCAL_MD5*) ;;
    *) echo "        md5 does not match what was shipped"; failed=\$((failed+1)) ;;
  esac
  case "\$out" in
    *up=$INSTANCES/$INSTANCES) ;;
    *) echo "        not every instance came up"; failed=\$((failed+1)) ;;
  esac
done < "$INVENTORY"
echo "    hosts with a problem: \$failed"
exit \$([ "\$failed" -eq 0 ] && echo 0 || echo 1)
REMOTE_DEPLOY

echo "==> done"
