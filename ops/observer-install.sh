#!/usr/bin/env bash
#
# Install the per-host observer agent on one fullnode.
#
# `OBSERVER_HOST` is a stable opaque label, not an address: HostStatus is shown
# by the public propagation endpoint. The private simulator manifest maps this
# label to its chain-facing address through `chainHostRef`.
#
# Environment: OBSERVER_API, OBSERVER_TOKEN, OBSERVER_HOST.
# Optional: OBSERVER_DATADIR. Defaults to mn11 when that existing rollout
# instance is present, otherwise mn1, so the observer also covers
# masternode-only fleet hosts. Set it explicitly when a particular wallet's
# staking scripts must be observed.
set -euo pipefail

BASE=/opt/defcon-devnet
API="${OBSERVER_API:?OBSERVER_API is required}"
TOKEN="${OBSERVER_TOKEN:?OBSERVER_TOKEN is required}"
HOST="${OBSERVER_HOST:?OBSERVER_HOST is required}"

if ! [[ "$HOST" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]]; then
  echo "OBSERVER_HOST must be a stable lowercase host label" >&2
  exit 2
fi
if [[ "$HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "OBSERVER_HOST must be an opaque label, never an address" >&2
  exit 2
fi

if [[ -n "${OBSERVER_DATADIR:-}" ]]; then
  DATADIR="$OBSERVER_DATADIR"
elif [[ -d "$BASE/mn11" ]]; then
  # Preserve the existing mn11 rollout where present. On a host without it,
  # mn1 is enough for all network and chain observations.
  DATADIR="$BASE/mn11"
else
  DATADIR="$BASE/mn1"
fi
case "$DATADIR" in
  "$BASE"/mn[0-9]*) ;;
  *) echo "OBSERVER_DATADIR must name a fleet instance below $BASE" >&2; exit 2 ;;
esac
if [[ ! -d "$DATADIR" || ! -f "$DATADIR/defcon.conf" ]]; then
  echo "OBSERVER_DATADIR is not a configured fleet instance: $DATADIR" >&2
  exit 2
fi

install -m 0755 /tmp/devnet-observer.py $BASE/bin/devnet-observer.py

# 0600: the token is in here, and eight machines holding it is already the
# weakest link in this arrangement.
cat > /etc/devnet-observer.env <<CONF
OBSERVER_API=$API
OBSERVER_TOKEN=$TOKEN
OBSERVER_HOST=$HOST
OBSERVER_DATADIR=$DATADIR
OBSERVER_CLI=$BASE/bin/defcon-cli
OBSERVER_DAEMON=$BASE/bin/defcond
OBSERVER_POLL_SECONDS=0.1
CONF
chmod 600 /etc/devnet-observer.env

cat > /etc/systemd/system/devnet-observer.service <<'UNIT'
[Unit]
Description=DeFCoN devnet per-host observer
After=network-online.target
Wants=network-online.target

[Service]
User=defcon
Group=defcon
Type=simple
EnvironmentFile=/etc/devnet-observer.env
ExecStart=/usr/bin/python3 /opt/defcon-devnet/bin/devnet-observer.py
Restart=always
RestartSec=10

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

# The unit runs as defcon and must read the token file.
chown root:defcon /etc/devnet-observer.env
chmod 640 /etc/devnet-observer.env

systemctl daemon-reload
systemctl enable --now devnet-observer >/dev/null 2>&1 || systemctl restart devnet-observer
sleep 6
printf '%s observer=%s\n' "$(hostname -s)" "$(systemctl is-active devnet-observer)"
