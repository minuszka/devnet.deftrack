#!/usr/bin/env python3
"""
The InstantSend signing-quorum selection, reproduced exactly, and the
verifier's re-derivation of it -- so a non-masternode's "invalid sig in
islock" can be predicted from a transaction's input alone.

Why this exists. Three declared runs on 2026-09-10 (60 transactions) found the
explorer's seed node -- and devnet2, a second observer -- rejecting InstantSend
locks the network held: the producer mined those transactions locked, the
blocks ChainLocked, and yet both onlookers logged `invalid sig in islock`. The
first reading was "near a DKG cycle boundary". It was wrong: the rejected
locks were sent mid-cycle with every node at the same tip. The rule below,
copied from the deployed Core commit and checked against 55 locks whose
signer the node named (getislocks.cycleHash), reproduces the signer 55/55 and
predicts every one of the five rejections from the input alone; a deliberately
wrong serialisation reproduces 6/18.

The rule (Core 25c3966adc):

  signer      SelectQuorumForSigning(params, chain, qman, requestId)
              -> pindexStart = tip - 8 (SIGN_HEIGHT_OFFSET, quorums.h:344);
                 candidates = ScanQuorums(type, pindexStart, signingActiveQuorumCount)
                 = the last N quorums whose commitment is mined at or before pindexStart;
                 score_i = SHA256d(uint8(type) || quorumHash_i || requestId), ascending by
                 memcmp on the digest; the first wins       (quorums.cpp:1330-1384)
              islock.cycleHash = the winner's base block hash  (instantsend.cpp:692-694;
                 for a non-rotated type the quorum base IS its cycle base)
  requestId   SHA256d(ser(std::string "islock") || ser(vector<COutPoint> inputs))
                                                             (instantsend.cpp:45-51)
  verifier    B = height(cycleHash); if B + dkgInterval < tip: nSignHeight = B + dkgInterval - 1
              attempt 1: signOffset 0  -> select at nSignHeight (or the tip);
              attempt 2, only after attempt 1 failed: signOffset dkgInterval -> 24 lower
                                                      (instantsend.cpp:862-875, 912-935)
              accepted iff the re-selected quorum is the signer's -- its public key is the
              only one the signature verifies against.
              Runs only when the ISLOCK arrives before the node holds the recovered
              signature (HasRecoveredSig, :907); the shortcut carries quorumHash and
              never rejects.

What it says: this is Dash's DIP0024 verifier for ROTATED quorums -- there
cycleHash plus quorumIndex reconstruct the signer exactly -- applied to a
NON-rotated InstantSend type. A lock signed by a quorum older than one cycle
is checked against {B and the three older quorums} where the signer chose
among {B and up to three newer ones}, and loses whenever an older quorum
outscores B: never at one cycle of age, about 1/5, 1/3 and 3/7 at two, three
and four. Harmless for safety (the masternodes hold the lock, the double
spend is still refused) and a delay for the payment: a rejected lock reaches
the node later by re-announcement after the recovered signature, or the
producer -- a non-masternode too -- mines it after the 120 s unlocked wait.

Usage:
    ops/islock-selection-reproduce.py --fixture ops/tests/fixtures/islock-selection-2026-09-10.json
    ops/islock-selection-reproduce.py --live <islocks.json> <seed debug.log>      # on the seed host

The pure parts are unit-tested in ops/tests/test_islock_selection.py against a
fixture read from the chain, with the serialisation as the negative control.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from datetime import datetime, timezone

SIGN_HEIGHT_OFFSET = 8


# ── pure parts ───────────────────────────────────────────────────────────────

def sha256d(data: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


def compact_size(n: int) -> bytes:
    if n < 253:
        return bytes([n])
    if n <= 0xFFFF:
        return b"\xfd" + struct.pack("<H", n)
    if n <= 0xFFFFFFFF:
        return b"\xfe" + struct.pack("<I", n)
    return b"\xff" + struct.pack("<Q", n)


def internal(hex_display: str) -> bytes:
    """A hash as the node holds it in memory: the display hex reversed."""
    return bytes.fromhex(hex_display)[::-1]


def request_id(inputs, prefix_mode: str = "string") -> bytes:
    """
    CInstantSendLock::GetRequestId: SHA256d over the serialised prefix and
    the serialised outpoints. `prefix_mode` exists for the negative control:
    "string" is the node's serialisation (compact size, then the bytes); "raw"
    drops the length and must NOT reproduce the signer.
    """
    prefix = b"islock"
    head = compact_size(len(prefix)) + prefix if prefix_mode == "string" else prefix
    body = compact_size(len(inputs)) + b"".join(
        internal(i["txid"]) + struct.pack("<I", int(i["vout"])) for i in inputs
    )
    return sha256d(head + body)


def score(llmq_type: int, quorum_hash_hex: str, selection_hash: bytes) -> bytes:
    """One candidate's score: SHA256d(uint8 type || quorumHash || selectionHash)."""
    return sha256d(bytes([llmq_type]) + internal(quorum_hash_hex) + selection_hash)


