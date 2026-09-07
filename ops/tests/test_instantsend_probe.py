"""
The pure parts of ops/instantsend-probe.py: what an observation means, which
inputs may be spent, and what a summary may claim. Nothing here talks to a
node; the RPC and the wallet are exercised by running the probe with
--dry-run on the host.

    python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
"""
import importlib.util
import os
import unittest
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "instantsend-probe.py")

spec = importlib.util.spec_from_file_location("instantsend_probe", SCRIPT)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ParseEnv(unittest.TestCase):
    def test_reads_quoted_and_bare_values_and_skips_noise(self):
        env = probe.parse_env('# explorer\nRPC_HOST=127.0.0.1\nRPC_PORT="19798"\nRPC_USER=\'u\'\n\nnot a pair\nRPC_PASS=a=b=c\n')
        self.assertEqual(env["RPC_HOST"], "127.0.0.1")
        self.assertEqual(env["RPC_PORT"], "19798")
        self.assertEqual(env["RPC_USER"], "u")
        # Only the first '=' splits; a password may contain more.
        self.assertEqual(env["RPC_PASS"], "a=b=c")
        self.assertNotIn("not a pair", env)


class SporkGate(unittest.TestCase):
    def test_active_when_the_activation_time_is_past(self):
        # 0 is how an active spork reads on this devnet: enabled since the epoch.
        self.assertTrue(probe.spork_active({"SPORK_2_INSTANTSEND_ENABLED": 0}, now=1_757_000_000))
        self.assertTrue(probe.spork_active({"SPORK_2_INSTANTSEND_ENABLED": "1756000000"}, now=1_757_000_000))

    def test_off_when_in_the_future_missing_or_unreadable(self):
        self.assertFalse(probe.spork_active({"SPORK_2_INSTANTSEND_ENABLED": 4_000_000_000}, now=1_757_000_000))
        self.assertFalse(probe.spork_active({}, now=1_757_000_000))
        self.assertFalse(probe.spork_active({"SPORK_2_INSTANTSEND_ENABLED": "soon"}, now=1_757_000_000))


class PickingInputs(unittest.TestCase):
    def utxo(self, txid, vout, amount, spendable=True):
        return {"txid": txid, "vout": vout, "amount": Decimal(amount), "spendable": spendable}

    def test_smallest_usable_first_never_the_collateral_and_never_unspendable(self):
        utxos = [
            self.utxo("c", 0, "1000000"),          # the collateral: never
            self.utxo("b", 1, "5000"),
            self.utxo("a", 0, "9999.99"),
            self.utxo("w", 0, "4000", spendable=False),  # watch-only: cannot sign
            self.utxo("t", 0, "0.5"),              # below amount + fee
            self.utxo("b", 0, "5000"),
        ]
        chosen = probe.pick_utxos(utxos, 3, Decimal("1"), Decimal("0.001"))
        self.assertEqual([(u["txid"], u["vout"]) for u in chosen], [("b", 0), ("b", 1), ("a", 0)])

    def test_returns_fewer_than_asked_rather_than_reusing_one(self):
        chosen = probe.pick_utxos([self.utxo("a", 0, "5000")], 3, Decimal("1"), Decimal("0.001"))
        self.assertEqual(len(chosen), 1)

    def test_a_string_amount_from_the_wire_is_read_exactly(self):
        chosen = probe.pick_utxos([{"txid": "a", "vout": 0, "amount": "4999.99", "spendable": True}], 1, Decimal("1"), Decimal("0.001"))
        self.assertEqual(len(chosen), 1)


class Classifying(unittest.TestCase):
    def test_a_lock_on_an_unconfirmed_transaction_is_the_only_case_with_a_latency(self):
        self.assertEqual(probe.classify({"instantlock": True}, sent_at=0, now=1.2, timeout=180), "locked")

    def test_mined_is_told_apart_by_whether_the_lock_survived(self):
        # `instantlock` stays true through the ChainLock; `instantlock_internal`
        # does not, and is deliberately not consulted.
        self.assertEqual(probe.classify({"instantlock": True, "instantlock_internal": False, "blockhash": "b"}, 0, 5, 180), "mined-with-lock")
        self.assertEqual(probe.classify({"instantlock": False, "blockhash": "b"}, 0, 5, 180), "mined-unlocked")

    def test_keeps_polling_until_the_timeout_and_then_says_so(self):
        self.assertIsNone(probe.classify({"instantlock": False}, sent_at=0, now=10, timeout=180))
        self.assertEqual(probe.classify({"instantlock": False}, sent_at=0, now=180, timeout=180), "timeout")


class Summarising(unittest.TestCase):
    def result(self, outcome, latency=None, errors=0):
        return {"outcome": outcome, "latencyMs": latency, "rpcErrors": errors}

    def test_latency_is_over_locked_transactions_only_and_errors_are_counted_apart(self):
        summary = probe.summarise(
            [
                self.result("locked", 1143),
                self.result("locked", 768, errors=2),
                self.result("locked", 2020),
                self.result("mined-with-lock"),
                self.result("mined-unlocked", errors=1),
                self.result("rejected"),
            ],
            poll_ms=100,
        )
        self.assertEqual(summary["transactions"], 6)
        self.assertEqual(summary["outcomes"]["locked"], 3)
        self.assertEqual(summary["outcomes"]["mined-with-lock"], 1)
        self.assertEqual(summary["outcomes"]["timeout"], 0)
        self.assertEqual(summary["rpcErrors"], 3)
        self.assertEqual(summary["resolutionMs"], 100)
        self.assertEqual(summary["latency"], {"n": 3, "minMs": 768, "medianMs": 1143, "p90Ms": 2020, "maxMs": 2020})

    def test_no_lock_means_no_latency_not_zero(self):
        summary = probe.summarise([self.result("mined-with-lock"), self.result("timeout")], poll_ms=100)
        self.assertIsNone(summary["latency"])

    def test_amounts_are_eight_decimals_rounded_down(self):
        self.assertEqual(probe.fmt_amount(Decimal("4998.988999999")), "4998.98899999")
        self.assertEqual(probe.fmt_amount(Decimal("1")), "1.00000000")


if __name__ == "__main__":
    unittest.main()
