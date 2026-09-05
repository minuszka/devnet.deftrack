#!/usr/bin/env bash
#
# Put `dslenforcementheight=<H>` into the [devnet] section of every conf on the
# devnet: 152 masternodes across 16 hosts, plus the seed and devnet2.
#
# THIS IS CONSENSUS. `IsBanned()` reads `nDSLBanHeight` (`dmnstate.h:454`) and
# `fRewardSuspended` changes payee selection, so a daemon started without the
# argument disagrees with the rest about what is valid and forks. The same
# mechanism as `dslactivationheight`, which has already stranded a node on this
# project once.
#
# Which is why this defaults to the SIXTEEN-host inventory and not the eleven-
# host one. `ops/fleet-deploy.sh` defaults to /root/fleet-nodes.txt, the 11
# hosts that log in as root -- 107 of the 152 masternodes. The other five hosts
# carry 45 and log in as their own unprivileged users. Rolling a consensus
# argument to the eleven would fork exactly those 45. /root/fleet-nodes-all.txt
# holds all sixteen, the eleven being a strict subset of it.
#
# Four modes, deliberately separate so that writing and restarting are two
# decisions rather than one:
#
#   --check   <H>   report what would change everywhere. Writes nothing.
#   --write   <H>   write the confs, backing each one up. Restarts nothing.
#   --restart       restart every instance, and report what came back.
#   --verify  <H>   every conf answers with H, and the network still agrees.
#
# Run --check first and read the totals. The conf count it reports must be the
# number you expect -- 152 masternodes plus the stakers -- because a host that
# answers with fewer confs than it runs units is the failure this exists to
# catch, and it is silent otherwise.
#
# The remote half travels base64-encoded rather than through nested heredocs:
# this has to pass intact through two ssh hops and a sudo, and quoting is where
# that goes wrong silently.

set -euo pipefail

JUMP="${JUMP_HOST:-devnet-jump}"
SEED="${SEED_HOST:-devnet}"
NODE_KEY="${FLEET_KEY:-/root/.ssh/defcon_nodes}"
INVENTORY="${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}"
CONF_GLOB='/opt/defcon-devnet/mn*/defcon.conf'
SEED_CONFS='/home/defcon/.defcon/defcon.conf /home/defcon/.defcon2/defcon.conf'
SEED_CLI='sudo -n defcon-cli -conf=/home/defcon/.defcon/defcon.conf -datadir=/home/defcon/.defcon'
FLEET_CLI='/opt/defcon-devnet/bin/defcon-cli'
SEED_BIN_CLI='defcon-cli'

mode="${1:?usage: fleet-dsl-enforcement.sh --check|--write|--restart|--verify [height]}"
H="${2:-}"

case "$mode" in
  --check|--write|--verify)
    [ -n "$H" ] || { echo "$mode needs a height"; exit 2; }
    case "$H" in (*[!0-9]*|'') echo "height must be a number"; exit 2;; esac
    # Epoch boundaries are exactly the multiples of 24.
    [ $((H % 24)) -eq 0 ] || { echo "height $H is not a multiple of 24"; exit 2; }
    ;;
  --restart) ;;
  *) echo "unknown mode $mode"; exit 2;;
esac

# ---------------------------------------------------------------- remote half
#
# Per conf, in order, refusing rather than guessing:
#   - a [devnet] section must exist        -- nothing else is devnet
#   - dslactivationheight must be present  -- the node refuses enforcement
#                                             without the protocol running, so
#                                             a conf lacking it cannot take H
#   - H must not be below it               -- same rule, checked here so the
#                                             failure is legible instead of a
#                                             daemon that will not start
# The line goes immediately after dslactivationheight, which is inside [devnet]
# by construction. Appending to the end of the file would put it in whichever
# section happens to be last.
read -r -d '' CONF_BODY <<'REMOTE' || true
set -u
# MODE, H and PATTERN arrive as a prelude prepended to this script, not as
# arguments: the glob must be expanded HERE, by the privileged shell. Expanded
# before sudo it is expanded as the login user, who on five of the sixteen hosts
# cannot read /opt/defcon-devnet at all -- the pattern then matches nothing, and
# the run reports confs=0 for 45 masternodes instead of failing. Measured.
ok=0; skip=0; bad=0; seen=0
for c in $PATTERN; do
  [ -f "$c" ] || continue
  seen=$((seen+1))
  if ! grep -q '^\[devnet\]' "$c"; then echo "    BAD  $c: no [devnet] section"; bad=$((bad+1)); continue; fi
  act=$(sed -n 's/^dslactivationheight=\([0-9]*\).*/\1/p' "$c" | head -1)
  if [ -z "$act" ]; then echo "    BAD  $c: no dslactivationheight"; bad=$((bad+1)); continue; fi
  if [ "$H" -lt "$act" ]; then echo "    BAD  $c: H=$H below dslactivationheight=$act"; bad=$((bad+1)); continue; fi
  cur=$(sed -n 's/^dslenforcementheight=\([0-9]*\).*/\1/p' "$c" | head -1)
  if [ "$cur" = "$H" ]; then skip=$((skip+1)); continue; fi
  if [ "$MODE" = "check" ]; then
    if [ -n "$cur" ]; then echo "    would change $c: $cur -> $H"; else echo "    would add    $c"; fi
    ok=$((ok+1)); continue
  fi
  cp -p "$c" "$c.bak-$(date +%s)"
  if [ -n "$cur" ]; then
    sed -i "s/^dslenforcementheight=.*/dslenforcementheight=$H/" "$c"
  else
    sed -i "/^dslactivationheight=/a dslenforcementheight=$H" "$c"
  fi
  # Read it back rather than trusting sed's exit code.
  got=$(sed -n 's/^dslenforcementheight=\([0-9]*\).*/\1/p' "$c" | head -1)
  if [ "$got" = "$H" ]; then ok=$((ok+1)); else echo "    FAILED $c: wrote $H, read back '$got'"; bad=$((bad+1)); fi