def active_at(quorums: dict, start_height: int, pool_size: int) -> list[int]:
    """
    ScanQuorums(type, chain[start], pool): the last `pool` quorums whose
    commitment is mined at or before `start`, newest first. `quorums` maps a
    base height (int or str) to {"quorumHash", "mined"}.
    """
    mined = sorted((int(q["mined"]), int(base)) for base, q in quorums.items() if int(q["mined"]) <= start_height)
    return [base for _, base in mined[-pool_size:]][::-1]


def select(quorums: dict, llmq_type: int, pool_size: int, start_height: int, selection_hash: bytes) -> int | None:
    """SelectQuorumForSigningAt for a non-rotated type: the min-score candidate's base height."""
    candidates = active_at(quorums, start_height, pool_size)
    if not candidates:
        return None
    scored = sorted(
        (score(llmq_type, quorums[str(b)]["quorumHash"] if str(b) in quorums else quorums[b]["quorumHash"], selection_hash), i, b)
        for i, b in enumerate(candidates)
    )
    return scored[0][2]


def signer_choice(quorums, llmq_type, pool_size, tip_at_sign, selection_hash):
    return select(quorums, llmq_type, pool_size, tip_at_sign - SIGN_HEIGHT_OFFSET, selection_hash)


def verifier_verdict(quorums, llmq_type, pool_size, interval, signer_base, tip_at_verify, selection_hash):
    """
    What a non-masternode's reconstruction decides for a lock signed by the
    quorum at `signer_base`: ("accept" | "accept2" | "REJECT", details).
    """
    if signer_base + interval < tip_at_verify:
        sign_height = signer_base + interval - 1
    else:
        sign_height = tip_at_verify
    first = select(quorums, llmq_type, pool_size, sign_height, selection_hash)
    if first == signer_base:
        return "accept", {"attempt1At": sign_height, "attempt1": first}
    second = select(quorums, llmq_type, pool_size, sign_height - interval, selection_hash)
    verdict = "accept2" if second == signer_base else "REJECT"
    return verdict, {"attempt1At": sign_height, "attempt1": first, "attempt2At": sign_height - interval, "attempt2": second}


def predict_case(fixture: dict, case: dict, prefix_mode: str = "string") -> dict:
    """
    One case of a fixture: the signer the rule names, whether that matches the
    cycleHash the node reported (positive control, when it did), and the
    verdict the reconstruction reaches. A case without cycleHash is an
    out-of-sample prediction: the node never told us the signer.
    """
    quorums = fixture["quorums"]
    llmq_type, pool, interval = fixture["llmqType"], fixture["signingActiveQuorumCount"], fixture["dkgInterval"]
    sel = request_id(case["inputs"], prefix_mode)
    tip = int(case["tipAtSend"])
    predicted_signer = signer_choice(quorums, llmq_type, pool, tip, sel)
    reported = case.get("signerBase")
    control = None if reported is None else (predicted_signer == int(reported))
    base = int(reported) if reported is not None else predicted_signer
    verdict, detail = verifier_verdict(quorums, llmq_type, pool, interval, base, tip, sel)
    return {"index": case.get("index"), "predictedSigner": predicted_signer, "reportedSigner": reported, "control": control, "verdict": verdict, **detail}


# ── the two entry points ─────────────────────────────────────────────────────

