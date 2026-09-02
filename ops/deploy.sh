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
# Pull normally, and fall back to protocol v0 only if that fails.
#
# On 2026-09-02 every protocol-v2 fetch from this host answered
# `www-authenticate: Basic realm="GitHub"` and git then asked for a username --
# on this public repository, and equally on github.com/git/git. curl fetched the
# identical smart-HTTP URL in the same second and got 200 with a correct ref
# listing, and `git -c protocol.version=0` succeeded immediately.
#
# It cleared on its own within the hour. A plain fetch from the same host works
# again, so it was transient between git's v2 request and GitHub rather than a
# property of the host -- and pinning the version, as the first version of this
# fix did, disables the default protocol for good on evidence that does not
# support it.
#
# What is worth guarding is the silence, not the protocol. The pull aborted, the
# deploy never reached its build or publish steps, and nothing downstream said
# so: the app served a bundle from 2026-08-31 while four merged pull requests
# sat unshipped. This script already exists because building is not deploying;
# this is the same lesson one step earlier.
if ! git pull --ff-only; then
  echo "    pull failed; retrying with git protocol v0" >&2
  git -c protocol.version=0 pull --ff-only
fi

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
