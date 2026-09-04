#!/usr/bin/env bash
# Install the day-12 package. It is never run by the application deploy script.
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/sbin:/usr/bin:/sbin:/bin

die() { printf 'defcon-chaos install: %s\n' "$*" >&2; exit 1; }
usage() {
  cat >&2 <<'USAGE'
Usage: install.sh --targets <targets.conf> --operator <local-user> [--root <staging-root>]

Without --root this writes the real host paths and enables the recovery timer.
--root is solely for package tests/staging and never contacts systemd.
USAGE
  exit 2
}

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGETS=''
OPERATOR=''
DEST_ROOT=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --targets) [ "$#" -ge 2 ] || usage; TARGETS=$2; shift 2 ;;
    --operator) [ "$#" -ge 2 ] || usage; OPERATOR=$2; shift 2 ;;
    --root) [ "$#" -ge 2 ] || usage; DEST_ROOT=$2; shift 2 ;;
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
  rm -f -- "$test_root/bin/systemctl" "$test_root/bin/tc" "$test_root/run/defcon-chaos.lock"
  rmdir -- "$test_root/bin" "$test_root/state" "$test_root/run" "$test_root" 2>/dev/null || true
}
trap cleanup_test_root EXIT
mkdir -p "$test_root/bin" "$test_root/state" "$test_root/run"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/systemctl"
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/tc"
chmod 700 "$test_root/bin/systemctl" "$test_root/bin/tc"
DEFCON_CHAOS_TEST_MODE=1 \
DEFCON_CHAOS_TEST_CONFIG="$TARGETS" \
DEFCON_CHAOS_TEST_STATE="$test_root/state" \
DEFCON_CHAOS_TEST_RUN="$test_root/run" \
DEFCON_CHAOS_TEST_PATH="$test_root/bin" \
bash "$HERE/defcon-chaos" verify >/dev/null

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
  /usr/local/sbin/defcon-chaos verify
else
  printf 'staged defcon-chaos package below %s\n' "$DEST_ROOT"
fi
