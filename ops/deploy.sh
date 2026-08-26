#!/usr/bin/env bash
#
# Deploy on the devnet VPS: pull, build, publish the client, restart the API.
#
# The publish step is the reason this file exists. `npm run build` writes the
# client to client/dist, but nginx serves /var/www/devnet.deftrack -- so a
# deploy that stopped after building left the site on whatever bundle was last
# copied there by hand. It did exactly that for two days, and every client
# change looked like it had silently failed to take effect.
#
# Usage (on the VPS):  /opt/devnet-deftrack/app/ops/deploy.sh
set -euo pipefail

APP=/opt/devnet-deftrack/app
WEBROOT=/var/www/devnet.deftrack
UNIT=deftrack-devnet

cd "$APP"

echo "==> pull"
git pull --ff-only

echo "==> install (lockfile-exact)"
npm ci --silent

echo "==> build"
npm run build

echo "==> publish client -> $WEBROOT"
rsync -a --delete "$APP/client/dist/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

echo "==> restart $UNIT"
systemctl restart "$UNIT"
sleep 6

echo "==> readiness"
# The endpoint answers 503 when Mongo, the RPC or the indexer is failing, so a
# broken deploy fails here rather than being discovered by a person later.
curl -fsS localhost:4100/api/v1/health | python3 -m json.tool | head -20

echo "==> served bundle"
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$WEBROOT/index.html"
