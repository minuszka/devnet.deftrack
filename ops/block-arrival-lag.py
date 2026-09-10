#!/usr/bin/env python3
"""
How long after a block's own timestamp does this node actually connect it --
and when it is late, does the node name the peer that made it wait?

Why this exists. Two of the 60 InstantSend transactions measured on
2026-09-10 had no explanation: run 2's tx 16 was locked 342 s after
broadcast, and tx 17 was never locked at all. Both sit in the window in which
block 11059's *body* was late: its header time is 13:36:42Z, the seed
connected it at 13:39:34Z, and the seed's own log says why --

    Timeout downloading block ac62712c... from peer=577, disconnecting

-- after which the lock for tx 16 arrived 12 s later, from a different peer.
It was not the machine: devnet2, the second daemon on the same host, connected
the same block at 13:38:22Z with no timeout at all, and five fleet hosts saw it
at 16 s, 17 s, 96 s, 126 s and 278 s while the next block reached every one of
them within 5 s.

So "the quorum was slow" and "the lock never existed" are not the only
readings available when a lock is missing; "this node had not yet been given
the block" is a third, it is measurable, and on this devnet it is not rare.
Measured at the seed over 557 blocks (10531-11122, the rollout window and the
log-start catch-up excluded): median 2 s, p90 10 s, but 3.6 % of blocks land
more than 120 s late, and 11 of those 20 name a peer that was asked for the
body and did not send it -- twice, two peers in a row for one block.

Read-only: it runs RPC getters and reads a debug.log. Nothing is written.

    ops/block-arrival-lag.py                                  # this node, whole log
    ops/block-arrival-lag.py --from 10540 --exclude 10910-10935
    ops/block-arrival-lag.py --datadir /home/defcon/.defcon2  # the other daemon
    ops/block-arrival-lag.py --fixture ops/tests/fixtures/block-arrival-2026-09-10.json

The parsing, the arithmetic and the correlation are pure functions and are
tested in ops/tests/test_block_arrival_lag.py against a fixture read from the
chain, with a negative control: a log whose format the parser does not know
must report *nothing parsed*, never "nothing late".
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

TIP_RE = re.compile(r"^(?P<ts>\S+)Z UpdateTip: new best=(?P<hash>[0-9a-f]{64}) height=(?P<height>\d+)")
TIMEOUT_RE = re.compile(r"^(?P<ts>\S+)Z Timeout downloading block (?P<hash>[0-9a-f]{64}) from peer=(?P<peer>\d+)")

DEFAULT_THRESHOLDS = (30, 120)


def parse_time(stamp: str) -> datetime:
    """The node writes UTC without the offset; say so explicitly."""
    return datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)


def parse_log(lines):
    """
    -> ({height: {"seen": datetime, "hash": str}}, {block hash: [(datetime, peer)]})

    The first UpdateTip for a height wins: a later one is a reorg re-connect,
    which is a different question from when the node first had the block.
    """
    tips, timeouts = {}, {}
    for line in lines:
        m = TIP_RE.match(line)
        if m:
            height = int(m.group("height"))
            tips.setdefault(height, {"seen": parse_time(m.group("ts")), "hash": m.group("hash")})
            continue
        m = TIMEOUT_RE.match(line)
        if m:
            timeouts.setdefault(m.group("hash"), []).append((parse_time(m.group("ts")), m.group("peer")))
    return tips, timeouts


def lag_rows(tips, header_times):
    """
    -> [{"height", "hash", "lagSec"}], one per height whose header time is known.

    `header_times` maps a block hash to its header's `time` field (unix
    seconds). A block whose header time is ahead of the node's clock gives a
    negative lag; that is a clock statement, not a relay one, and it is kept
    rather than clipped so it stays visible.
    """
    rows = []
    for height in sorted(tips):
        h = tips[height]["hash"]
        if h not in header_times:
            continue
        header = datetime.fromtimestamp(header_times[h], timezone.utc)
        rows.append({"height": height, "hash": h, "lagSec": (tips[height]["seen"] - header).total_seconds()})
    return rows


def select(rows, first=None, last=None, exclude=()):
    """Drop heights outside [first, last] and inside any excluded range."""
    out = []
    for r in rows:
        if first is not None and r["height"] < first:
            continue
        if last is not None and r["height"] > last:
            continue
        if any(lo <= r["height"] <= hi for lo, hi in exclude):
            continue
        out.append(r)
    return out


def quantile(sorted_values, p):
    if not sorted_values:
        return None
    return sorted_values[min(len(sorted_values) - 1, int(p * len(sorted_values)))]


def summarise(rows, timeouts, thresholds=DEFAULT_THRESHOLDS):
    """
    The distribution, and for each threshold how many blocks exceed it and how
    many of those the node itself blamed on a peer. `blocks` is the number the
    percentages are over, so a caller can never quote a rate without its n.
    """
    values = sorted(r["lagSec"] for r in rows)
    summary = {
        "blocks": len(rows),
        "firstHeight": rows[0]["height"] if rows else None,
        "lastHeight": rows[-1]["height"] if rows else None,
        "minSec": values[0] if values else None,
        "medianSec": quantile(values, 0.5),
        "p90Sec": quantile(values, 0.9),
        "p99Sec": quantile(values, 0.99),
        "maxSec": values[-1] if values else None,
        "timeoutLines": sum(len(v) for v in timeouts.values()),
        "timeoutBlocks": len(timeouts),
        "late": {},
    }
    for th in thresholds:
        late = [r for r in rows if r["lagSec"] > th]
        named = [r for r in late if r["hash"] in timeouts]
        summary["late"][th] = {
            "blocks": len(late),
            "share": (len(late) / len(rows)) if rows else None,
            "withNamedPeer": len(named),
            "heights": [r["height"] for r in late],
        }
    return summary


def late_detail(rows, timeouts, threshold):
    """One row per late block, with the peers the node timed out on, in order."""
    out = []
    for r in rows:
        if r["lagSec"] <= threshold:
            continue
        peers = [p for _, p in timeouts.get(r["hash"], [])]
        out.append({"height": r["height"], "lagSec": r["lagSec"], "timedOutPeers": peers})
    return out


def render(summary, detail, threshold):
    lines = []
    if not summary["blocks"]:
        lines.append("no blocks parsed -- the log format did not match, which is not the same as nothing being late")
        return "\n".join(lines)
    lines.append(
        "blocks {blocks} ({firstHeight}-{lastHeight})  lag s: min {minSec:.0f}  median {medianSec:.0f}"
        "  p90 {p90Sec:.0f}  p99 {p99Sec:.0f}  max {maxSec:.0f}".format(**summary)
    )
    lines.append(
        "timeout lines {timeoutLines} over {timeoutBlocks} distinct blocks".format(**summary)
    )
    for th, s in sorted(summary["late"].items()):
        lines.append(
            "  > {:>4}s: {:3} blocks ({:.1f}% of {}), {} naming a peer".format(
                th, s["blocks"], 100.0 * s["share"], summary["blocks"], s["withNamedPeer"]
            )
        )
    if detail:
        lines.append("")
        lines.append("late blocks (> {}s):".format(threshold))
        for d in detail:
            peers = ", ".join(d["timedOutPeers"])
            lines.append(
                "  {:6} late {:5.0f}s{}".format(
                    d["height"], d["lagSec"], "  timed out on peer " + peers if peers else ""
                )
            )
    return "\n".join(lines)


def cli_factory(datadir, conf, binary):
    args = [binary]
    if datadir:
        args.append("-datadir=" + datadir)
    if conf:
        args.append("-conf=" + conf)

    def call(*rest):
        out = subprocess.run(args + list(rest), capture_output=True, text=True)
        if out.returncode:
            raise RuntimeError(out.stderr.strip()[:200])
        try:
            return json.loads(out.stdout)
        except json.JSONDecodeError:
            return out.stdout.strip()

    return call


def header_times_from_node(call, tips):
    """One getblockheader per height the log named. Read-only, and the slow part."""
    times = {}
    for height in sorted(tips):
        try:
            times[tips[height]["hash"]] = call("getblockheader", tips[height]["hash"])["time"]
        except (RuntimeError, KeyError, TypeError):
            continue
    return times


def parse_range(text):
    lo, _, hi = text.partition("-")
    return (int(lo), int(hi or lo))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datadir", default="/home/defcon/.defcon")
    ap.add_argument("--conf", default=None, help="defaults to <datadir>/defcon.conf when it exists")
    ap.add_argument("--binary", default="defcon-cli")
    ap.add_argument("--log", default=None, help="defaults to <datadir>/devnet-defcon-q60/debug.log")
    ap.add_argument("--from", dest="first", type=int, default=None)
    ap.add_argument("--to", dest="last", type=int, default=None)
    ap.add_argument("--exclude", action="append", default=[], metavar="LO-HI",
                    help="drop a height range (a rollout window, a reindex); repeatable")
    ap.add_argument("--threshold", type=int, default=120, help="the detail listing's cut, seconds")
    ap.add_argument("--json", action="store_true", help="print the summary as JSON instead")
    ap.add_argument("--fixture", default=None, help="a JSON {logLines, headerTimes} instead of a node")
    args = ap.parse_args(argv)

    if args.fixture:
        with open(args.fixture, encoding="utf-8") as f:
            fix = json.load(f)
        tips, timeouts = parse_log(fix["logLines"])
        header_times = fix["headerTimes"]
    else:
        log_path = args.log or os.path.join(args.datadir, "devnet-defcon-q60", "debug.log")
        conf = args.conf
        if conf is None:
            candidate = os.path.join(args.datadir, "defcon.conf")
            conf = candidate if os.path.exists(candidate) else None
        with open(log_path, encoding="utf-8", errors="replace") as f:
            tips, timeouts = parse_log(f)
        header_times = header_times_from_node(cli_factory(args.datadir, conf, args.binary), tips)

    rows = select(lag_rows(tips, header_times), args.first, args.last,
                  [parse_range(r) for r in args.exclude])
    summary = summarise(rows, timeouts)
    detail = late_detail(rows, timeouts, args.threshold)
    if args.json:
        print(json.dumps({"summary": summary, "late": detail}, indent=1))
    else:
        print(render(summary, detail, args.threshold))
    return 0 if summary["blocks"] else 1


if __name__ == "__main__":
    sys.exit(main())