done
echo "    confs=$seen changed=$ok already=$skip refused=$bad"
[ "$bad" = 0 ]
REMOTE

# Two checks, and the second is the one that matters.
#
# The conf is the INPUT. Reading it back proves the file was written, and
# nothing more -- a conf is not proof that the daemon read it, and until the
# daemons are restarted every one of them is still running on its old
# configuration while the file on disk already says otherwise.
#
# dslstatus.enforcementheight is the STATE: what the running daemon actually
# holds. That field exists because nothing observable on the chain can separate
# a daemon that took the height from one that did not -- below it, and above it
# while nobody is delinquent, the two behave identically, and by the time they
# diverge the split has already happened.
#
# Three outcomes are kept apart because they mean different things: holding H,
# holding something else (conf written, daemon not yet restarted), and unable to
# answer at all (a binary older than the field).
read -r -d '' VERIFY_BODY <<'REMOTE' || true
set -u
# H, PATTERN and CLI arrive as a prelude; see the note in CONF_BODY about why
# the glob is expanded here and not before sudo.
seen=0; conf_ok=0; rpc_ok=0; rpc_silent=0; rpc_other=0
for c in $PATTERN; do
  [ -f "$c" ] || continue
  seen=$((seen+1))
  grep -q "^dslenforcementheight=$H\$" "$c" && conf_ok=$((conf_ok+1))
  d=$(dirname "$c")
  got=$($CLI -conf="$c" -datadir="$d" dslstatus 2>/dev/null         | sed -n 's/.*"enforcementheight" *: *\([0-9]*\).*//p' | head -1)
  if [ -z "$got" ]; then
    rpc_silent=$((rpc_silent+1))
  elif [ "$got" = "$H" ]; then
    rpc_ok=$((rpc_ok+1))
  else
    echo "    HOLDS $got, not $H: $d"
    rpc_other=$((rpc_other+1))
  fi
done
echo "    instances=$seen conf=$conf_ok daemon=$rpc_ok stale=$rpc_other cannot-answer=$rpc_silent"
[ "$seen" = "$conf_ok" ] && [ "$seen" = "$rpc_ok" ]
REMOTE

read -r -d '' RESTART_BODY <<'REMOTE' || true
set -u
# Each host is asked what it has and judged against its own answer: the instance
# count is a property of the host, not of the fleet, and assuming a uniform
# count once started units with no datadir and then reported those hosts failed.
units=$(systemctl list-units 'defcon-devnet-mn@*' --all --no-legend | awk '{print $1}')
c=$(echo "$units" | grep -c . || true)
[ "$c" = 0 ] && { echo "    no instances on this host"; exit 0; }
systemctl restart $units
sleep 8
up=$(systemctl list-units 'defcon-devnet-mn@*' --state=active --no-legend | grep -c . || true)
echo "    instances=$c active=$up"
[ "$up" = "$c" ]
REMOTE

