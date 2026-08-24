#!/usr/bin/env python3
"""
Per-host observer for the devnet.

One node cannot tell a network problem from its own problem. This runs beside
the staking instance on each fullnode and reports when *that host* first saw
each block and each ChainLock, so the explorer can compare eight vantage points
and say whether a late block was late for everyone or for one machine.

Deliberately dependency-free beyond `requests`, which the hosts already carry:
these are production mainnet machines, and a measurement is not worth an apt
install on them. The cost is honest and stated rather than hidden -- the timing
resolution equals POLL_SECONDS, and every push carries it so the comparison can
declare its own error bar instead of implying a precision it does not have.

The host's NTP offset is sent along for the same reason. It is never used to
correct a timestamp: correcting would claim an accuracy NTP does not guarantee.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import requests

AGENT_VERSION = "1.1.0"

DATADIR = os.environ.get("OBSERVER_DATADIR", "/opt/defcon-devnet/mn11")
CLI = os.environ.get("OBSERVER_CLI", "/opt/defcon-devnet/bin/defcon-cli")
API = os.environ.get("OBSERVER_API", "").rstrip("/")
TOKEN = os.environ.get("OBSERVER_TOKEN", "")
HOST = os.environ.get("OBSERVER_HOST", "")

POLL_SECONDS = float(os.environ.get("OBSERVER_POLL_SECONDS", "0.1"))
# Pushes are batched so a slow explorer cannot stall the polling loop, which is
# the only thing here that has to stay on time.
PUSH_SECONDS = float(os.environ.get("OBSERVER_PUSH_SECONDS", "5"))
CLOCK_REFRESH_SECONDS = 300
MAX_QUEUE = 2000


def cli(*args):
    """One RPC call against the local node. Returns None on any failure."""
    try:
        out = subprocess.run(
            [CLI, f"-datadir={DATADIR}", f"-conf={DATADIR}/defcon.conf", *args],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode != 0:
            return None
        return out.stdout.strip()
    except Exception:
        return None


def clock_offset_ms():
    """
    This host's NTP offset, in milliseconds, or None when it cannot be read.

    Reported as data. A host whose clock is unknown is not excluded -- its
    sightings simply widen the error bar of every comparison it takes part in.
    """
    try:
        out = subprocess.run(["chronyc", "-c", "tracking"], capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            fields = out.stdout.strip().split(",")
            if len(fields) > 4:
                return float(fields[4]) * 1000.0
    except Exception:
        pass
    try:
        out = subprocess.run(["timedatectl", "show-timesync", "--property=NTPMessage"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and "offset=" in out.stdout:
            raw = out.stdout.split("offset=")[1].split(",")[0].strip().rstrip("}")
            for suffix, scale in (("ms", 1.0), ("us", 0.001), ("s", 1000.0)):
                if raw.endswith(suffix):
                    return float(raw[: -len(suffix)]) * scale
    except Exception:
        pass
    return None


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def push(queue, offset):
    if not queue:
        return True
    body = {
        "host": HOST,
        "agentVersion": AGENT_VERSION,
        "clockOffsetMs": offset,
        # Stated, not hidden: this is the floor on what any comparison built
        # from these timestamps can resolve.
        "resolutionMs": POLL_SECONDS * 1000.0,
        "observations": queue[:500],
    }
    try:
        r = requests.post(
            f"{API}/api/v1/peers/observations",
            json=body,
            headers={"x-ingest-token": TOKEN},
            timeout=15,
        )
        if r.status_code == 200:
            del queue[: len(body["observations"])]
            return True
        print(f"push rejected: {r.status_code} {r.text[:200]}", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"push failed: {exc}", file=sys.stderr, flush=True)
    return False


def main():
    for name, value in (("OBSERVER_API", API), ("OBSERVER_TOKEN", TOKEN), ("OBSERVER_HOST", HOST)):
        if not value:
            raise SystemExit(f"{name} is required")

    queue = []

    # Prime from the node without reporting: whatever the tip is when this
    # process starts was not *first seen* now, it was seen before this agent
    # existed. Reporting it produced a 97-second spread across hosts on the
    # first rollout -- purely an artefact of the agents starting at different
    # moments, and indistinguishable from a real propagation failure.
    last_block = cli("getbestblockhash")
    last_chainlock = None
    primed_lock = cli("getbestchainlock")
    if primed_lock:
        try:
            last_chainlock = json.loads(primed_lock).get("blockhash")
        except Exception:
            last_chainlock = None

    offset = clock_offset_ms()
    last_clock = time.monotonic()
    last_push = time.monotonic()

    print(
        f"observer {AGENT_VERSION} on {HOST}: poll {POLL_SECONDS}s, push {PUSH_SECONDS}s, "
        f"primed at {last_block[:12] if last_block else 'unknown'}",
        flush=True,
    )

    while True:
        loop_started = time.monotonic()

        block = cli("getbestblockhash")
        if block and block != last_block:
            # Timestamp first, before anything that can block.
            seen = now_iso()
            height = None
            info = cli("getblockheader", block)
            if info:
                try:
                    height = json.loads(info).get("height")
                except Exception:
                    height = None
            queue.append({"topic": "block", "hash": block, "height": height, "receivedAt": seen})
            last_block = block

        lock = cli("getbestchainlock")
        if lock:
            try:
                parsed = json.loads(lock)
                lock_hash = parsed.get("blockhash")
                if lock_hash and lock_hash != last_chainlock:
                    queue.append({
                        "topic": "chainlock",
                        "hash": lock_hash,
                        "height": parsed.get("height"),
                        "receivedAt": now_iso(),
                    })
                    last_chainlock = lock_hash
            except Exception:
                pass

        # Dropping the oldest rather than the newest: a stale sighting nobody
        # could push is worth less than the ones still arriving, and the gap
        # shows up as a missing host in the comparison either way.
        if len(queue) > MAX_QUEUE:
            del queue[: len(queue) - MAX_QUEUE]

        if time.monotonic() - last_clock >= CLOCK_REFRESH_SECONDS:
            offset = clock_offset_ms()
            last_clock = time.monotonic()

        if queue and time.monotonic() - last_push >= PUSH_SECONDS:
            push(queue, offset)
            last_push = time.monotonic()

        elapsed = time.monotonic() - loop_started
        time.sleep(max(0.0, POLL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
