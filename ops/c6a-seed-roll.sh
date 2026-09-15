#!/bin/bash
#
# The C6a roll (#241-#243, merged v22.1.x ddf2822011) on the explorer VPS: the
# seed and devnet2, the canary before the fleet. Runs ON THE VPS as root.
#
# #243 is a devnet consensus change at height 13536: llmq_50_60 and llmq_60_75
# form no new quorum from there. Every devnet daemon must run this binary before
# 13536; an old one past it forks off. No conf key changes: the #231 key
# (dslcommitmentv2height=12744) stays in both confs, and this roll moves only the
# binary.
#
# devnet2 executes /usr/local/bin/defcond-nobdb -- the FLEET artefact under
# another name -- and every roll before #231 missed it.
#
#   ./c6a-seed-roll.sh --check <seed-defcond> <fleet-defcond>
#   ./c6a-seed-roll.sh         <seed-defcond> <fleet-defcond>
#
# The explorer reads the seed's RPC, so its sync ticks fail for the few seconds
# this takes and recover on their own.
set -uo pipefail

NEW_SEED=d050b97df48a74f57a09dadca5985c84
NEW_FLEET=7bf411b0eb08731b6e050868b1d2ff72
OLD_SEED=5c8fab67a6dcbb4c47e92e19141dcf8f
OLD_FLEET=c9898910b40a57d253dae73905e14845
KEYLINE='dslcommitmentv2height=12744'
LOGLINE='Setting dslcommitmentv2height to 12744'

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; shift; fi
SEED_BIN=${1:?usage: c6a-seed-roll.sh [--check] <seed-defcond> <fleet-defcond>}
FLEET_BIN=${2:?usage: c6a-seed-roll.sh [--check] <seed-defcond> <fleet-defcond>}

# unit | installed path | datadir | source | new md5 | old md5
NODES=(
  "defcond-devnet|/usr/local/bin/defcond|/home/defcon/.defcon|$SEED_BIN|$NEW_SEED|$OLD_SEED"
  "defcond-devnet2|/usr/local/bin/defcond-nobdb|/home/defcon/.defcon2|$FLEET_BIN|$NEW_FLEET|$OLD_FLEET"
)

rc=0
for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src new old <<<"$row"
  exec_path=$(grep -h '^ExecStart=' "/etc/systemd/system/$unit.service" | head -1 | sed 's/^ExecStart=//' | awk '{print $1}')
  disk=$(md5sum "$bin" | cut -d' ' -f1); srcmd5=$(md5sum "$src" | cut -d' ' -f1)
  keyed=$(grep -cx "$KEYLINE" "$dir/defcon.conf")
  echo "PRE $unit executes=$exec_path disk=$disk (want old $old) source=$srcmd5 (want new $new) keyed=$keyed"
  { [ "$exec_path" = "$bin" ] && [ "$disk" = "$old" ] && [ "$srcmd5" = "$new" ] && [ "$keyed" = 1 ]; } || { echo "  REFUSING: preflight not clean"; rc=1; }
done
[ "$rc" = 0 ] || exit 1
if [ "$CHECK_ONLY" = 1 ]; then echo "==> --check given, nothing changed"; exit 0; fi

stamp=$(date +%Y%m%d-%H%M)
T0=$(date -u +%s)
for row in "${NODES[@]}"; do IFS='|' read -r unit bin dir src new old <<<"$row"; systemctl stop "$unit"; done
for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src new old <<<"$row"
  cp -a "$bin" "$bin.bak-$stamp"
  install -m 0755 "$src" "$bin"
done
for row in "${NODES[@]}"; do IFS='|' read -r unit bin dir src new old <<<"$row"; systemctl start "$unit"; done
sleep 15

for row in "${NODES[@]}"; do
  IFS='|' read -r unit bin dir src new old <<<"$row"
  active=$(systemctl is-active "$unit")
  running=$(md5sum "/proc/$(systemctl show -p MainPID --value "$unit")/exe" 2>/dev/null | cut -d' ' -f1)
  ts=$(grep "$LOGLINE" "$dir/devnet-defcon-q60/debug.log" | tail -1 | cut -d' ' -f1)
  reread=no; [ -n "$ts" ] && [ "$(date -u -d "$ts" +%s)" -ge "$T0" ] && reread=yes
  echo "POST $unit active=$active running=$running (want $new) keyed=$(grep -cx "$KEYLINE" "$dir/defcon.conf") reread=$reread"
  { [ "$active" = active ] && [ "$running" = "$new" ] && [ "$reread" = yes ]; } || rc=1
done
exit $rc
