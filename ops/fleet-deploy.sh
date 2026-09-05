#!/usr/bin/env bash
#
# Ship a node binary to the masternode fleet.
#
# The fleet binary is a separate artefact from the seed's and drifts from it
# silently: both report the same -version string while carrying different
# consensus code. Comparing md5sums is the only way to know what is running,
# so this script does that at every step rather than trusting the version.
#
# Three failures this script exists to prevent, all met in production:
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
#   3. A fleet is not uniform. The count of instances was assumed to be the same
#      everywhere; it is not, and on the hosts that carry fewer the script
#      started units with no datadir, left them in systemd's auto-restart loop,
#      and then reported those hosts as failed rollouts. Each host is now asked
#      what it has, and judged against its own answer.
#
#   4. Nor is the login uniform. Five hosts carrying 45 of the 152 masternodes
#      log in as their own unprivileged users, not root. Testing only root
#      against them returned "Permission denied (publickey)" on every one, and
#      that was read as "no key exists for these hosts" -- from which followed a
#      declaration that 45 masternodes were unreachable and a gated consensus
#      rollout was blocked. All of it was wrong, and all of it came from one
#      wrong username. So the inventory carries the user, and anything
#      privileged goes through sudo.
#
# Inventory lives on the jump host, never here: this repository is public and
# the fleet addresses are not. Provide it in $FLEET_INVENTORY (default
# /root/fleet-nodes.txt) on the jump host, one entry per line:
#
#   198.51.100.10            # logs in as root
#   deploy@198.51.100.11     # logs in as deploy, and sudos for the install
#
# Blank lines and # comments are skipped. A bare address still means root, so
# an inventory written before this change keeps working unchanged.
#
# Usage:
#   ops/fleet-deploy.sh <defcond> <defcon-cli>          # deploy
#   ops/fleet-deploy.sh --check <defcond> <defcon-cli>  # verify only, install nothing

set -euo pipefail

JUMP="${JUMP_HOST:-devnet-jump}"
NODE_KEY="${FLEET_KEY:-/root/.ssh/defcon_nodes}"
INVENTORY="${FLEET_INVENTORY:-/root/fleet-nodes.txt}"
STAGE="/root/fleet-bin-new"
# How many instances a host runs is a property of that host, not of the fleet.
# Most carry ten masternodes plus instance 11, the staker -- a masternode cannot
# stake itself, so block production needs its own daemon -- but hosts added
# later carry nine. Assuming eleven everywhere restarted two units that have no
# datadir on those hosts, which then sat in systemd's auto-restart loop, and
# then failed the host for not running them: a false alarm and a real mess, from
# the same wrong number.
#
# So each host is asked what it has. FLEET_INSTANCES still forces a count, for a
# host being set up before its datadirs exist.
INSTANCES="${FLEET_INSTANCES:-}"

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
# Client-side expansion, deliberately: $STAGE is this script's own path and
# the jump host has no such variable.
# shellcheck disable=SC2029
ssh "$JUMP" "mkdir -p $STAGE"
scp -q "$DAEMON" "$JUMP:$STAGE/defcond"
scp -q "$CLI" "$JUMP:$STAGE/defcon-cli"

