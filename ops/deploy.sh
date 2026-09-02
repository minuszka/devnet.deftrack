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
# protocol.version=0 is not a preference, it is what works from this host.
#
# Observed on the VPS: any protocol-v2 fetch to github.com comes back with
# `www-authenticate: Basic realm="GitHub"` and git then asks for a username --
# on this public repository, and equally on github.com/git/git, so it is
# nothing to do with our credentials or visibility. The same URL fetched with
# curl in the same second returns 200 and the correct ref listing, and
# `git -c protocol.version=0 ls-remote` succeeds. Whatever the cause sits
# between git's v2 request and GitHub, a deploy is not the place to find out.
#
# Set here rather than in the checkout's config so a re-clone does not
# silently reintroduce the failure: it stopped a deploy dead on 2026-09-02,
# and the app had been running two-day-old code without anything saying so.
git -c protocol.version=0 pull --ff-only

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