def run_fixture(path: str, prefix_mode: str) -> int:
    fixture = json.load(open(path, encoding="utf-8"))
    ok_ctrl = n_ctrl = ok_verdict = n_verdict = 0
    print(f"{'tx':>3} {'signer(pred)':>12} {'reported':>9} {'ctrl':<5} {'verdict':<8} {'seed':<7} {'a1@':>6} {'a1->':>6} {'a2@':>6} {'a2->':>6}")
    for case in fixture["cases"]:
        p = predict_case(fixture, case, prefix_mode)
        if p["control"] is not None:
            n_ctrl += 1
            ok_ctrl += p["control"]
        seed = case.get("seedVerdict", "?")
        matched = (p["verdict"] == "REJECT") == (seed == "reject")
        n_verdict += 1
        ok_verdict += matched
        print(
            f"{p['index']:>3} {str(p['predictedSigner']):>12} {str(p['reportedSigner']):>9} "
            f"{'OK' if p['control'] else ('pred' if p['control'] is None else 'MISS'):<5} {p['verdict']:<8} {seed:<7} "
            f"{p['attempt1At']:>6} {str(p['attempt1']):>6} {str(p.get('attempt2At', '')):>6} {str(p.get('attempt2', '')):>6}"
        )
    print(f"positive control (signer reproduced): {ok_ctrl}/{n_ctrl}")
    print(f"verdict matches the seed's: {ok_verdict}/{n_verdict}")
    return 0 if (ok_ctrl == n_ctrl and ok_verdict == n_verdict) else 1


def run_live(islocks_path: str, seed_log: str, prefix_mode: str) -> int:
    """
    On the seed host: read the quorum table from the node and the explorer,
    the tip timeline and each lock's verdict from the seed's debug.log, and
    compare. The host-bound imports live here so the pure parts stay pure.
    """
    import subprocess
    import urllib.request

    CLI = ["defcon-cli", "-datadir=/home/defcon/.defcon", "-conf=/home/defcon/.defcon/defcon.conf"]

    def cli(*args):
        out = subprocess.run(CLI + list(args), capture_output=True, text=True).stdout.strip()
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return out

    def api(path):
        with urllib.request.urlopen("http://localhost:4100/api/v1" + path, timeout=30) as r:
            return json.load(r)["data"]

    llmq_type, interval, pool = 7, 24, 4
    tip_now = cli("getblockcount")
    quorums = {}
    for base in range((tip_now // interval) * interval - interval * 14, tip_now + 1, interval):
        qh = cli("getblockhash", str(base))
        try:
            r = api(f"/quorum-rounds/{qh}")
        except Exception:
            continue
        if r.get("status") != "formed" or not r.get("minedBlockHash"):
            continue
        quorums[str(base)] = {"quorumHash": qh, "mined": cli("getblockheader", r["minedBlockHash"])["height"]}
    by_hash = {q["quorumHash"]: int(b) for b, q in quorums.items()}

    log = open(seed_log, encoding="utf-8", errors="replace").read().splitlines()
    tips = []
    for l in log:
        m = re.match(r"(\S+)Z UpdateTip: new best=\S+ height=(\d+)", l)
        if m:
            tips.append((datetime.fromisoformat(m.group(1)).replace(tzinfo=timezone.utc), int(m.group(2))))

    def tip_at(t):
        h = None
        for ts, height in tips:
            if ts <= t:
                h = height
            else:
                break
        return h

    fixture = {"llmqType": llmq_type, "dkgInterval": interval, "signingActiveQuorumCount": pool, "quorums": quorums, "cases": []}
    for d in json.load(open(islocks_path)):
        isl = d.get("islock")
        tip = tip_at(datetime.fromisoformat(d["sentAt"]))
        if isl and "cycleHash" in isl:
            inputs, reported = isl["inputs"], by_hash.get(isl["cycleHash"])
        elif d.get("input"):
            t, v = d["input"].split(":")
            inputs, reported = [{"txid": t, "vout": int(v)}], None
        else:
            continue
        invalid = any(d["txid"] in l and "invalid sig" in l for l in log)
        received = any(d["txid"] in l and "received islock" in l for l in log)
        fixture["cases"].append({"index": d["index"], "inputs": inputs, "tipAtSend": tip, "signerBase": reported, "seedVerdict": "reject" if invalid else ("accept" if received else "none")})
    tmp = islocks_path + ".fixture.json"
    json.dump(fixture, open(tmp, "w"), indent=1)
    print(f"fixture written: {tmp} ({len(fixture['cases'])} cases, {len(quorums)} quorums)")
    return run_fixture(tmp, prefix_mode)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fixture", help="a fixture file (quorum table + cases)")
    parser.add_argument("--live", nargs=2, metavar=("ISLOCKS_JSON", "SEED_LOG"), help="build the fixture on the seed host and run it")
    parser.add_argument("--prefix", choices=["string", "raw"], default="string", help='requestId prefix serialisation; "raw" is the negative control')
    args = parser.parse_args(argv)
    if args.fixture:
        return run_fixture(args.fixture, args.prefix)
    if args.live:
        return run_live(args.live[0], args.live[1], args.prefix)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
