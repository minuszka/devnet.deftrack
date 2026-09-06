#!/usr/bin/env bash
#
# Build the lab image from pre-built binaries, with a minimal build context.
#
# The Dockerfile copies ./defcond and ./defcon-cli from the context root. Using
# the repository root as that context would ship node_modules and the client
# bundle to the daemon on every build, so this stages just the two binaries and
# the Dockerfile in a temporary directory. The binaries must come from a
# --without-bdb build on Ubuntu 24.04 (the image's base): ops/lab-image.sh
# <build-src-dir> [tag], e.g. the WSL fleet worktree's src/.
#
# Prints the sha256 of both binaries as they sit inside the image, so a lab run
# can record which build it measured -- the version string does not identify a
# build, and never has on this project.
set -euo pipefail
SRC="${1:?usage: ops/lab-image.sh <dir with defcond and defcon-cli> [tag]}"
TAG="${2:-defcon-core:test}"
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
for bin in defcond defcon-cli; do
  [ -f "$SRC/$bin" ] || { echo "missing $SRC/$bin" >&2; exit 1; }
done
CTX=$(mktemp -d)
trap 'rm -rf "$CTX"' EXIT
cp "$SRC/defcond" "$SRC/defcon-cli" "$CTX/"
cp "$HERE/docker/Dockerfile" "$CTX/Dockerfile"
echo "==> building $TAG from $SRC"
docker build -f "$CTX/Dockerfile" -t "$TAG" "$CTX"
echo "==> binaries inside $TAG"
docker run --rm --entrypoint sh "$TAG" -c 'sha256sum /usr/local/bin/defcond /usr/local/bin/defcon-cli; defcond -version | head -1'
