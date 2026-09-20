#!/usr/bin/env python3
"""Replay the Sentinel layer's enforcement arithmetic over recorded commitments (G5).

The question that decides when punishment may be switched on -- "what would the
enforcement arithmetic have done to the commitments actually recorded?" -- can
be answered from the chain, with no chain change. This is a line-for-line port
of CDeterministicMNList::ApplyServiceCommitment (evo/deterministicmns.cpp:402-475,
v22.1.x at 0c758792ca), applied in epoch order:

  absent epoch       the function never runs: every counter is frozen
  removed member     in the base list but gone from the list at the boundary
                     (:423, "removed from the list since the epoch base"): skipped
  mass outage        missed*100 >= size*nDSLMassOutagePct: record the epoch, change nothing
  unobserved member  no verdict (format v2): change nothing; v1 observes everyone
  online member      counter = 0; if enforcing, the suspension and the DSL ban are cleared
  missed member      counter += 1; if enforcing, >= suspend -> suspended, >= ban -> banned
                     at the boundary height, once

Enforcement is decided the way the node decides it -- the boundary block's height
against nDSLEnforcementHeight (:419) -- with --enforce-from-height. The epoch form,
--enforce-from-epoch, is for counterfactual windows; mapping a height to "the epoch
that begins there" is one epoch late, because the commitment applied AT that height
belongs to the epoch that ends there (8304 on this devnet is epoch 345's boundary).

WHAT THIS IS, AND IS NOT. A first-order counterfactual: the arithmetic applied to
the commitments as they were recorded. Under real enforcement a DSL ban sets
isValid=false, which changes the sentinel assignment and who can report at all,
so the later commitments would not have been the same ones. That answers the G5
gate ("would anyone have been punished in this window?"); it is not a proof that
enforcement is safe.

Inputs are the explorer's epoch rows (GET /api/v1/dsl/epochs, saved to a file)
and the deterministic masternode list at every epoch base (a JSONL written by
ops/dsl-baselists-dump.sh from `protx diff 1 <base>`). The base list is needed
because the commitment's bit order is that list sorted by proTxHash -- in the
node's INTERNAL byte order, which is the display hex reversed bytewise. Sorting
the display strings names the wrong masternodes. The list at an epoch's boundary
is the next epoch's base list (base(k+1) == boundary(k)); a member of base(k)
missing from it was removed during the epoch and is skipped as the node skips
it. Without that next list every base member is counted, and the run says so.

Three checks, and what each is worth. The stored proTxHash lists are compared
against the index resolution, so a wrong sort cannot pass silently -- but both
sides are ports of the same ordering rule, not an oracle. --expect compares the
events inside the window with the declared stopped set, and assumes a clean
starting state (no live streak at the window's first epoch; both recorded
outage runs began that way). --compare-counters is the only oracle -- the node's
own missedServiceEpochs -- and it discriminates only while streaks are live: at
a quiet tip every counter is 0 and an all-zero replay passes it too. Capture
that snapshot during an outage run; the tool says when the comparison is empty.

Validated 2026-09-20 against every window with a known answer: the shadow
outage of 2026-09-03 (five stopped -> exactly the five suspended and banned),
E1b of 2026-09-05 where the chain itself enforced from height 8304 (suspended
at 8496, banned at 8520, recovered at 8568 -- the replay reproduces those
heights and names), E2 of 2026-09-06 (the 15% guard opens at 23 of 152 and
nobody is suspended), the 100-epoch baseline of 2026-09-15 (nobody), and the
whole history against the node's counters (152 of 152 equal -- all zero at that
tip, so that one carried no weight). Raising the guard to 16% suspends 21 in
E2, which is the control that the guard branch is live.

    ops/dsl-enforcement-replay.py --epochs epochs.json --baselists baselists.jsonl \\
        --from-epoch 581 --to-epoch 680 --enforce-from-epoch 581 [--expect stopped.json]
    ops/dsl-enforcement-replay.py --epochs epochs.json --baselists baselists.jsonl \\
        --from-epoch 340 --to-epoch 360 --enforce-from-height 8304 --expect e1b.json

Read-only over its input files; it never talks to a node.
"""
import argparse
import collections
import json
import sys

