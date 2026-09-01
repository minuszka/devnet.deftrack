# A regtest defcond node for the finality lab.
#
# It deliberately does NOT build Core. The prototype's image tried to and never
# succeeded -- its build log ends in "make: *** No targets specified", exit 2 --
# so nothing ever ran. The daemon is built once in WSL against the target's libs
# and copied in; the only build step here proves it can actually run in this
# image, because a binary that compiles is not a binary that runs.
#
# Build context: place the pre-built binary at the context root as ./defcond,
# built --without-bdb (SQLite descriptor wallets), then:
#   docker build -f docker/Dockerfile -t defcon-core:test .
#
# Base matches the WSL Ubuntu 24.04 build host, so the glibc and shared-library
# ABI the binary was linked against is the one it finds here.

FROM ubuntu:24.04

# Runtime libraries only -- no compiler, no Berkeley DB. This list must match the
# actual --without-bdb build's `ldd` output; the check below fails the build if it
# does not, so a wrong or missing entry cannot slip through to run time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libssl3 \
      libevent-2.1-7 libevent-pthreads-2.1-7 \
      libboost-system1.83.0 libboost-filesystem1.83.0 libboost-thread1.83.0 \
      libsqlite3-0 \
      libzmq5 \
      iproute2 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY defcond /usr/local/bin/defcond

# Prove it runs HERE, in the image that is the target host. A missing shared
# library passes the compile and the -version string and only surfaces as
# "not found" on the box it runs on -- which this image now is. `grep -q`
# succeeds when it finds "not found", so `!` turns that into a failed build; the
# -version call is a second, positive proof that the loader is satisfied.
RUN chmod +x /usr/local/bin/defcond \
 && ! ldd /usr/local/bin/defcond | grep -q "not found" \
 && /usr/local/bin/defcond -version > /dev/null

# Drop root: only NET_ADMIN is granted per container for netem, nothing more.
RUN useradd --system --home-dir /var/lib/defcon --create-home defcon
USER defcon
WORKDIR /var/lib/defcon

# No ENTRYPOINT: the compose command supplies the full `defcond ...` invocation,
# so an operator can also `docker run <image> defcond -version` directly.
