"""
The pure parts of ops/islock-selection-reproduce.py against a fixture read
from the chain on 2026-09-10 (run instantsend-q60-verify-reproduction): the
Q60 quorum table (base -> commitment hash and mined height) and five
transactions -- four whose signing quorum the seed reported through
getislocks.cycleHash, and one the seed rejected and therefore never described.

    python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
"""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "islock-selection-reproduce.py")
FIXTURE = os.path.join(HERE, "fixtures", "islock-selection-2026-09-10.json")

spec = importlib.util.spec_from_file_location("islock_selection", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with open(FIXTURE, encoding="utf-8") as f:
    FIX = json.load(f)


def reported_cases():
    return [c for c in FIX["cases"] if c.get("signerBase") is not None]


class Serialisation(unittest.TestCase):
    def test_compact_size_and_internal_byte_order(self):
        self.assertEqual(mod.compact_size(6), b"\x06")
        self.assertEqual(mod.compact_size(300), b"\xfd\x2c\x01")
        # A hash is held reversed from its display hex.
        self.assertEqual(mod.internal("00" * 31 + "ff"), b"\xff" + b"\x00" * 31)

    def test_request_id_is_stable_and_prefix_sensitive(self):
        inputs = FIX["cases"][0]["inputs"]
        self.assertEqual(mod.request_id(inputs), mod.request_id(inputs))
        self.assertNotEqual(mod.request_id(inputs), mod.request_id(inputs, "raw"))


class SignerSelection(unittest.TestCase):
    def test_reproduces_the_signer_the_node_reported_for_every_case(self):
        # Positive control: the rule names the quorum whose base the node put
        # in cycleHash. If this fails, nothing below may be believed.
        for c in reported_cases():
            with self.subTest(tx=c["index"]):
                p = mod.predict_case(FIX, c)
                self.assertEqual(p["predictedSigner"], c["signerBase"])
                self.assertTrue(p["control"])

    def test_the_wrong_serialisation_does_not_reproduce_it(self):
        # Negative control: dropping the prefix's length from the requestId
        # names a different quorum. A control that cannot fail proves nothing;
        # on this fixture it fails on every one of the four reported cases.
        misses = [c["index"] for c in reported_cases() if not mod.predict_case(FIX, c, "raw")["control"]]
        self.assertGreater(len(misses), 0)

    def test_candidates_are_the_last_four_mined_at_or_before_the_start(self):
        # tip 11104 -> start 11096: the quorum based 11088 is mined at 11099
        # and must not be a candidate yet; 11064 (mined 11075) must be.
        cands = mod.active_at(FIX["quorums"], 11104 - mod.SIGN_HEIGHT_OFFSET, FIX["signingActiveQuorumCount"])
        self.assertEqual(cands, [11064, 11040, 11016, 10992])
        self.assertNotIn(11088, cands)


class VerifierReconstruction(unittest.TestCase):
    def test_accepts_every_lock_the_seed_accepted(self):
        for c in reported_cases():
            with self.subTest(tx=c["index"]):
                self.assertEqual(c["seedVerdict"], "accept")
                self.assertEqual(mod.predict_case(FIX, c)["verdict"], "accept")

    def test_predicts_the_rejection_from_the_input_alone(self):
        # tx 10: the seed never held its islock, so the signer is the rule's
        # own prediction (base 11040, two cycles old at tip 11104). The
        # reconstruction selects at 11063 among {11040 and older} and picks
        # 10968; the retry at 11039 picks 10944; neither is the signer.
        (c,) = [c for c in FIX["cases"] if c["index"] == 10]
        p = mod.predict_case(FIX, c)
        self.assertIsNone(p["control"])
        self.assertEqual(p["predictedSigner"], 11040)
        self.assertEqual(p["verdict"], "REJECT")
        self.assertEqual((p["attempt1At"], p["attempt1"]), (11063, 10968))
        self.assertEqual((p["attempt2At"], p["attempt2"]), (11039, 10944))
        self.assertEqual(c["seedVerdict"], "reject")

    def test_the_newest_signer_is_accepted_while_the_next_commitment_is_outside_both_windows(self):
        # tx 3: base 11064 at tip 11104. 11064 + 24 = 11088 < 11104, so the
        # verifier does re-derive, at 11087 -- but the quorum based 11088 is
        # mined only at 11099, outside the signer's window (11096) and the
        # verifier's (11087) alike, so both see {11064, 11040, 11016, 10992}
        # and B wins both. The mismatch needs an OLDER quorum in the
        # verifier's set that the signer never weighed; here there is none.
        (c,) = [c for c in FIX["cases"] if c["index"] == 3]
        sel = mod.request_id(c["inputs"])
        verdict, detail = mod.verifier_verdict(FIX["quorums"], 7, 4, 24, 11064, 11104, sel)
        self.assertEqual(verdict, "accept")
        self.assertEqual(detail["attempt1At"], 11087)
        self.assertEqual(mod.active_at(FIX["quorums"], 11087, 4), mod.active_at(FIX["quorums"], 11096, 4))

    def test_the_verifier_selects_at_the_tip_only_while_the_signer_is_within_one_cycle(self):
        # A signer based at 11088 (mined 11099) checked at tip 11110:
        # 11088 + 24 = 11112 is not below 11110, so no re-derivation at
        # B + 23 -- the verifier selects at the tip itself.
        sel = mod.request_id(FIX["cases"][0]["inputs"])
        _, detail = mod.verifier_verdict(FIX["quorums"], 7, 4, 24, 11088, 11110, sel)
        self.assertEqual(detail["attempt1At"], 11110)


if __name__ == "__main__":
    unittest.main()
