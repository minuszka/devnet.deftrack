#!/usr/bin/env bash
#
# Does the network fault actually impair the network?
#
# The existing suite drives the wrapper against a fake `tc` and asserts the
# command line it would have run. That is worth having -- it is where the
# argument validation and the job bookkeeping live -- but it cannot fail for the
# only reason that matters: it never asks the kernel whether a packet was
# dropped. The chaos test that ran before this one used a loss of 0%, so it
# could not have told the difference between a working fault and no fault at
# all.
#
# This one builds two network namespaces joined by a veth pair, runs the REAL
# wrapper inside one of them, and counts datagrams arriving in the other.
#
# Three things it proves that the fake cannot:
#
#   1. `loss 100%` on the target's own source port drops everything.
#   2. Traffic from any OTHER source port on the same interface is untouched.
#      This is the property that matters most on a real host: an earlier version
#      of the wrapper attached netem to a band the default priomap actually
#      routes traffic into, and a 100% loss fault cut the operator's SSH.
#   3. `clear` puts the interface back to its declared baseline, and traffic
#      flows again.
#
# It needs root, and it never touches the host's own configuration: /etc and
# /var/lib are replaced by tmpfs inside a private mount namespace, so a machine
# with a real installation is unaffected even while this runs.
#
# Usage:  sudo ops/chaos/tests/netns.sh
set -euo pipefail
IFS=$'\n\t'

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
WRAPPER="$HERE/../defcon-chaos"

NS_A=defcon-chaos-t-a
NS_B=defcon-chaos-t-b
ADDR_A=10.244.77.1
ADDR_B=10.244.77.2
PORT=19799
OTHER_PORT=19800
DEST_PORT=39999
DATAGRAMS=20

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  fail 'must run as root: it creates network namespaces and installs qdiscs'
fi
for tool in ip tc python3 unshare; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing required tool: $tool"
done
# Some kernels ship netem as a module and do not load it until something asks.
# If it cannot be loaded the test must say so rather than measure nothing.
modprobe sch_netem 2>/dev/null || true

if [ "${1:-}" != '--inner' ]; then
  # ── outer: namespaces, wiring, and the measurement ──────────────────────────
  TMP=$(mktemp -d)
  # Invoked by the EXIT trap below, which shellcheck cannot see.
  # shellcheck disable=SC2329
  cleanup() {
    ip netns del "$NS_A" 2>/dev/null || true
    ip netns del "$NS_B" 2>/dev/null || true
    rm -rf -- "$TMP"
  }
  trap cleanup EXIT
  # A previous crashed run must not make this one look healthy.
  ip netns del "$NS_A" 2>/dev/null || true
  ip netns del "$NS_B" 2>/dev/null || true

  ip netns add "$NS_A"
  ip netns add "$NS_B"
  ip link add veth-a type veth peer name veth-b
  ip link set veth-a netns "$NS_A"
  ip link set veth-b netns "$NS_B"
  ip netns exec "$NS_A" ip addr add "$ADDR_A/24" dev veth-a
  ip netns exec "$NS_B" ip addr add "$ADDR_B/24" dev veth-b
  ip netns exec "$NS_A" ip link set veth-a up
  ip netns exec "$NS_B" ip link set veth-b up
  ip netns exec "$NS_A" ip link set lo up
  ip netns exec "$NS_B" ip link set lo up

  cat > "$TMP/recv.py" <<'PY'