echo "==> does it run on a fleet host"
# One host, no install. A missing shared library is invisible in the build log
# and fatal on the target.
# The heredoc is UNQUOTED on purpose, and the two kinds of variable are kept
# apart by hand: $INVENTORY, $NODE_KEY and $STAGE are expanded here, because
# they are this machine's knowledge of the fleet; everything the jump host
# must evaluate for itself is escaped (\$first, \$SSH, \$missing). Quoting the
# delimiter would send the local paths across as literals and the rollout
# would look for an inventory that does not exist there.
# shellcheck disable=SC2087
ssh "$JUMP" "bash -s" <<REMOTE_CHECK
set -euo pipefail
first=\$(grep -v '^[[:space:]]*\(#\|$\)' "$INVENTORY" | head -1)
[ -n "\$first" ] || { echo "empty inventory: $INVENTORY" >&2; exit 1; }
case "\$first" in *@*) ;; *) first="root@\$first" ;; esac
SSH="ssh -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
\$SCP "$STAGE/defcond" "\$first:/tmp/fleet-deploy-probe"
\$SSH "\$first" 'chmod +x /tmp/fleet-deploy-probe
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
# The heredoc is UNQUOTED on purpose, and the two kinds of variable are kept
# apart by hand: $INVENTORY, $NODE_KEY and $STAGE are expanded here, because
# they are this machine's knowledge of the fleet; everything the jump host
# must evaluate for itself is escaped (\$first, \$SSH, \$missing). Quoting the
# delimiter would send the local paths across as literals and the rollout
# would look for an inventory that does not exist there.
# shellcheck disable=SC2087
ssh "$JUMP" "bash -s" <<REMOTE_DEPLOY
set -uo pipefail
# -n: without it ssh reads the loop's stdin and swallows the rest of the
# inventory, so the rollout silently visits one host and reports success.
SSH="ssh -n -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $NODE_KEY -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=no"
failed=0
while read -r entry; do
  case "\$entry" in ""|\#*) continue ;; esac
  case "\$entry" in *@*) target="\$entry" ;; *) target="root@\$entry" ;; esac
  printf '    %-30s ' "\$target"
  if ! \$SCP "$STAGE/defcond" "$STAGE/defcon-cli" "\$target:/tmp/" 2>/dev/null; then
    echo "COPY FAILED"; failed=\$((failed+1)); continue
  fi
  out=\$(\$SSH "\$target" 'set -e
    B=/opt/defcon-devnet/bin
    # Not every host logs in as root. Anything that writes into the binary
    # directory or drives systemd therefore goes through sudo, and -n makes a
    # host that would prompt fail here and now rather than hang the whole
    # rollout on a password it will never be given.
    S=""
    if [ "\$(id -u)" != "0" ]; then
      S="sudo -n"
      \$S true 2>/dev/null || { echo "NO PASSWORDLESS SUDO"; exit 1; }
    fi
    # The instances this host actually has. Read from the datadirs rather than
    # assumed, and filtered to numbers so a stray directory cannot become a unit
    # name that never comes up and fails the host.
    forced="'"$INSTANCES"'"
    idx=""
    if [ -n "\$forced" ]; then
      idx=\$(seq 1 "\$forced")
    else
      for d in /opt/defcon-devnet/mn*; do
        n=\${d##*/mn}
        case "\$n" in ""|*[!0-9]*) continue ;; esac
        idx="\$idx \$n"
      done
    fi
    total=\$(echo \$idx | wc -w)
    [ "\$total" -gt 0 ] || { echo "NO INSTANCES FOUND"; exit 1; }
    \$S cp -a \$B/defcond \$B/defcond.bak-\$(date +%Y%m%d-%H%M)
    \$S install -m 0755 /tmp/defcond \$B/defcond
    \$S install -m 0755 /tmp/defcon-cli \$B/defcon-cli
    for i in \$idx; do \$S systemctl restart defcon-devnet-mn@\$i || true; done
    sleep 6
    up=0
    for i in \$idx; do
      [ "\$(systemctl is-active defcon-devnet-mn@\$i)" = "active" ] && up=\$((up+1))
    done
    echo "md5=\$(md5sum \$B/defcond | cut -d" " -f1) up=\$up/\$total"' 2>/dev/null)
  if [ -z "\$out" ]; then echo "NO RESPONSE"; failed=\$((failed+1)); continue; fi
  echo "\$out"
  case "\$out" in
    md5=$LOCAL_MD5*) ;;
    *) echo "        md5 does not match what was shipped"; failed=\$((failed+1)) ;;
  esac
  ups=\${out##*up=}
  if [ "\${ups%%/*}" != "\${ups##*/}" ]; then
    echo "        not every instance came up"; failed=\$((failed+1))
  fi
done < "$INVENTORY"
echo "    hosts with a problem: \$failed"
exit \$([ "\$failed" -eq 0 ] && echo 0 || echo 1)
REMOTE_DEPLOY

echo "==> done"
