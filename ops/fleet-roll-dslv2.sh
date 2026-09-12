#!/bin/bash
#
# The #231 roll: the DSL commitment format v2 binary AND its activation height,
# moved together, on the 16 fleet hosts. Runs ON THE JUMP HOST.
#
# Why this is not ops/fleet-deploy.sh with an extra step. That script installs
# the binary and restarts immediately, which is exactly the order this roll must
# not use. The two failure modes are not equal:
#
#   key present, old binary  -> the daemon REFUSES TO START ("Invalid
#                               configuration value", util/system.cpp:951) and
#                               Restart=on-failure loops it. Loud, and it ends
#                               the moment the binary lands.
#   new binary, key absent   -> the daemon STARTS, demands format v2 from the
#                               first commitment (nDSLCommitmentV2Height
#                               defaults to 0) and rejects the next v1 one.
#                               Silent, and it forks that host off at the next
#                               epoch boundary.
#
# So each host goes stop -> install -> write key -> start, and Restart=on-failure
# is never given a window in which it can reach either state. The work itself is
# in fleet-roll-dslv2-remote.sh, shipped as a file: it edits every conf on the
# host, and a quoting bug three levels deep inside an ssh argument would write a
# wrong file without saying so.
#
# Usage, on the jump host:
#   ./fleet-roll-dslv2.sh --check <staged-defcond>   # measure only, change nothing
#   ./fleet-roll-dslv2.sh <staged-defcond>           # measure, then roll
#
# The staged binary must be the fleet artefact (--without-bdb). The seed and
# devnet2 are NOT here: they live on the explorer VPS and take
# ops/seed-roll-dslv2.sh, and devnet2 needs this same artefact under the name
# defcond-nobdb.
set -uo pipefail

H=12744                       # the activation height, decided 2026-09-11
EXPECT_MD5=455d516e2138dd81bdc58ba86c8b5c97
KEY=/root/.ssh/defcon_nodes
INVENTORY=${FLEET_INVENTORY:-/root/fleet-nodes-all.txt}
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REMOTE=$HERE/fleet-roll-dslv2-remote.sh

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; shift; fi
DAEMON=${1:?usage: fleet-roll-dslv2.sh [--check] <staged-defcond>}

[ -f "$DAEMON" ] || { echo "no such file: $DAEMON"; exit 1; }
[ -f "$REMOTE" ] || { echo "missing helper: $REMOTE"; exit 1; }
LOCAL_MD5=$(md5sum "$DAEMON" | cut -d' ' -f1)
echo "==> staged defcond md5 $LOCAL_MD5"
if [ "$LOCAL_MD5" != "$EXPECT_MD5" ]; then
  echo "    REFUSING: this is not the artefact this script was written for ($EXPECT_MD5)."
  echo "    If the roll ships a different build, change EXPECT_MD5 deliberately."
  exit 1
fi
echo "==> activation height $H, inventory $INVENTORY"
echo

SSH="ssh -n -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -i $KEY -o ConnectTimeout=20 -o BatchMode=yes -o StrictHostKeyChecking=no"

ok=0; skipped=0; failed=0

while read -r entry; do
  case "$entry" in ""|\#*) continue ;; esac
  case "$entry" in *@*) target="$entry" ;; *) target="root@$entry" ;; esac
  echo "=== $entry"

  $SCP "$REMOTE" "$target:/tmp/roll-dslv2.sh" || { echo "  FAIL: helper copy"; failed=$((failed+1)); continue; }

  pre=$($SSH "$target" "sh /tmp/roll-dslv2.sh $H /tmp/defcond-dslv2 preflight" 2>&1)
  echo "  $pre"
  case "$pre" in
    *"confs=0"*|*"dirs=0"*) echo "  SKIP: no instance directory readable here"; skipped=$((skipped+1)); continue ;;
  esac
  echo "$pre" | grep -q 'nodevnet=0' || {
    echo "  SKIP: a conf has no [devnet] section -- the key would be read for the wrong network"
    skipped=$((skipped+1)); continue; }
  echo "$pre" | grep -q 'haskey=0' || {
    echo "  SKIP: a conf already carries dslcommitmentv2height -- report it, do not overwrite"
    skipped=$((skipped+1)); continue; }

  if [ "$CHECK_ONLY" = 1 ]; then ok=$((ok+1)); echo; continue; fi

  # ops/fleet-roll-dslv2-stage.sh may have put the binary here already, outside
  # the window. Trust the host's own md5 for that, never the file's presence.
  have=$($SSH "$target" "md5sum /tmp/defcond-dslv2 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
  if [ "$have" = "$LOCAL_MD5" ]; then
    echo "  binary already staged here, md5 verified on the host"
  else
    $SCP "$DAEMON" "$target:/tmp/defcond-dslv2" || { echo "  FAIL: binary copy"; failed=$((failed+1)); continue; }
  fi
  out=$($SSH "$target" "sh /tmp/roll-dslv2.sh $H /tmp/defcond-dslv2 apply; echo rc=\$?" 2>&1)
  echo "$out" | awk '{print "  " $0}'

  if echo "$out" | grep -q 'rc=0' && echo "$out" | grep -q "diskmd5=$LOCAL_MD5"; then
    ok=$((ok+1))
  else
    echo "  FAIL: this host did not come back whole -- stop and look before continuing"
    failed=$((failed+1))
  fi
  echo
done < "$INVENTORY"

echo "==> hosts ok=$ok skipped=$skipped failed=$failed"
echo "    The real checkpoint is the FIRST epoch boundary after the roll, not H:"
echo "    a daemon that took the binary without the key rejects the next v1"
echo "    commitment there. Watch it within the hour."
[ "$failed" = 0 ] || exit 1
