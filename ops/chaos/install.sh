#!/usr/bin/env bash
# Install the day-12 package. It is never run by the application deploy script.
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/sbin:/usr/bin:/sbin:/bin

die() { printf 'defcon-chaos install: %s\n' "$*" >&2; exit 1; }
usage() {
  cat >&2 <<'USAGE'
Usage: install.sh --targets <targets.conf> --operator <local-user>
                  [--allow-production] [--root <staging-root>]

Without --root this writes the real host paths and enables the recovery timer.
--root is solely for package tests/staging and never contacts systemd.

The targets file must carry a `host <short-hostname>` record naming the machine
it belongs to, and it must match this one. --allow-production installs anyway on
a host carrying production markers; it is never the right flag to reach for by
default.
USAGE
  exit 2
}

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
TARGETS=''
OPERATOR=''
DEST_ROOT=''
ALLOW_PRODUCTION=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --targets) [ "$#" -ge 2 ] || usage; TARGETS=$2; shift 2 ;;
    --operator) [ "$#" -ge 2 ] || usage; OPERATOR=$2; shift 2 ;;
    --root) [ "$#" -ge 2 ] || usage; DEST_ROOT=$2; shift 2 ;;
    --allow-production) ALLOW_PRODUCTION=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$TARGETS" ] && [ -n "$OPERATOR" ] || usage
