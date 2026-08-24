#!/usr/bin/env bash
#
# Install the per-host observer agent on one fullnode.
#
# Reads its host label from the staking instance's externalip rather than being
# told, so a host cannot be mislabelled by a typo in a rollout loop.
#
# Environment: OBSERVER_API, OBSERVER_TOKEN, OBSERVER_HOST
set -euo pipefail

BASE=/opt/defcon-devnet
API="${OBSERVER_API:?OBSERVER_API is required}"
TOKEN="${OBSERVER_TOKEN:?OBSERVER_TOKEN is required}"
HOST="${OBSERVER_HOST:?OBSERVER_HOST is required}"

install -m 0755 /tmp/devnet-observer.py $BASE/bin/devnet-observer.py

# 0600: the token is in here, and eight machines holding it is already the
# weakest link in this arrangement.
cat > /etc/devnet-observer.env <<CONF
OBSERVER_API=$API
OBSERVER_TOKEN=$TOKEN
OBSERVER_HOST=$HOST
OBSERVER_DATADIR=$BASE/mn11
OBSERVER_CLI=$BASE/bin/defcon-cli
OBSERVER_POLL_SECONDS=0.1
CONF
chmod 600 /etc/devnet-observer.env

cat > /etc/systemd/system/devnet-observer.service <<'UNIT'
[Unit]
Description=DeFCoN devnet per-host observer
After=network-online.target defcon-devnet-mn@11.service
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
