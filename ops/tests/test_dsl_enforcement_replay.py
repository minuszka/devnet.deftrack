"""
ops/dsl-enforcement-replay.py against a synthetic fourteen-masternode chain
(fixtures/dsl-enforcement-replay-synthetic.json) built so that every branch of
CDeterministicMNList::ApplyServiceCommitment runs at least once -- including the
one no recorded devnet epoch has exercised: an UNOBSERVED verdict on a member
whose missed streak is live, which must hold the counter rather than heal it.

Fourteen members, not fewer: the first draft had six, where one missed
masternode is already 16.7% of the list and the 15% mass-outage guard swallowed
every epoch, so no counter ever moved. That is the guard doing its job on a
fixture that was too small, and it is kept in the fixture's comment as the
reason for the size.

The fourteen proTxHashes sort in the opposite order by display hex and by the
node's internal byte order, so a tool that sorts the display strings names the
wrong masternode at every index. That is the bug the real-data validation
caught on 2026-09-20 (five right heights, four wrong names); the fixture pins it.

Real-data validation is not repeated here (the base lists are 13 MB): on
2026-09-20 the tool reproduced the chain's own E1b events (suspended at 8496,
banned at 8520, recovered at 8568, the five host-1 masternodes), the 2026-09-03
shadow outage, the E2 guard at 23 of 152, the 100-epoch baseline (nobody) and
the node's live counters (152 of 152 equal).

    python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
"""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "dsl-enforcement-replay.py")
FIXTURE = os.path.join(HERE, "fixtures", "dsl-enforcement-replay-synthetic.json")