[ -f "$TARGETS" ] || die "targets file does not exist: $TARGETS"
[[ "$OPERATOR" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die 'operator must be a local Unix account name'
if [ -n "$DEST_ROOT" ]; then
  [[ "$DEST_ROOT" = /* ]] || die '--root must be an absolute staging directory'
else
  [ "$(id -u)" -eq 0 ] || die 'must run as root'
fi

# Which machine this configuration is for, refused before anything is written.
# The wrapper enforces the same binding on every later command; this check only
# moves the refusal forward to the one moment an operator is still watching.
CONFIG_HOST=$(awk '$1 == "host" { print $2; exit }' "$TARGETS")
[ -n "$CONFIG_HOST" ] || die "targets file must name its host: add 'host <short-hostname>'"

if [ -z "$DEST_ROOT" ]; then
  THIS_HOST=$(hostname -s 2>/dev/null || true)
  [ "$CONFIG_HOST" = "$THIS_HOST" ] ||
    die "these targets belong to host '$CONFIG_HOST' but this machine is '${THIS_HOST:-unknown}'"

  # Defence in depth behind the host binding: a machine that is visibly carrying
  # something else must not receive a fault-injection package by routine. Both
  # markers come from hosts this project actually runs -- a fleet staker unit
  # and a production node container -- and both were present on a host that
  # received the wrapper by accident.
  if [ "$ALLOW_PRODUCTION" != '1' ]; then
    markers=''
    if systemctl is-active --quiet defcon-devnet-mn@11.service 2>/dev/null; then
      markers="$markers fleet-staker(defcon-devnet-mn@11)"
    fi
    if command -v docker >/dev/null 2>&1; then
      if docker ps --filter name=defcon-node --format '{{.Names}}' 2>/dev/null | grep -q .; then
        markers="$markers production-container(defcon-node)"
      fi
    fi
    [ -z "$markers" ] ||
      die "production markers present on $THIS_HOST:$markers -- pass --allow-production only deliberately"
  fi
fi

root_path() { printf '%s%s\n' "$DEST_ROOT" "$1"; }
wrapper=$(root_path /usr/local/sbin/defcon-chaos)
ssh_wrapper=$(root_path /usr/local/bin/defcon-chaos-ssh)
config=$(root_path /etc/defcon-chaos/targets.conf)
sudoers=$(root_path /etc/sudoers.d/defcon-chaos)
service=$(root_path /etc/systemd/system/defcon-chaos-recover.service)
timer=$(root_path /etc/systemd/system/defcon-chaos-recover.timer)
state_dir=$(root_path /var/lib/defcon-chaos/jobs)

# Parse the supplied data before it reaches /etc. Test mode is unprivileged by
# design, so a package test cannot change the host while validating syntax.
test_root=$(mktemp -d)
cleanup_test_root() {
  rm -f -- "$test_root/bin/systemctl" "$test_root/bin/tc" "$test_root/config/targets.conf" \
    "$test_root/defcon-chaos" "$test_root/run/defcon-chaos.lock"
  rmdir -- "$test_root/bin" "$test_root/config" "$test_root/state" "$test_root/run" "$test_root" 2>/dev/null || true
}
trap cleanup_test_root EXIT
mkdir -p "$test_root/bin" "$test_root/config" "$test_root/state" "$test_root/run"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/systemctl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/tc"
chmod 755 "$test_root/bin/systemctl" "$test_root/bin/tc"

# The wrapper deliberately refuses its environment-controlled test mode when it
# is root. A real install is root-only, so validate a private copy as nobody
# before anything is written below /etc. Staging tests remain usable without
# sudo, while the production path cannot accidentally validate /etc before the
# supplied config exists.
if [ "$(id -u)" -eq 0 ]; then
  command -v runuser >/dev/null 2>&1 || die 'runuser is required for root preflight validation'
  test_user=nobody
  test_uid=$(id -u "$test_user") || die 'the nobody account is required for root preflight validation'
  test_gid=$(id -g "$test_user") || die 'the nobody account is required for root preflight validation'
  install -m 0644 "$TARGETS" "$test_root/config/targets.conf"
  install -m 0755 "$HERE/defcon-chaos" "$test_root/defcon-chaos"
  chmod 755 "$test_root" "$test_root/bin" "$test_root/config"
  chown "$test_uid:$test_gid" "$test_root/state" "$test_root/run"
  runuser -u "$test_user" -- env \
    DEFCON_CHAOS_TEST_MODE=1 \
    DEFCON_CHAOS_TEST_CONFIG="$test_root/config/targets.conf" \
    DEFCON_CHAOS_TEST_STATE="$test_root/state" \
    DEFCON_CHAOS_TEST_RUN="$test_root/run" \
    DEFCON_CHAOS_TEST_PATH="$test_root/bin" \
    bash "$test_root/defcon-chaos" verify >/dev/null
else
  DEFCON_CHAOS_TEST_MODE=1 \
  DEFCON_CHAOS_TEST_CONFIG="$TARGETS" \
  DEFCON_CHAOS_TEST_STATE="$test_root/state" \
  DEFCON_CHAOS_TEST_RUN="$test_root/run" \
  DEFCON_CHAOS_TEST_PATH="$test_root/bin" \
  bash "$HERE/defcon-chaos" verify >/dev/null
fi

# Enabling the persistent 15-second timer can race the first production
# verification below. The watchdog holds the same non-blocking wrapper lock,
# so retry only that known, harmless contention; any actual verification error
# still aborts the installation immediately.
verify_installed_wrapper() {
  local output=''
  local retries=0
  while [ "$retries" -lt 5 ]; do
    retries=$((retries + 1))
    if output=$(/usr/local/sbin/defcon-chaos verify 2>&1); then
      printf '%s\n' "$output"
      return 0
    fi
    if [ "$output" != 'defcon-chaos: another defcon-chaos operation is running' ]; then
      printf '%s\n' "$output" >&2
      return 1
    fi
    sleep 1
  done
  printf '%s\n' "$output" >&2
  return 1
}

[ ! -e "$config" ] || die "refusing to overwrite existing configuration: $config"
if [ -z "$DEST_ROOT" ]; then
  install -D -o root -g root -m 0750 "$HERE/defcon-chaos" "$wrapper"
  install -D -o root -g root -m 0755 "$HERE/defcon-chaos-ssh" "$ssh_wrapper"
  install -D -o root -g root -m 0640 "$TARGETS" "$config"
  install -D -o root -g root -m 0644 "$HERE/defcon-chaos-recover.service" "$service"
  install -D -o root -g root -m 0644 "$HERE/defcon-chaos-recover.timer" "$timer"
  install -d -o root -g root -m 0700 "$state_dir" "$(root_path /run/defcon-chaos)"
else
  install -D -m 0750 "$HERE/defcon-chaos" "$wrapper"
  install -D -m 0755 "$HERE/defcon-chaos-ssh" "$ssh_wrapper"
  install -D -m 0640 "$TARGETS" "$config"
  install -D -m 0644 "$HERE/defcon-chaos-recover.service" "$service"
  install -D -m 0644 "$HERE/defcon-chaos-recover.timer" "$timer"
  install -d -m 0700 "$state_dir" "$(root_path /run/defcon-chaos)"
fi
install -d -m 0755 "$(dirname -- "$sudoers")"
printf '%s ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/defcon-chaos *\n' "$OPERATOR" > "$sudoers"
chmod 0440 "$sudoers"

if [ -z "$DEST_ROOT" ]; then
  visudo -cf /etc/sudoers.d/defcon-chaos
  systemctl daemon-reload
  systemctl enable --now defcon-chaos-recover.timer
  verify_installed_wrapper || die 'installed wrapper verification failed'
else
  printf 'staged defcon-chaos package below %s\n' "$DEST_ROOT"
fi
