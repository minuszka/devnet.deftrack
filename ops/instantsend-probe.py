#!/usr/bin/env python3
"""
InstantSend lock latency, measured from the seed's RPC, with block inclusion as
an outcome of its own.

The 2026-09-05 probe polled `getislocks`, and `HandleFullyConfirmedBlock`
prunes the very record it polled: one transaction of twenty was mined four
seconds after broadcast, its lock was gone before the poll could see it, and
scored naively that was a false "no lock". This one reads `getrawtransaction`'s
`instantlock`, which stays true through the ChainLock, and names what it saw:

  locked            the lock was observed while the transaction was still
                    unconfirmed; latency = first sighting - send, at the poll's
                    resolution, which is stated beside it
  mined-with-lock   first seen already in a block, with instantlock_internal
                    true: the lock exists and the poll missed the window; no
                    latency is claimed, and this is not a failure
  mined-lock-unknown first seen in a block that is already ChainLocked, with
                    no live lock: the ChainLock prunes the islock, so whether
                    one ever existed cannot be read from this node any more
  mined-unlocked    mined with neither a lock nor a ChainLock: the producer
                    waited out WAIT_FOR_ISLOCK_TIMEOUT, or held a lock this
                    node never received (2026-09-10: mined 27 s after
                    broadcast, which the assembler allows only for a locked
                    transaction -- the lock existed somewhere and not here)
  timeout           neither within --timeout; the last state seen is kept
  rejected          sendrawtransaction refused it; the reason is kept verbatim

It cannot read the notification: the seed publishes no InstantSend-lock ZMQ
topic (hashblock, hashchainlock, hashtx and sequence only, as of 2026-09-07),
so the resolution is the poll interval. RPC errors are counted per transaction
and never scored as an outcome -- a failed call is not a missing lock.

What it spends: --amount DFCN per transaction, from a DISTINCT mature output
each, to a fresh address of the same wallet, so nothing leaves the wallet but
fees. Outputs equal to the masternode collateral are never touched, and the
wallet is never allowed to pick its own inputs (it picks immature coinstakes;
see CLAUDE.md). It refuses to run with the InstantSend spork off, and a
--dry-run selects the inputs and stops before any wallet write.

Usage, on the explorer host (the RPC credentials come from the explorer's
.env and never leave it):

    ops/instantsend-probe.py --dry-run
    ops/instantsend-probe.py --count 20 --out /root/isprobe-$(date +%F).jsonl

--conflict offers, after the first lock, a second spend of the same input and
records the node's refusal verbatim. On a single node that only shows the
mempool refusing a double spend of a locked input (`tx-txlock-conflict`); the
version that proves InstantSend did the refusing needs a node that never saw
the first spend, i.e. a partition, and is a separate experiment.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import ROUND_DOWN, Decimal

COLLATERAL = Decimal("1000000")
SATOSHI = Decimal("0.00000001")
DEFAULT_ENV = "/opt/devnet-deftrack/app/.env"

OUTCOMES = ("locked", "mined-with-lock", "mined-lock-unknown", "mined-unlocked", "timeout", "rejected")


class RpcError(Exception):
    def __init__(self, code, message):
        super().__init__(f"{message} (code {code})")
        self.code = code
        self.message = message


class Rpc:
    """The node's JSON-RPC over HTTP, with nothing cached: every answer is an observation."""

    def __init__(self, host, port, user, password, timeout=30):
        self.url = f"http://{host}:{port}/"
        self.auth = base64.b64encode(f"{user}:{password}".encode()).decode()
        self.timeout = timeout
        self._id = 0

    def call(self, method, params=None):
        self._id += 1
        body = json.dumps({"jsonrpc": "1.0", "id": self._id, "method": method, "params": params or []}).encode()
        req = urllib.request.Request(
            self.url,
            data=body,
            headers={"Authorization": "Basic " + self.auth, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                out = json.loads(resp.read().decode(), parse_float=Decimal)
        except urllib.error.HTTPError as err:
            # The node answers 500 with a JSON body for an RPC-level error.
            try:
                out = json.loads(err.read().decode(), parse_float=Decimal)
            except Exception:
                raise RpcError(err.code, f"HTTP {err.code} from {method}") from err
        except urllib.error.URLError as err:
            raise RpcError(-1, f"{method}: {err.reason}") from err
        error = out.get("error")
        if error:
            raise RpcError(error.get("code", -1), error.get("message", "unknown error"))
        return out.get("result")


# ── pure parts, unit-tested ──────────────────────────────────────────────────

def parse_env(text):
    """KEY=value lines of a dotenv file; quotes stripped, comments and blanks ignored."""
    env = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        env[key.strip()] = value
    return env


def spork_active(sporks, now):
    """`spork show` gives an activation time per spork; active once it is in the past."""
    value = sporks.get("SPORK_2_INSTANTSEND_ENABLED")
    if value is None:
        return False
    try:
        return int(value) <= int(now)
    except (TypeError, ValueError):
        return False


def pick_utxos(utxos, count, amount, fee, exclude=COLLATERAL):
    """
    Distinct mature outputs, smallest first, never the collateral amount and
    never one the wallet cannot sign.

    Smallest first so the probe consumes the least valuable outputs, and a
    deterministic order so two runs pick the same inputs from the same wallet.
    """
    usable = []
    for utxo in utxos:
        if not utxo.get("spendable", False):
            continue
        value = Decimal(str(utxo["amount"]))
        if value == exclude:
            continue
        if value < amount + fee:
            continue
        usable.append((value, str(utxo["txid"]), int(utxo["vout"]), utxo))
    usable.sort(key=lambda entry: (entry[0], entry[1], entry[2]))
    return [entry[3] for entry in usable[:count]]


def classify(tx, sent_at, now, timeout):
    """
    One `getrawtransaction` observation, or None to keep polling.

    `instantlock` is islock OR chainlock -- the node's TxToJSON ORs the two --
    and `instantlock_internal` is the islock alone, which the ChainLock prunes.
    So the fields mean different things on either side of block inclusion.

    Unconfirmed: `instantlock` can only come from an islock, since there is no
    block to ChainLock yet, and a lock seen here is the only case in which a
    latency may be claimed.

    Mined: `instantlock_internal` true is a lock that still exists. False with
    `chainlock` true is UNKNOWABLE from this node -- the ChainLock has already
    pruned whatever lock there was. The 2026-09-10 run scored such a
    transaction "mined-with-lock" on `instantlock` alone, after polling it 734
    times unlocked: the true value came from the ChainLock, and the claim was
    the probe's, not the node's. False with `chainlock` false is a transaction
    mined without a lock this node knows of, and nothing has been pruned.
    """
    mined = bool(tx.get("blockhash"))
    if not mined:
        if tx.get("instantlock"):
            return "locked"
        if now - sent_at >= timeout:
            return "timeout"
        return None
    if tx.get("instantlock_internal"):
        return "mined-with-lock"
    if tx.get("chainlock"):
        return "mined-lock-unknown"
    return "mined-unlocked"


def fmt_amount(value):
    """A DFCN amount as the RPC wants it: eight decimals, rounded down, as a string."""
    return format(Decimal(value).quantize(SATOSHI, rounding=ROUND_DOWN), "f")


def summarise(results, poll_ms):
    """
    Counts per outcome, RPC errors counted apart, and latency statistics over
    the `locked` transactions only: the others carry no latency, and averaging
    a null as a zero is how a probe reports a lock that was never measured.
    """
    counts = {name: 0 for name in OUTCOMES}
    for result in results:
        counts[result["outcome"]] = counts.get(result["outcome"], 0) + 1
    latencies = sorted(
        int(result["latencyMs"])
        for result in results
        if result["outcome"] == "locked" and result.get("latencyMs") is not None
    )
    # The poll interval is the sleep between calls; the call itself takes
    # time too (about 90 ms on the seed, 2026-09-10), so the cadence the
    # latencies were actually read at is elapsed / observations, and that is
    # the resolution a latency carries -- not the nominal one.
    polled = [r for r in results if int(r.get("observations", 0)) > 0 and r.get("elapsedMs") is not None]
    effective = (
        int(round(sum(int(r["elapsedMs"]) for r in polled) / sum(int(r["observations"]) for r in polled)))
        if polled
        else None
    )
    summary = {
        "transactions": len(results),
        "outcomes": counts,
        "rpcErrors": sum(int(result.get("rpcErrors", 0)) for result in results),
        "resolutionMs": poll_ms,
        "effectiveResolutionMs": effective,
        "latency": None,
    }
    if latencies:
        p90_index = min(len(latencies) - 1, int(round(0.9 * (len(latencies) - 1))))
        summary["latency"] = {
            "n": len(latencies),
            "minMs": latencies[0],
            "medianMs": statistics.median(latencies),
            "p90Ms": latencies[p90_index],
            "maxMs": latencies[-1],
        }
    return summary


# ── the probe ────────────────────────────────────────────────────────────────

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def probe_one(rpc, utxo, dest, change, args):
    value = Decimal(str(utxo["amount"]))
    amount = Decimal(str(args.amount))
    fee = Decimal(str(args.fee))
    change_value = (value - amount - fee).quantize(SATOSHI, rounding=ROUND_DOWN)
    outputs = {dest: fmt_amount(amount)}
    if change_value > 0:
        outputs[change] = fmt_amount(change_value)

    record = {
        "input": f"{utxo['txid']}:{utxo['vout']}",
        "inputAmount": fmt_amount(value),
        "amount": fmt_amount(amount),
        "fee": fmt_amount(fee),
        "resolutionMs": args.poll_ms,
        "rpcErrors": 0,
        "observations": 0,
    }

    raw = rpc.call("createrawtransaction", [[{"txid": utxo["txid"], "vout": int(utxo["vout"])}], outputs])
    signed = rpc.call("signrawtransactionwithwallet", [raw])
    if not signed.get("complete"):
        record.update(outcome="rejected", reason="signing incomplete: " + json.dumps(signed.get("errors")))
        return record

    record["sentAt"] = now_iso()
    sent_at = time.monotonic()
    try:
        txid = rpc.call("sendrawtransaction", [signed["hex"]])
    except RpcError as err:
        record.update(outcome="rejected", reason=err.message)
        return record
    record["txid"] = txid

    poll_s = args.poll_ms / 1000.0
    outcome = None
    last = None
    while outcome is None:
        time.sleep(poll_s)
        now = time.monotonic()
        try:
            last = rpc.call("getrawtransaction", [txid, True])
            record["observations"] += 1
        except RpcError as err:
            # Counted, never scored. A node that did not answer said nothing
            # about the lock.
            record["rpcErrors"] += 1
            record["lastRpcError"] = err.message
            if now - sent_at >= args.timeout:
                outcome = "timeout"
            continue
        outcome = classify(last, sent_at, now, args.timeout)

    record["outcome"] = outcome
    record["decidedAt"] = now_iso()
    record["elapsedMs"] = int(round((now - sent_at) * 1000))
    record["latencyMs"] = record["elapsedMs"] if outcome == "locked" else None
    if last is not None:
        record["instantlock"] = bool(last.get("instantlock"))
        record["instantlockInternal"] = bool(last.get("instantlock_internal"))
        record["chainlock"] = bool(last.get("chainlock"))
        record["blockhash"] = last.get("blockhash")
        record["height"] = last.get("height")
    return record


def conflict_check(rpc, results, args):
    """
    Offer the node a second spend of an input it has already locked.

    What this shows on one node is the mempool refusing a double spend of a
    locked input; the reason is kept verbatim so a refusal for some other
    reason is not mistaken for InstantSend doing its job.
    """
    locked = [r for r in results if r["outcome"] in ("locked", "mined-with-lock") and r.get("txid")]
    if not locked:
        return {"attempted": False, "reason": "no locked transaction to conflict with"}
    # The most recently locked one, not the first: a twenty-transaction run
    # lasts a minute or more against 150 s blocks, so the first lock's input has
    # a fair chance of being mined by the time the conflict is offered, and a
    # spend of a mined input is refused as missing inputs -- which proves
    # nothing about the lock. The refusal reason is kept verbatim so the three
    # cases stay apart: tx-txlock-conflict is InstantSend refusing,
    # txn-mempool-conflict the plain mempool, bad-txns-inputs-missingorspent an
    # offer that came too late to test anything.
    target = locked[-1]
    txid, vout = target["input"].split(":")
    other = rpc.call("getnewaddress", ["isprobe-conflict"])
    amount = Decimal(target["inputAmount"]) - Decimal(str(args.fee))
    raw = rpc.call("createrawtransaction", [[{"txid": txid, "vout": int(vout)}], {other: fmt_amount(amount)}])
    signed = rpc.call("signrawtransactionwithwallet", [raw])
    if not signed.get("complete"):
        return {"attempted": False, "reason": "conflicting spend could not be signed"}
    try:
        accepted = rpc.call("sendrawtransaction", [signed["hex"]])
    except RpcError as err:
        return {"attempted": True, "input": target["input"], "lockedTxid": target["txid"], "refused": True, "reason": err.message}
    # A finding, not a success: the node took a spend that conflicts with a lock.
    return {"attempted": True, "input": target["input"], "lockedTxid": target["txid"], "refused": False, "acceptedTxid": accepted}


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", default=DEFAULT_ENV, help="dotenv with RPC_HOST/RPC_PORT/RPC_USER/RPC_PASS (default: the explorer's)")
    parser.add_argument("--rpc-host")
    parser.add_argument("--rpc-port")
    parser.add_argument("--rpc-user")
    parser.add_argument("--rpc-pass")
    parser.add_argument("--count", type=int, default=20, help="transactions to send (default 20)")
    parser.add_argument("--amount", default="1", help="DFCN per transaction, to the wallet's own address (default 1)")
    parser.add_argument("--fee", default="0.001", help="fee per transaction in DFCN (default 0.001)")
    parser.add_argument("--min-conf", type=int, default=26, help="input maturity in confirmations (default 26: past COINBASE_MATURITY)")
    parser.add_argument("--exclude-amount", default=str(COLLATERAL), help="never spend an output of exactly this amount (default: the collateral)")
    parser.add_argument("--poll-ms", type=int, default=100, help="poll interval, and therefore the latency resolution (default 100)")
    parser.add_argument("--timeout", type=float, default=180.0, help="seconds before a transaction is scored timeout (default 180)")
    parser.add_argument("--gap", type=float, default=2.0, help="seconds between sends (default 2)")
    parser.add_argument("--conflict", action="store_true", help="after the run, offer a conflicting spend of a locked input and record the refusal")
    parser.add_argument("--out", help="append one JSON line per transaction here (default: none)")
    parser.add_argument("--dry-run", action="store_true", help="select inputs and report the plan; write nothing to the wallet")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.count < 1:
        print("count must be at least 1", file=sys.stderr)
        return 2

    env = parse_env(open(args.env_file, encoding="utf-8").read()) if os.path.exists(args.env_file) else {}
    host = args.rpc_host or env.get("RPC_HOST", "127.0.0.1")
    port = args.rpc_port or env.get("RPC_PORT", "")
    user = args.rpc_user or env.get("RPC_USER", "")
    password = args.rpc_pass or env.get("RPC_PASS", "")
    if not port or not user:
        print(f"no RPC credentials: give --rpc-* or an env file with RPC_PORT and RPC_USER ({args.env_file})", file=sys.stderr)
        return 2
    rpc = Rpc(host, port, user, password)

    net = rpc.call("getnetworkinfo")
    tip = rpc.call("getblockcount")
    sporks = rpc.call("spork", ["show"])
    if not spork_active(sporks, time.time()):
        print("refusing: SPORK_2_INSTANTSEND_ENABLED is not active on this node", file=sys.stderr)
        return 3

    amount = Decimal(str(args.amount))
    fee = Decimal(str(args.fee))
    utxos = rpc.call("listunspent", [args.min_conf])
    chosen = pick_utxos(utxos, args.count, amount, fee, Decimal(str(args.exclude_amount)))
    if len(chosen) < args.count:
        print(
            f"refusing: {len(chosen)} usable output(s) at {args.min_conf}+ confirmations, {args.count} needed "
            f"(spendable, not {args.exclude_amount}, at least {fmt_amount(amount + fee)})",
            file=sys.stderr,
        )
        return 3

    plan = {
        "node": net.get("subversion"),
        "tip": tip,
        "count": args.count,
        "amount": fmt_amount(amount),
        "fee": fmt_amount(fee),
        "pollMs": args.poll_ms,
        "timeoutS": args.timeout,
        "inputs": [f"{u['txid'][:12]}…:{u['vout']} ({fmt_amount(Decimal(str(u['amount'])))})" for u in chosen],
        "dryRun": args.dry_run,
    }
    print(json.dumps(plan, indent=2, ensure_ascii=False))
    if args.dry_run:
        return 0

    dest = rpc.call("getnewaddress", ["isprobe"])
    change = rpc.call("getrawchangeaddress")
    out = open(args.out, "a", encoding="utf-8") if args.out else None

    results = []
    for index, utxo in enumerate(chosen, start=1):
        record = probe_one(rpc, utxo, dest, change, args)
        record["index"] = index
        results.append(record)
        line = json.dumps(record, default=str)
        if out:
            out.write(line + "\n")
            out.flush()
        latency = record.get("latencyMs")
        print(f"[{index}/{args.count}] {record['outcome']}" + (f" {latency} ms" if latency is not None else "") + (f" ({record['reason']})" if record.get("reason") else ""))
        if index < args.count:
            time.sleep(args.gap)

    summary = summarise(results, args.poll_ms)
    summary["startedTip"] = tip
    summary["endedTip"] = rpc.call("getblockcount")
    if args.conflict:
        summary["conflict"] = conflict_check(rpc, results, args)
    if out:
        out.write(json.dumps({"summary": summary}, default=str) + "\n")
        out.close()
    print(json.dumps({"summary": summary}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