import socket, sys
count_file, seconds = sys.argv[1], float(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', int(sys.argv[3])))
sock.settimeout(seconds)
received = 0
while True:
    try:
        sock.recvfrom(64)
    except socket.timeout:
        break
    received += 1
with open(count_file, 'w', encoding='utf-8') as handle:
    handle.write(str(received))
PY

  cat > "$TMP/send.py" <<'PY'
import socket, sys, time
src_port, dest, dest_port, count = int(sys.argv[1]), sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', src_port))
for _ in range(count):
    sock.sendto(b'defcon-chaos-probe', (dest, dest_port))
    time.sleep(0.01)
PY

  # One measurement: send `DATAGRAMS` from `src_port` in A, count arrivals in B.
  measure() {
    local src_port=$1 count_file="$TMP/count"
    rm -f "$count_file"
    ip netns exec "$NS_B" python3 "$TMP/recv.py" "$count_file" 1.5 "$DEST_PORT" &
    local receiver=$!
    sleep 0.3
    ip netns exec "$NS_A" python3 "$TMP/send.py" "$src_port" "$ADDR_B" "$DEST_PORT" "$DATAGRAMS"
    wait "$receiver"
    cat "$count_file"
  }

  baseline_from=$(measure "$PORT")
  [ "$baseline_from" = "$DATAGRAMS" ] ||
    fail "the link does not carry traffic before any fault ($baseline_from/$DATAGRAMS) -- the test is broken, not the wrapper"
  printf '    link carries %s/%s before the fault\n' "$baseline_from" "$DATAGRAMS"

  # The wrapper runs inside A, with its own /etc and /var/lib.
  ip netns exec "$NS_A" unshare --mount --propagation private \
    bash "$0" --inner "$TMP" "$WRAPPER" apply

  during_target=$(measure "$PORT")
  during_other=$(measure "$OTHER_PORT")

  ip netns exec "$NS_A" unshare --mount --propagation private \
    bash "$0" --inner "$TMP" "$WRAPPER" clear

  after=$(measure "$PORT")
  root_qdisc=$(ip netns exec "$NS_A" tc qdisc show dev veth-a | head -1)

  printf '    with a 100%% loss fault: %s/%s from the target port, %s/%s from another port\n' \
    "$during_target" "$DATAGRAMS" "$during_other" "$DATAGRAMS"
  printf '    after clear: %s/%s, root qdisc %s\n' "$after" "$DATAGRAMS" "${root_qdisc#qdisc }"

  [ "$during_target" = '0' ] ||
    fail "a 100% loss fault delivered $during_target/$DATAGRAMS datagrams -- the fault is not being applied"
  [ "$during_other" = "$DATAGRAMS" ] ||
    fail "traffic from an unrelated source port lost $((DATAGRAMS - during_other))/$DATAGRAMS -- the filter is too wide, which is how a fault reaches SSH"
  [ "$after" = "$DATAGRAMS" ] ||
    fail "clear left the link impaired ($after/$DATAGRAMS)"
  case "$root_qdisc" in
    'qdisc noqueue '*' root'*) ;;
    *) fail "clear did not restore the declared baseline: $root_qdisc" ;;
  esac

  printf 'chaos wrapper netns test: passed\n'
  exit 0
fi

# ── inner: inside netns A and a private mount namespace ───────────────────────
TMP=$2
WRAPPER=$3
ACTION=$4

# The wrapper is root here, so it reads the real paths. They are replaced for
# the duration: a host that has the package installed keeps its configuration
# and its live jobs, because this run cannot see them and cannot write over
# them.
#
# The state directory is a bind mount of a directory in $TMP rather than a
# tmpfs, because apply and clear are two separate entries into this namespace
# and a tmpfs would take the job record with it when the first one exited --
# `clear` then answered "job not found", which looked like a wrapper bug and was
# the harness losing the evidence.
mkdir -p /etc/defcon-chaos /var/lib/defcon-chaos /run/defcon-chaos "$TMP/state"
mount -t tmpfs tmpfs /etc/defcon-chaos
mount --bind "$TMP/state" /var/lib/defcon-chaos
mount -t tmpfs tmpfs /run/defcon-chaos

# `host` binds the configuration to one machine and the wrapper refuses to act
# when it does not match, which is the point of the record -- so it has to name
# this one.
{
  printf 'host %s\n' "$(hostname -s)"
  printf 'policy 600\n'
  printf 'target mn01 defcon-devnet-mn@1.service veth-a %s noqueue\n' "19799"
} > /etc/defcon-chaos/targets.conf
chmod 640 /etc/defcon-chaos/targets.conf

case "$ACTION" in
  apply)
    # Latency 0, jitter 0, loss 100: the loudest fault the wrapper can apply,
    # chosen so that "nothing arrived" is unambiguous.
    bash "$WRAPPER" netem mn01 netns-probe "$(( $(date +%s) + 120 ))" 0 0 100
    ;;
  clear)
    bash "$WRAPPER" clear mn01 netns-probe
    ;;
  *) fail "unknown inner action: $ACTION" ;;
esac