UNSET_BAN = -1


def internal(h):
    """A hash as the node holds it: the display hex reversed bytewise."""
    return bytes.fromhex(h)[::-1]


def canonical_order(mn_list):
    """The commitment's bit order: the epoch-base list sorted by proTxHash the way
    uint256 sorts -- base_blob::Compare is a memcmp over the internal bytes."""
    return sorted((m["proRegTxHash"] for m in mn_list), key=internal)


def load_epochs(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["data"]["items"] if isinstance(data, dict) and "data" in data else data
    return sorted(rows, key=lambda e: e["epoch"])


def load_baselists(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                e = json.loads(line)
                out[int(e["epoch"])] = e
    return out


def boundary_list(bases, row):
    """The set of proTxHashes on the list at the epoch's boundary block -- the next
    epoch's base list, since base(k+1) == boundary(k). None when the dump does not
    hold it, or holds it at a different height (then it is not that block's list)."""
    nxt = bases.get(row["epoch"] + 1)
    if nxt is None:
        return None
    if nxt.get("base") is not None and nxt["base"] != row["boundaryHeight"]:
        return None
    return {m["proRegTxHash"] for m in nxt["mnList"]}


class Replay:
    """State of every masternode's Sentinel counters, advanced one epoch at a time."""

    def __init__(self, suspend=4, ban=5, mass_outage_pct=15, hold_unobserved=True):
        self.suspend, self.ban, self.mass_pct = suspend, ban, mass_outage_pct
        self.hold_unobserved = hold_unobserved
        self.counter = collections.defaultdict(int)   # proTxHash -> nMissedEpochs
        self.suspended = set()                         # fRewardSuspended
        self.banned = {}                               # proTxHash -> nDSLBanHeight
        self.last_epoch = {}                           # nLastServiceEpoch
        self.events = []                               # (epoch, height, kind, proTxHash)
        self.table = []                                # per-epoch rows
        self.warnings = []
        # Branch coverage: how often a protective branch guarded a member that had a
        # streak to protect. A window where these stay at zero has not exercised
        # that branch, and a control that flips it cannot discriminate there.
        self.hold_protected = 0    # unobserved member with counter > 0
        self.mass_protected = 0    # mass-outage epoch skipping a member with counter > 0
        self.absent_frozen = 0     # absent epoch while any counter was > 0
        self.removed_skipped = 0   # member-epochs skipped because the member had left the list

    def apply(self, row, base, enforce, present=None):
        """One epoch. `present` is the set of proTxHashes on the list at the boundary
        block (None: unknown, every base member is counted)."""
        epoch, height = row["epoch"], row["boundaryHeight"]
        if row["status"] != "committed":
            if any(self.counter.values()):
                self.absent_frozen += 1
            self.table.append((epoch, height, "absent", None, None, None, len(self.suspended), len(self.banned)))
            return
        order = canonical_order(base["mnList"])
        size = len(order)
        if row["listSize"] != size:
            self.warnings.append("epoch %d: listSize %s != base list %d" % (epoch, row["listSize"], size))
            self.table.append((epoch, height, "size-mismatch", None, None, None, len(self.suspended), len(self.banned)))
            return
        if present is None:
            self.warnings.append("epoch %d: no list at the boundary %d (the next epoch's base): "
                                 "a member removed during the epoch would be counted" % (epoch, height))
        missed_idx = set(row.get("missedIndices") or [])
        unobs_idx = set(row.get("unobservedIndices") or [])
        missed = {order[i] for i in missed_idx if i < size}
        unobserved = {order[i] for i in unobs_idx if i < size} if self.hold_unobserved else set()
        stored = set(row.get("missedProTxHashes") or [])
        if stored and stored != missed:
            self.warnings.append("epoch %d: stored missedProTxHashes differ from index resolution" % epoch)
        missed_count = len(missed_idx)
        mass = size > 0 and missed_count * 100 >= size * self.mass_pct
        for p in order:
            if present is not None and p not in present:
                # deterministicmns.cpp:423 -- GetMN() finds nothing, the node skips it
                self.removed_skipped += 1
                continue
            self.last_epoch[p] = epoch
            if mass:
                if self.counter[p]:
                    self.mass_protected += 1
                continue
            if p in unobserved:
                if self.counter[p]:
                    self.hold_protected += 1
                continue
            if p not in missed:
                if self.counter[p] != 0 and enforce and (p in self.suspended or p in self.banned):
                    self.events.append((epoch, height, "recovered", p))
                self.counter[p] = 0
                if enforce:
                    self.suspended.discard(p)
                    self.banned.pop(p, None)
            else:
                self.counter[p] += 1
                if enforce:
                    if self.counter[p] >= self.suspend and p not in self.suspended:
                        self.suspended.add(p)
                        self.events.append((epoch, height, "suspended", p))
                    if self.counter[p] >= self.ban and p not in self.banned:
                        self.banned[p] = height
                        self.events.append((epoch, height, "banned", p))
        self.table.append((epoch, height, "mass-outage" if mass else "applied", size, missed_count,
                           len(unobs_idx), len(self.suspended), len(self.banned)))


def run(rows, bases, enforce_from=None, enforce_from_height=None, **kw):
    rp = Replay(**kw)
    skipped = 0
    for r in rows:
        base = bases.get(r["epoch"])
        if r["status"] == "committed" and base is None:
            rp.warnings.append("epoch %d: no base list" % r["epoch"])
            skipped += 1
            continue
        # The node's rule is by height (:419); the epoch form is for counterfactual windows.
        enforce = ((enforce_from is not None and r["epoch"] >= enforce_from) or
                   (enforce_from_height is not None and r["boundaryHeight"] >= enforce_from_height))
        rp.apply(r, base, enforce, boundary_list(bases, r))
    return rp, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--epochs", required=True, help="JSON: the /api/v1/dsl/epochs rows (envelope or bare list)")
    ap.add_argument("--baselists", required=True, help="JSONL from ops/dsl-baselists-dump.sh")
    ap.add_argument("--from-epoch", type=int)
    ap.add_argument("--to-epoch", type=int)
    enf = ap.add_mutually_exclusive_group()
    enf.add_argument("--enforce-from-epoch", type=int,
                     help="counterfactual: apply the enforcing branch from this epoch (default: never, i.e. shadow)")
    enf.add_argument("--enforce-from-height", type=int,
                     help="the node's rule: enforce when the boundary block's height >= this (nDSLEnforcementHeight)")
    ap.add_argument("--suspend", type=int, default=4)
    ap.add_argument("--ban", type=int, default=5)
    ap.add_argument("--mass-outage-pct", type=int, default=15)
    ap.add_argument("--no-hold-unobserved", action="store_true",
                    help="CONTROL: treat unobserved members as online, the v1 healing that v2 ended")
    ap.add_argument("--expect", help='JSON {"stopped": [proTxHash...], "note": "..."}: the G5 verdict against it '
                                     '(events inside the window only; assumes no live streak at the first epoch)')
    ap.add_argument("--compare-counters", help="JSON {proTxHash: missedServiceEpochs} from the node -- the oracle, "
                                               "but only a snapshot with live streaks can discriminate")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    rows = load_epochs(a.epochs)
    if a.from_epoch is not None:
        rows = [r for r in rows if r["epoch"] >= a.from_epoch]
    if a.to_epoch is not None:
        rows = [r for r in rows if r["epoch"] <= a.to_epoch]
    if not rows:
        sys.exit("no epochs in range")
    rp, skipped = run(rows, load_baselists(a.baselists), a.enforce_from_epoch, a.enforce_from_height,
                      suspend=a.suspend, ban=a.ban, mass_outage_pct=a.mass_outage_pct,
                      hold_unobserved=not a.no_hold_unobserved)

    committed = [t for t in rp.table if t[2] in ("applied", "mass-outage")]
    absent = [t for t in rp.table if t[2] == "absent"]
    mass = [t for t in rp.table if t[2] == "mass-outage"]
    print("window: epochs %d..%d (%d rows: %d committed, %d absent, %d mass-outage, %d skipped)" %
          (rows[0]["epoch"], rows[-1]["epoch"], len(rows), len(committed), len(absent), len(mass), skipped))
    if a.enforce_from_height is not None:
        enforcing = "height %d (boundary blocks >= it, the node's rule)" % a.enforce_from_height
    elif a.enforce_from_epoch is not None:
        enforcing = "epoch %d" % a.enforce_from_epoch
    else:
        enforcing = "never (shadow)"
    print("rules: suspend >= %d, ban >= %d, mass-outage >= %d%%, unobserved %s; enforcing from %s" %
          (a.suspend, a.ban, a.mass_outage_pct, "held" if not a.no_hold_unobserved else "TREATED AS ONLINE (control)",
           enforcing))
    if a.verbose:
        print("\nepoch  height  state         size  missed  unobs  susp  banned")
        for e, h, st, sz, mc, uo, ns, nb in rp.table:
            print("%5d  %6d  %-12s  %4s  %6s  %5s  %4d  %6d" % (
                e, h, st, "-" if sz is None else sz, "-" if mc is None else mc, "-" if uo is None else uo, ns, nb))
    print()
    ev = collections.Counter(k for _, _, k, _ in rp.events)
    print("events: %s" % (dict(ev) if ev else "none"))
    for e, h, k, p in rp.events:
        print("  epoch %d @%d %-9s %s" % (e, h, k, p[:12]))
    nonzero = {p: c for p, c in rp.counter.items() if c}
    print("final: %d members with a non-zero counter, %d suspended, %d banned" % (len(nonzero), len(rp.suspended), len(rp.banned)))
    for p, c in sorted(nonzero.items(), key=lambda kv: -kv[1])[:12]:
        print("  %s counter=%d%s%s" % (p[:12], c, " SUSPENDED" if p in rp.suspended else "",
                                       " BANNED@%d" % rp.banned[p] if p in rp.banned else ""))
    print("branch coverage (member-epochs where a protective branch guarded a non-zero counter): "
          "unobserved-hold %d, mass-outage %d; absent epochs while any counter was non-zero: %d; "
          "members skipped as removed before the boundary: %d"
          % (rp.hold_protected, rp.mass_protected, rp.absent_frozen, rp.removed_skipped))
    if rp.hold_protected == 0:
        print("  NOTE: the unobserved-hold branch never guarded a streak in this window; a control that flips it cannot discriminate here")
    for w in rp.warnings:
        print("warning:", w)

    rc = 0
    if a.expect:
        with open(a.expect, encoding="utf-8") as f:
            exp = json.load(f)
        stopped = set(exp["stopped"])
        print("\nG5 verdict against '%s' (%d stopped; events inside the window, clean start assumed):"
              % (exp.get("note", a.expect), len(stopped)))
        for name, got in (("suspended", {p for _, _, k, p in rp.events if k == "suspended"}),
                          ("banned", {p for _, _, k, p in rp.events if k == "banned"})):
            extra, missing = got - stopped, stopped - got
            ok = not extra and not missing
            print("  %-9s %s  (got %d, expected %d%s%s)" % (
                name, "PASS" if ok else "FAIL", len(got), len(stopped),
                "; EXTRA " + ",".join(p[:8] for p in sorted(extra)) if extra else "",
                "; MISSING " + ",".join(p[:8] for p in sorted(missing)) if missing else ""))
            rc |= 0 if ok else 1
    if a.compare_counters:
        with open(a.compare_counters, encoding="utf-8") as f:
            node = {k: int(v) for k, v in json.load(f).items()}
        diffs = [(p, rp.counter.get(p, 0), n) for p, n in node.items() if rp.counter.get(p, 0) != n]
        live = sum(1 for n in node.values() if n)
        print("\ncounter cross-check against the node: %d members compared, %d differ; node counters non-zero: %d"
              % (len(node), len(diffs), live))
        if live == 0:
            print("  NOTE: every node counter is 0 -- an all-zero replay passes this too; the check discriminates "
                  "only on a snapshot taken while streaks are live (during an outage run)")
        for p, mine, theirs in diffs[:10]:
            print("  %s replay=%d node=%d" % (p[:12], mine, theirs))
        rc |= 0 if not diffs else 2
    sys.exit(rc)


if __name__ == "__main__":
    main()
