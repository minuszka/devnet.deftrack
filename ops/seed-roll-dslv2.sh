#!/bin/bash
#
# The #231 roll on the explorer VPS: the seed and devnet2. Runs ON THE VPS as
# root. The fleet is ops/fleet-roll-dslv2.sh; this is the half that every
# earlier roll got wrong.
#
# devnet2 is the trap. It sits on the same machine as the seed but executes
# /usr/local/bin/defcond-nobdb -- the FLEET artefact under another name -- so
# installing the seed binary updates the seed and leaves devnet2 on whatever it
# had. On 2026-09-05 it was three PRs behind and a conf-only check called that
# roll complete.
#
# Same order as the fleet, for the same reason: stop -> install -> write the key
# -> start. The key on the old binary is a startup failure; the new binary
# without the key forks at the next commitment.
#
# Two takes two binaries:
#   seed     /usr/local/bin/defcond         BDB build
#   devnet2  /usr/local/bin/defcond-nobdb   the fleet (--without-bdb) build
#
# Usage:
#   ./seed-roll-dslv2.sh --check <seed-defcond> <fleet-defcond>
#   ./seed-roll-dslv2.sh         <seed-defcond> <fleet-defcond>
#
# The explorer reads the seed's RPC, so its sync ticks fail while this runs.
# That is expected and recovers on its own; it is not a reason to hurry.
set -uo pipefail

H=12744
EXPECT_SEED=83409a08d881153f673cf0033db5f5c6
EXPECT_FLEET=455d516e2138dd81bdc58ba86c8b5c97

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; shift; fi
SEED_BIN=${1:?usage: seed-roll-dslv2.sh [--check] <seed-defcond> <fleet-defcond>}
FLEET_BIN=${2:?usage: seed-roll-dslv2.sh [--check] <seed-defcond> <fleet-defcond>}

for pair in "$SEED_BIN:$EXPECT_SEED" "$FLEET_BIN:$EXPECT_FLEET"; do
  f=${pair%:*}; want=${pair##*:}
  [ -f "$f" ] || { echo "no such file: $f"; exit 1; }
  got=$(md5sum "$f" | cut -d' ' -f1)
  echo "==> $f  md5 $got"
  [ "$got" = "$want" ] || { echo "    REFUSING: expected $want -- the two artefacts are not interchangeable"; exit 1; }
done
echo "==> activation height $H"
echo

# unit | binary | datadir
NODES=(
  "defcond-devnet.service|/usr/local/bin/defcond|/home/defcon/.defcon|$SEED_BIN"
  "defcond-devnet2.service|/usr/local/bin/defcond-nobdb|/home/defcon/.defcon2|$FLEET_BIN"
)

# ---- pre-flight, changes nothing
for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src <<<"$row"
  echo "=== $unit"
  echo "    executes:   $(grep -h '^ExecStart=' "/etc/systemd/system/$unit" | head -1 | sed 's/^ExecStart=//' | awk '{print $1}')"
  echo "    on disk:    $bin  md5 $(md5sum "$bin" 2>/dev/null | cut -d' ' -f1)"
  echo "    conf:       $dir/defcon.conf"
  grep -q '^\[devnet\]' "$dir/defcon.conf" || { echo "    REFUSING: no [devnet] section"; exit 1; }
  if grep -qi 'dslcommitmentv2height' "$dir/defcon.conf"; then
    echo "    REFUSING: the conf already carries dslcommitmentv2height -- report it, do not overwrite"
    exit 1
  fi
  echo "    will take:  $(md5sum "$src" | cut -d' ' -f1)"
done
echo

if [ "$CHECK_ONLY" = 1 ]; then echo "==> --check given, nothing changed"; exit 0; fi

# ---- apply
stamp=$(date +%Y%m%d-%H%M)
for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src <<<"$row"
  systemctl stop "$unit"
done

for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src <<<"$row"
  cp -a "$bin" "$bin.bak-$stamp"
  install -m 0755 "$src" "$bin"
  c=$dir/defcon.conf
  cp -a "$c" "$c.bak-$stamp"
  # the same line the fleet runs, and the one the fixture test exercises:
  # anchored to the section header, so the key is read for devnet and not for
  # whatever section happens to be last in the file
  sed -i "/^\[devnet\]/a dslcommitmentv2height=$H" "$c"
done

for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src <<<"$row"
  systemctl start "$unit"
done
sleep 10

# ---- verify
rc=0
for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src <<<"$row"
  active=$(systemctl is-active "$unit")
  pid=$(systemctl show -p MainPID --value "$unit")
  running=$(md5sum "/proc/$pid/exe" 2>/dev/null | cut -d' ' -f1)
  logged=$(grep -c "Setting dslcommitmentv2height to $H" "$dir/devnet-defcon-q60/debug.log" 2>/dev/null)
  echo "=== $unit  active=$active running-md5=$running logged=$logged"
  [ "$active" = active ] || rc=1
  [ "$running" = "$(md5sum "$src" | cut -d' ' -f1)" ] || { echo "    the running process is not the new binary"; rc=1; }
  [ "${logged:-0}" -ge 1 ] || { echo "    the startup log does not name the height -- the key did not take"; rc=1; }
done

echo
echo "==> the real checkpoint is the FIRST epoch boundary after the roll, not H."
exit $rc
