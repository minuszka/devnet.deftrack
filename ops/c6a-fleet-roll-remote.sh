#!/bin/sh
#
# Runs ON ONE FLEET HOST, copied there by c6a-fleet-roll.sh.
#
#   usage: c6a-fleet-roll-remote.sh <staged-binary> <new-md5> <old-md5> preflight|apply
#
# The C6a roll changes the binary and nothing else: no conf key. The #231 key
# (dslcommitmentv2height=12744) must STAY in every conf -- a daemon started
# without it would demand format v2 from the first commitment and reject
# history -- so the preflight refuses a host where any conf lacks it.
#
# preflight changes nothing. apply takes the host whole: stop every instance,
# back up, install, start every instance, then prove three things per daemon:
#   running  -- md5 of /proc/<pid>/exe is the new binary (not -version)
#   keyed    -- the #231 key is still in the conf
#   reread   -- the NEW process logged "Setting dslcommitmentv2height to 12744"
#               with a timestamp after this host's stop. The old line is still
#               in the log, so its mere presence proves nothing.
set -u
SRC=${1:?staged binary}
NEW=${2:?new md5}
OLD=${3:?old md5}
MODE=${4:?preflight|apply}
KEYLINE='dslcommitmentv2height=12744'
LOGLINE='Setting dslcommitmentv2height to 12744'

S=""
[ "$(id -u)" != 0 ] && S="sudo -n"
B=/opt/defcon-devnet/bin
DIRS=$($S sh -c 'ls -d /opt/defcon-devnet/mn* 2>/dev/null')
[ -n "$DIRS" ] || { echo "PRE dirs=0"; exit 0; }

total=0; keyed=0
for d in $DIRS; do
  total=$((total + 1))
  $S grep -qx "$KEYLINE" "$d/defcon.conf" && keyed=$((keyed + 1))
done
disk=$($S md5sum $B/defcond 2>/dev/null | cut -d' ' -f1)
staged=$(md5sum "$SRC" 2>/dev/null | cut -d' ' -f1)
echo "PRE daemons=$total keyed=$keyed diskmd5=$disk staged=$staged"
[ "$MODE" = preflight ] && exit 0

if [ "$keyed" != "$total" ] || [ "$disk" != "$OLD" ] || [ "$staged" != "$NEW" ]; then
  echo "APPLY refused: pre-flight is not clean on this host"
  exit 2
fi

# shellcheck disable=SC2001  # DIRS is a multi-line list
IDX=$(echo "$DIRS" | sed 's#.*/mn##' | sort -n)
STAMP=$(date +%Y%m%d-%H%M)
T0=$(date -u +%s)

for i in $IDX; do $S systemctl stop "defcon-devnet-mn@$i"; done
$S cp -a $B/defcond "$B/defcond.bak-$STAMP" || { echo "APPLY backup failed"; exit 3; }
$S install -m 0755 "$SRC" $B/defcond || { echo "APPLY install failed"; exit 3; }
for i in $IDX; do $S systemctl start "defcon-devnet-mn@$i"; done
sleep 12

up=0; ran=0; keyed=0; reread=0
for d in $DIRS; do
  i=${d##*/mn}
  [ "$($S systemctl is-active "defcon-devnet-mn@$i")" = active ] && up=$((up + 1))
  pid=$($S systemctl show -p MainPID --value "defcon-devnet-mn@$i")
  [ "$($S md5sum "/proc/$pid/exe" 2>/dev/null | cut -d' ' -f1)" = "$NEW" ] && ran=$((ran + 1))
  $S grep -qx "$KEYLINE" "$d/defcon.conf" && keyed=$((keyed + 1))
  ts=$($S grep "$LOGLINE" "$d/devnet-defcon-q60/debug.log" 2>/dev/null | tail -1 | cut -d' ' -f1)
  if [ -n "$ts" ] && [ "$(date -u -d "$ts" +%s 2>/dev/null || echo 0)" -ge "$T0" ]; then
    reread=$((reread + 1))
  else
    echo "  NOREREAD mn$i last=$ts"
  fi
done
$S rm -f "$SRC"
echo "POST up=$up/$total running-new=$ran/$total keyed=$keyed/$total reread=$reread/$total diskmd5=$($S md5sum $B/defcond | cut -d' ' -f1)"
[ "$up" = "$total" ] && [ "$ran" = "$total" ] && [ "$keyed" = "$total" ] && [ "$reread" = "$total" ] || exit 4
exit 0
