#!/usr/bin/env bash
# Remove the package only after forcing every recorded fault through recovery.
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/sbin:/usr/bin:/sbin:/bin

die() { printf 'defcon-chaos uninstall: %s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\n' 'Usage: uninstall.sh [--purge-config] [--root <staging-root>]' >&2
  exit 2
}

PURGE_CONFIG=0
DEST_ROOT=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge-config) PURGE_CONFIG=1; shift ;;
    --root) [ "$#" -ge 2 ] || usage; DEST_ROOT=$2; shift 2 ;;
    *) usage ;;
  esac
done
if [ -n "$DEST_ROOT" ]; then
  [[ "$DEST_ROOT" = /* ]] || die '--root must be absolute'
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

if [ -z "$DEST_ROOT" ]; then
  # Recovery first, watchdog second. Disabling the timer before recovering
  # leaves a host holding live faults with nothing left to undo them if the
  # recovery itself fails -- the one state this package must never create. And
  # a failed recovery stops the uninstall rather than removing the only tool
  # that could still repair it.
  if [ -x "$wrapper" ]; then
    "$wrapper" recover-all ||
      die 'recover-all failed; the recovery timer is left enabled and nothing was removed'
  fi
  systemctl disable --now defcon-chaos-recover.timer 2>/dev/null || true
fi

rm -f -- "$wrapper" "$ssh_wrapper" "$sudoers" "$service" "$timer"
if [ "$PURGE_CONFIG" = '1' ]; then rm -f -- "$config"; fi
# rmdir, unlike a recursive delete, refuses an unexpected file or directory.
rmdir -- "$state_dir" 2>/dev/null || true
rmdir -- "$(root_path /var/lib/defcon-chaos)" 2>/dev/null || true
rmdir -- "$(root_path /run/defcon-chaos)" 2>/dev/null || true
if [ -z "$DEST_ROOT" ]; then systemctl daemon-reload; fi
printf '%s\n' 'defcon-chaos package files removed'