# Send one script to every fleet host, through the jump host, base64-encoded.
#   $1 = base64 blob   $2.. = arguments the remote script receives
fleet_run() {
  local blob="$1"; shift
  ssh -o ConnectTimeout=20 -o BatchMode=yes "$JUMP" \
      "BLOB='$blob' KEY='$NODE_KEY' INV='$INVENTORY' bash -s" <<'JUMPSCRIPT'
set -u
n=0; fail=0
while read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in \#*) continue;; esac
  n=$((n+1))
  echo "  [$n] ${entry#*@}"
  # Privilege is decided on the host, not here. One of the sixteen logs in as
  # root and has NO sudo binary at all, so an unconditional `sudo -n` fails
  # there with "command not found" -- which reads as an access problem and is
  # not one.
  #
  # -n is load-bearing: without it this ssh reads the inventory feed as its own
  # stdin, the loop sees EOF after the first host, and the run reports success
  # having touched one host of sixteen. Measured -- it did exactly that.
  if ! ssh -n -i "$KEY" -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no "$entry" \
       "if [ \"\$(id -u)\" = 0 ]; then P=; else P='sudo -n'; fi; echo '$BLOB' | base64 -d | \$P bash -s"; then
    echo "    HOST FAILED"; fail=$((fail+1))
  fi
done < <(grep -v '^#' "$INV" | grep -v '^$')
echo "  hosts=$n failed=$fail"
[ "$fail" = 0 ]
JUMPSCRIPT
}

seed_run() {
  local blob="$1"; shift
  ssh -o ConnectTimeout=20 -o BatchMode=yes "$SEED" \
      "if [ \"\$(id -u)\" = 0 ]; then P=; else P='sudo -n'; fi; echo '$blob' | base64 -d | \$P bash -s"
}

b64() { printf '%s' "$1" | base64 -w0; }

# ------------------------------------------------------------------ the modes
case "$mode" in
--check|--write)
  # A gate already in the past is worse than none: every node that takes it
  # flips the moment it starts, so a roll that is not instantaneous leaves the
  # fleet resolving two different rules with no synchronised moment at all.
  # 6336 went stale exactly that way while a rollout waited on host access.
  tip=$(ssh -o ConnectTimeout=15 -o BatchMode=yes "$SEED" "$SEED_CLI getblockcount" | tr -d '\r')
  if [ -n "$tip" ] && [ "$H" -le "$tip" ]; then
    echo "REFUSING: height $H is at or below the tip $tip -- the gate would be in the past"
    exit 1
  fi
  echo "==> tip $tip, target $H ($((H - tip)) blocks ahead, roughly $(( (H - tip) * 162 / 60 )) minutes)"
  what=check; [ "$mode" = "--write" ] && what=write
  # Neither half may abort the other. Under `set -e` a failing fleet exits
  # before the seed is even looked at, and the run then reports a total that
  # silently omits the two nodes a reader would least expect to be missing --
  # measured: a verify run reported 160 instances on a network of 162.
  rc=0
  echo "==> fleet ($INVENTORY)"
  fleet_run "$(b64 "MODE=$what; H=$H; PATTERN='$CONF_GLOB'
$CONF_BODY")" || rc=1
  echo "==> seed and devnet2"
  seed_run "$(b64 "MODE=$what; H=$H; PATTERN='$SEED_CONFS'
$CONF_BODY")" || rc=1
  echo
  if [ "$mode" = "--write" ]; then
    echo "==> written. NOTHING HAS BEEN RESTARTED -- every running daemon still holds"
    echo "    its old configuration, and the height is not in force until they do."
  fi
  exit $rc
  ;;

--restart)
  rc=0
  echo "==> restarting the fleet"
  fleet_run "$(b64 "$RESTART_BODY")" || rc=1
  echo "==> restarting the seed and devnet2"
  ssh -o ConnectTimeout=20 -o BatchMode=yes "$SEED" \
    'sudo -n systemctl restart defcond-devnet defcond-devnet2; sleep 8; systemctl is-active defcond-devnet defcond-devnet2' || rc=1
  exit $rc
  ;;

--verify)
  echo "==> every conf carries $H, and every daemon holds it"
  rc=0
  fleet_run "$(b64 "H=$H; PATTERN='$CONF_GLOB'; CLI='$FLEET_CLI'
$VERIFY_BODY")" || rc=1
  echo "==> seed and devnet2"
  seed_run "$(b64 "H=$H; PATTERN='$SEED_CONFS'; CLI='$SEED_BIN_CLI'
$VERIFY_BODY")" || rc=1
  echo "==> and the network still agrees"
  ssh -o ConnectTimeout=20 -o BatchMode=yes "$SEED" "$SEED_CLI getblockcount; $SEED_CLI masternode count"
  echo
  echo "    A conf count is not a fork check. Run ops/fleet-chain-check2.sh on the"
  echo "    jump host as well: one active chain across every instance is the only"
  echo "    thing that proves nobody was left behind."
  exit $rc
  ;;
esac
