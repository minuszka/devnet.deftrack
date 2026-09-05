#!/usr/bin/env bash
# A no-root regression suite: fake systemctl/tc prove the wrapper's argument and
# recovery boundaries without touching the developer machine.
set -euo pipefail
IFS=$'\n\t'

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
cleanup() {
  rm -f -- "$TMP/bin/systemctl" "$TMP/bin/tc" "$TMP/bin/ssh" \
    "$TMP/config/targets.conf" "$TMP/config/ssh-targets.conf" "$TMP/tc.log" "$TMP/ssh.log" \
    "$TMP/run/defcon-chaos.lock" "$TMP/jobs/job-marker.env" "$TMP/jobs/job-service.env" "$TMP/jobs/job-netem.env" "$TMP/jobs/job-expired.env" \
    "$TMP/systemd/defcon-devnet-mn@1.service" \
    "$TMP/stage/usr/local/sbin/defcon-chaos" "$TMP/stage/usr/local/bin/defcon-chaos-ssh" \
    "$TMP/stage/etc/defcon-chaos/targets.conf" "$TMP/stage/etc/sudoers.d/defcon-chaos" \
    "$TMP/stage/etc/systemd/system/defcon-chaos-recover.service" "$TMP/stage/etc/systemd/system/defcon-chaos-recover.timer"
  rmdir -- "$TMP/bin" "$TMP/config" "$TMP/run" "$TMP/jobs" "$TMP/systemd" \
    "$TMP/stage/usr/local/sbin" "$TMP/stage/usr/local/bin" "$TMP/stage/usr/local" \
    "$TMP/stage/etc/defcon-chaos" "$TMP/stage/etc/sudoers.d" "$TMP/stage/etc/systemd/system" "$TMP/stage/etc/systemd" "$TMP/stage/etc" \
    "$TMP/stage/var/lib/defcon-chaos/jobs" "$TMP/stage/var/lib/defcon-chaos" "$TMP/stage/var/lib" "$TMP/stage/var" \
    "$TMP/stage/run/defcon-chaos" "$TMP/stage/run" "$TMP/stage" "$TMP" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$TMP/bin" "$TMP/config" "$TMP/jobs" "$TMP/run" "$TMP/systemd"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'state=${FAKE_SYSTEMD_STATE:?}' \
  'case "$1" in' \
  '  is-active)' \
  '    unit=${!#}' \
  '    if [ -f "$state/$unit" ]; then' \
  '      case " $* " in *" --quiet "*) exit 0 ;; *) printf "active\n"; exit 0 ;; esac' \
  '    fi' \
  '    case " $* " in *" --quiet "*) exit 3 ;; *) printf "inactive\n"; exit 3 ;; esac' \
  '    ;;' \
  '  start|restart) touch "$state/$2" ;;' \
  '  stop) rm -f -- "$state/$2" ;;' \
  '  *) printf "unexpected systemctl: %s\n" "$*" >&2; exit 64 ;;' \
  'esac' > "$TMP/bin/systemctl"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${FAKE_TC_LOG:?}"' \
  'if [ "$1" = qdisc ] && [ "$2" = show ]; then' \
  '  if [ -n "${FAKE_TC_ROOT_MQ:-}" ]; then' \
  '    printf "qdisc mq 0: root\n"' \
  '    printf "qdisc %s 0: parent :1\n" "${FAKE_TC_QDISC:-fq_codel}"' \
  '  else' \
  '    printf "qdisc %s 0: root refcnt 2\n" "${FAKE_TC_QDISC:-fq_codel}"' \
  '  fi' \
  'fi' > "$TMP/bin/tc"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${FAKE_SSH_LOG:?}"' > "$TMP/bin/ssh"
chmod 700 "$TMP/bin/systemctl" "$TMP/bin/tc" "$TMP/bin/ssh"
touch "$TMP/systemd/defcon-devnet-mn@1.service"
printf '%s\n' \
  'host pilot-host' \
  'policy 120' \
  'target mn01 defcon-devnet-mn@1.service ens3 19799 fq_codel' > "$TMP/config/targets.conf"
printf '%s\n' 'target mn01 deploy@pilot-host.example' > "$TMP/config/ssh-targets.conf"

export DEFCON_CHAOS_TEST_MODE=1
export DEFCON_CHAOS_TEST_CONFIG="$TMP/config/targets.conf"
export DEFCON_CHAOS_TEST_STATE="$TMP/jobs"
export DEFCON_CHAOS_TEST_RUN="$TMP/run"
export DEFCON_CHAOS_TEST_PATH="$TMP/bin"
export FAKE_SYSTEMD_STATE="$TMP/systemd"
export FAKE_TC_LOG="$TMP/tc.log"
export FAKE_SSH_LOG="$TMP/ssh.log"

fail() { printf 'chaos wrapper test failed: %s\n' "$*" >&2; exit 1; }
expect_failure() {
  if "$@" >/dev/null 2>&1; then fail "command unexpectedly succeeded: $*"; fi
}
expiry=$(( $(date +%s) + 60 ))

bash "$HERE/defcon-chaos" verify | grep -Fq 'targets=1' || fail 'verify did not parse the target config'
status_output=$(bash "$HERE/defcon-chaos" status mn01)
printf '%s\n' "$status_output" | grep -Fq 'unit_active=yes' || fail "status did not use the allowlisted unit: $status_output"

bash "$HERE/defcon-chaos" marker mn01 marker "$expiry"
[ -f "$TMP/jobs/job-marker.env" ] || fail 'marker did not persist a recovery record'
bash "$HERE/defcon-chaos" clear mn01 marker
[ ! -e "$TMP/jobs/job-marker.env" ] || fail 'marker clear left its record behind'

bash "$HERE/defcon-chaos" service stop mn01 service "$expiry"
[ ! -f "$TMP/systemd/defcon-devnet-mn@1.service" ] || fail 'service stop did not reach fake systemd'
[ -f "$TMP/jobs/job-service.env" ] || fail 'service stop did not persist recovery state first'
bash "$HERE/defcon-chaos" clear mn01 service
[ -f "$TMP/systemd/defcon-devnet-mn@1.service" ] || fail 'clear did not restore prior service state'
[ ! -e "$TMP/jobs/job-service.env" ] || fail 'clear left a completed service job behind'

bash "$HERE/defcon-chaos" netem mn01 netem "$expiry" 80 20 5
# The band must be unreachable without a filter. A plain `prio` root uses the
# default priomap, which routes bulk-TOS traffic -- OpenSSH's own interactive
# default among it -- into band 3 with no filter matching it, and that is how a
# 100% loss fault cut the operator out of the pilot host.
grep -Fqx 'qdisc replace dev ens3 root handle 1: prio bands 4 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0' "$TMP/tc.log" ||
  fail 'netem root qdisc did not reserve an unreachable band'
grep -Fqx 'qdisc replace dev ens3 parent 1:4 handle 40: netem delay 80ms 20ms loss 5%' "$TMP/tc.log" ||
  fail 'netem did not attach to the reserved band'
# Source port, not destination: matching the destination catches every other
# daemon on the host dialling a remote node that listens on the same number.
grep -Fqx 'filter replace dev ens3 protocol ip parent 1: prio 4 u32 match ip sport 19799 0xffff flowid 1:4' "$TMP/tc.log" ||
  fail 'netem did not bind to the configured P2P port as a source port'
grep -Fq 'match ip dport' "$TMP/tc.log" && fail 'netem still matches a destination port'
bash "$HERE/defcon-chaos" clear mn01 netem
grep -Fqx 'qdisc replace dev ens3 root fq_codel' "$TMP/tc.log" || fail 'netem clear did not restore declared baseline qdisc'

# A pure packet-loss fault must be expressible, and must not send `delay 0ms`.
: > "$TMP/tc.log"
bash "$HERE/defcon-chaos" netem mn01 loss-only "$expiry" 0 0 100
grep -Fqx 'qdisc replace dev ens3 parent 1:4 handle 40: netem loss 100%' "$TMP/tc.log" ||
  fail 'a zero-latency fault did not produce a bare loss netem'
bash "$HERE/defcon-chaos" clear mn01 loss-only

# The baseline check must read the ROOT qdisc line. On a multi-queue NIC the
# children are fq_codel while the root is mq, and installing a single-queue
# root over that is a silent configuration change.
FAKE_TC_ROOT_MQ=1 expect_failure bash "$HERE/defcon-chaos" netem mn01 mq-root "$expiry" 80 20 5

# The configuration is bound to one machine. A file with no host record is
# refused outright: without it the package acts on whatever host it was copied
# to, which is how two fleet machines ended up with an enabled recovery timer
# nobody meant to install.
bash "$HERE/defcon-chaos" verify | grep -Fq 'host=pilot-host' || fail 'verify does not name the host it is bound to'
printf '%s\n' \
  'policy 120' \
  'target mn01 defcon-devnet-mn@1.service ens3 19799 fq_codel' > "$TMP/config/hostless.conf"
DEFCON_CHAOS_TEST_CONFIG="$TMP/config/hostless.conf" expect_failure bash "$HERE/defcon-chaos" verify
printf '%s\n' \
  'host pilot-host' \
  'host other-host' \
  'policy 120' \
  'target mn01 defcon-devnet-mn@1.service ens3 19799 fq_codel' > "$TMP/config/twohosts.conf"
DEFCON_CHAOS_TEST_CONFIG="$TMP/config/twohosts.conf" expect_failure bash "$HERE/defcon-chaos" verify

expect_failure bash "$HERE/defcon-chaos" service stop not-allowlisted other "$expiry"
expect_failure bash "$HERE/defcon-chaos" service stop mn01 too-long "$((expiry + 120))"
FAKE_TC_QDISC=pfifo_fast expect_failure bash "$HERE/defcon-chaos" netem mn01 rejected "$expiry" 80 20 5

printf '%s\n' \
  'kind=service' \
  'target=mn01' \
  'unit=defcon-devnet-mn@1.service' \
  'prior_active=yes' \
  'expires=1' > "$TMP/jobs/job-expired.env"
rm -f -- "$TMP/systemd/defcon-devnet-mn@1.service"
bash "$HERE/defcon-chaos" recover-expired
[ -f "$TMP/systemd/defcon-devnet-mn@1.service" ] || fail 'expiry recovery did not restore the service'
[ ! -e "$TMP/jobs/job-expired.env" ] || fail 'expiry recovery left its record behind'

DEFCON_CHAOS_TEST_SSH_BIN="$TMP/bin/ssh" bash "$HERE/defcon-chaos-ssh" "$TMP/config/ssh-targets.conf" status mn01
grep -Fqx -- '-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=15 -o StrictHostKeyChecking=yes deploy@pilot-host.example sudo -n /usr/local/sbin/defcon-chaos status mn01' "$TMP/ssh.log" || fail 'SSH executor lost its non-interactive boundary'
DEFCON_CHAOS_TEST_SSH_BIN="$TMP/bin/ssh" bash "$HERE/defcon-chaos-ssh" "$TMP/config/ssh-targets.conf" marker mn01 marker "$expiry"
grep -Fqx -- "-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=15 -o StrictHostKeyChecking=yes deploy@pilot-host.example sudo -n /usr/local/sbin/defcon-chaos marker mn01 marker $expiry" "$TMP/ssh.log" || fail 'SSH executor did not preserve a marker command'
expect_failure bash "$HERE/defcon-chaos-ssh" "$TMP/config/ssh-targets.conf" status 'mn01;anything'

bash "$HERE/install.sh" --targets "$TMP/config/targets.conf" --operator chaosops --root "$TMP/stage" >/dev/null
[ -x "$TMP/stage/usr/local/sbin/defcon-chaos" ] || fail 'staging install omitted wrapper'
[ -f "$TMP/stage/etc/sudoers.d/defcon-chaos" ] || fail 'staging install omitted sudoers policy'
bash "$HERE/uninstall.sh" --root "$TMP/stage" --purge-config >/dev/null
[ ! -e "$TMP/stage/usr/local/sbin/defcon-chaos" ] || fail 'staging uninstall kept wrapper'

printf '%s\n' 'chaos wrapper fake-systemd tests: passed'
