#!/usr/bin/env bash
# Measure which headers come out of which location, on a real nginx.
#
# Runs an isolated nginx in its own prefix on 127.0.0.1:8099, serving a copy of
# the built client, and checks every response the live vhost shapes: the SPA
# shell, a deep route, an asset, and a 404. Touches nothing that is running --
# no /etc/nginx, no systemctl, no reload.
#
# Usage:  ops/nginx/verify-headers.sh /path/to/client/dist
#
# Exits non-zero on the first response that is missing a header it must carry,
# which is the point: a header that is inherited on one location and dropped on
# the next is the failure this exists to catch, and it is invisible from the
# browser.
set -euo pipefail

DIST=${1:-client/dist}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX=/tmp/deftrack-nginx-test
BASE=http://127.0.0.1:8099

die() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$DIST/index.html" ] || die "no built client at $DIST (run: npm run build)"
command -v nginx >/dev/null || die "nginx is not installed here"

# The two policies must not drift apart: promoting report-only to enforcing is
# meant to be a change of include, and that is only true while the policy text
# is identical.
ro=$(sed -n 's/^add_header Content-Security-Policy-Report-Only "\(.*\)" always;$/\1/p' "$HERE/csp-report-only.conf")
en=$(sed -n 's/^add_header Content-Security-Policy "\(.*\)" always;$/\1/p' "$HERE/csp-enforce.conf")
[ -n "$ro" ] || die "could not read the report-only policy"
[ "$ro" = "$en" ] || die "report-only and enforcing policies have diverged"

rm -rf "$PREFIX"
mkdir -p "$PREFIX/www" "$PREFIX/snippets" "$PREFIX/body" "$PREFIX/proxy" "$PREFIX/fastcgi" "$PREFIX/uwsgi" "$PREFIX/scgi"
cp -r "$DIST"/. "$PREFIX/www/"
cp "$HERE/security-headers.conf" "$HERE/csp-report-only.conf" "$PREFIX/snippets/"

# Syntax first, then serve. `nginx -t` on the test config is also the check
# that the snippets themselves parse, which is what gets copied to the host.
nginx -t -c "$HERE/test-vhost.conf" -p "$PREFIX" || die "nginx rejected the test config"

nginx -c "$HERE/test-vhost.conf" -p "$PREFIX" &
NGINX_PID=$!
trap 'kill "$NGINX_PID" 2>/dev/null || true' EXIT

for _ in {1..40}; do
  curl -fsS -o /dev/null "$BASE/" 2>/dev/null && break
  sleep 0.25
done
curl -fsS -o /dev/null "$BASE/" || die "the test nginx never answered"

# Every response from this site carries these, error responses included.
REQUIRED=(
  "X-Robots-Tag: noindex, nofollow"
  "X-Content-Type-Options: nosniff"
  "X-Frame-Options: DENY"
  "Referrer-Policy: strict-origin-when-cross-origin"
  "Strict-Transport-Security: max-age=63072000; includeSubDomains"
  "Content-Security-Policy-Report-Only: default-src 'self'"
)

check() {
  local path=$1 expect_status=$2 label=$3
  local headers
  headers=$(curl -sS -D - -o /dev/null "$BASE$path")
  local status
  status=$(printf '%s' "$headers" | head -1 | awk '{print $2}')
  [ "$status" = "$expect_status" ] || die "$label ($path): status $status, expected $expect_status"
  local want
  for want in "${REQUIRED[@]}"; do
    printf '%s' "$headers" | grep -qi "^${want%%:*}:" \
      || die "$label ($path): missing ${want%%:*}"
    printf '%s' "$headers" | grep -qi "^$want" \
      || die "$label ($path): ${want%%:*} is present but not '$want'"
  done
  echo "  ok  $label ($path) -> $status, all ${#REQUIRED[@]} headers"
}

echo "headers, on a real nginx:"
check /                200 "SPA shell"
check /rounds          200 "deep route (try_files -> index.html)"
check /admin           200 "separate shell route"
check /__missing       404 "error response (proves 'always')"

# `ls | head` would read more naturally and shellcheck is right that it does
# not survive an odd filename. These are content-hashed build outputs, so it
# would have been safe -- and a script that is safe by luck teaches the habit
# that is not.
asset=$(find "$PREFIX/www/assets" -maxdepth 1 -name '*.js' -printf '%f\n' | sort | head -1)
[ -n "$asset" ] || die "no built js asset under $DIST/assets"
check "/assets/$asset" 200 "content-hashed asset"

# And the per-location extras, which are the reason each location re-includes
# the snippet in the first place.
printf '%s' "$(curl -sS -D - -o /dev/null "$BASE/")" | grep -qi '^Cache-Control: no-cache' \
  || die "the SPA shell lost its Cache-Control"
printf '%s' "$(curl -sS -D - -o /dev/null "$BASE/assets/$asset")" | grep -qi '^Cache-Control: public, max-age=31536000, immutable' \
  || die "the asset lost its long Cache-Control"
echo "  ok  per-location Cache-Control survived the include"

echo "PASS: every checked response carries the full header set"