spec = importlib.util.spec_from_file_location("dsl_enforcement_replay", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with open(FIXTURE, encoding="utf-8") as f:
    FIX = json.load(f)

M = FIX["members"]
NAMES = "ABCDEFGHIJKLMN"
A, B, C, N = M["A"], M["B"], M["C"], M["N"]
DISPLAY_ORDER = [M[k] for k in NAMES]
BASE = {"mnList": [{"proRegTxHash": h, "confirmedHash": "00" * 32, "isValid": True} for h in DISPLAY_ORDER]}
BASES = {r["epoch"]: BASE for r in FIX["epochs"]}


def replay(enforce_from=1, upto=None, **kw):
    rows = [r for r in FIX["epochs"] if upto is None or r["epoch"] <= upto]
    rp, skipped = mod.run(rows, BASES, enforce_from, **kw)
    return rp, skipped


class CanonicalOrder(unittest.TestCase):
    def test_internal_byte_order_is_the_reverse_of_display_order_here(self):
        order = mod.canonical_order(BASE["mnList"])
        self.assertEqual(order, list(reversed(DISPLAY_ORDER)))
        self.assertEqual(order[13], A)
        self.assertEqual(order[0], N)
        # The display-sorted order is what a naive tool would use; it must differ.
        self.assertEqual(sorted(DISPLAY_ORDER), DISPLAY_ORDER)
        self.assertNotEqual(sorted(DISPLAY_ORDER), order)

    def test_internal_reverses_bytes(self):
        self.assertEqual(mod.internal("00" * 31 + "ff"), b"\xff" + b"\x00" * 31)


class Arithmetic(unittest.TestCase):
    def test_the_full_story_with_enforcement(self):
        rp, skipped = replay(enforce_from=1)
        self.assertEqual(skipped, 0)
        self.assertEqual([(e, k, p) for e, _, k, p in rp.events],
                         [(5, "suspended", A), (6, "banned", A), (9, "recovered", A)])
        # The ban height is the boundary block of the epoch that reached the count.
        self.assertEqual([h for _, h, k, _ in rp.events if k == "banned"], [168])
        # Final state: A recovered, B missed once at epoch 9, nobody else touched.
        self.assertEqual(rp.counter[A], 0)
        self.assertEqual(rp.counter[B], 1)
        self.assertEqual(rp.suspended, set())
        self.assertEqual(rp.banned, {})
        for k in NAMES[2:]:
            self.assertEqual(rp.counter[M[k]], 0, k)

    def test_counters_epoch_by_epoch(self):
        # A: 1..5 through epochs 2-6; frozen through 7 (absent) and 8 (mass outage); 0 at 9.
        for upto, want in {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 5, 8: 5, 9: 0, 10: 0}.items():
            rp, _ = replay(enforce_from=1, upto=upto)
            self.assertEqual(rp.counter[A], want, "A after epoch %d" % upto)
        # B: missed at 3 (1), UNOBSERVED at 4 while the streak is live -> still 1,
        # online at 5 -> 0, mass outage at 8 -> still 0, missed at 9 -> 1.
        for upto, want in {3: 1, 4: 1, 5: 0, 8: 0, 9: 1}.items():
            rp, _ = replay(enforce_from=1, upto=upto)
            self.assertEqual(rp.counter[B], want, "B after epoch %d" % upto)

    def test_suspension_and_ban_land_on_the_right_epochs(self):
        four, _ = replay(enforce_from=1, upto=5)
        self.assertEqual(four.suspended, {A})
        self.assertEqual(four.banned, {})
        five, _ = replay(enforce_from=1, upto=6)
        self.assertEqual(five.banned, {A: 168})

    def test_v1_epoch_observes_everyone(self):
        # Epoch 2 is format v1: no unobservedIndices field at all, and A's miss counts.
        rp, _ = replay(enforce_from=1, upto=2)
        self.assertEqual(rp.counter[A], 1)
        self.assertEqual(rp.hold_protected, 0)

    def test_shadow_counts_but_never_punishes(self):
        rp, _ = replay(enforce_from=None)
        self.assertEqual(rp.events, [])
        self.assertEqual(rp.suspended, set())
        self.assertEqual(rp.banned, {})
        # The counters are the same as under enforcement: shadow mode counts too.
        enforced, _ = replay(enforce_from=1)
        self.assertEqual(dict(rp.counter), dict(enforced.counter))

    def test_size_mismatch_is_skipped_with_a_warning(self):
        rp, _ = replay(enforce_from=1)
        self.assertTrue(any(w.startswith("epoch 10:") and "listSize" in w for w in rp.warnings))
        # Nothing from epoch 10 leaked into the state: C (index 11) was never counted
        # (epoch 8, its other miss, was a mass outage).
        self.assertEqual(rp.counter[C], 0)
        self.assertEqual(rp.table[-1][2], "size-mismatch")

    def test_branch_coverage_is_reported(self):
        rp, _ = replay(enforce_from=1)
        self.assertEqual(rp.hold_protected, 1)   # B at epoch 4
        self.assertEqual(rp.mass_protected, 1)   # A at epoch 8 (B and C had no streak there)
        self.assertEqual(rp.absent_frozen, 1)    # epoch 7 with A at 5


class CrossCheck(unittest.TestCase):
    def test_display_order_stored_list_is_flagged(self):
        # Epoch 3's stored list was built with display-order resolution on purpose.
        rp, _ = replay(enforce_from=1)
        flagged = [w for w in rp.warnings if "differ" in w]
        self.assertEqual(flagged, ["epoch 3: stored missedProTxHashes differ from index resolution"])
        # And the wrong stored names did not leak into the arithmetic: N and M stay clean.
        self.assertEqual(rp.counter[N], 0)
        self.assertEqual(rp.counter[M["M"]], 0)


class NegativeControls(unittest.TestCase):
    """Each control flips one rule and must change the answer; a control that leaves
    the answer unchanged would mean that rule is dead in the tool."""

    def test_unobserved_treated_as_online_heals_the_streak(self):
        held, _ = replay(enforce_from=1, upto=4)
        healed, _ = replay(enforce_from=1, upto=4, hold_unobserved=False)
        self.assertEqual(held.counter[B], 1)
        self.assertEqual(healed.counter[B], 0)
        self.assertEqual(held.hold_protected, 1)
        self.assertEqual(healed.hold_protected, 0)

    def test_guard_raised_lets_the_mass_outage_epoch_apply(self):
        guarded, _ = replay(enforce_from=1, upto=8)
        unguarded, _ = replay(enforce_from=1, upto=8, mass_outage_pct=40)
        # With the guard, epoch 8 changed nothing: A stays at 5, B and C at 0.
        self.assertEqual((guarded.counter[A], guarded.counter[B], guarded.counter[C]), (5, 0, 0))
        # Without it, all three misses count.
        self.assertEqual((unguarded.counter[A], unguarded.counter[B], unguarded.counter[C]), (6, 1, 1))
        self.assertEqual(guarded.mass_protected, 1)
        self.assertEqual(unguarded.mass_protected, 0)

    def test_thresholds_move_the_events(self):
        rp, _ = replay(enforce_from=1, suspend=2, ban=3)
        self.assertEqual([(e, k) for e, _, k, p in rp.events if p == A][:2], [(3, "suspended"), (4, "banned")])

    def test_enforcing_later_moves_the_events_but_not_the_counters(self):
        late, _ = replay(enforce_from=6)
        early, _ = replay(enforce_from=1)
        self.assertEqual(dict(late.counter), dict(early.counter))
        # Enforcement starting at epoch 6 finds A already at count 5: suspended and banned
        # in the same epoch, recovered at 9.
        self.assertEqual([(e, k) for e, _, k, p in late.events if p == A],
                         [(6, "suspended"), (6, "banned"), (9, "recovered")])


if __name__ == "__main__":
    unittest.main()
