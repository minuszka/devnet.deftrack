"""
The pure parts of ops/block-arrival-lag.py against a fixture read from the
seed on 2026-09-10: every UpdateTip line for heights 11040-11122, the one
`Timeout downloading block` line inside that range, and each of those blocks'
header times.

The case the fixture exists for is block 11059 -- header time 13:36:42Z,
connected at 13:39:34Z, 172 s, with the node naming peer 577. Two of the 60
InstantSend transactions measured that day are in that window and had no other
explanation.

Two negative controls, because the failure this tool must never produce is a
confident "nothing was late":

  * a log whose format the parser does not know must report *nothing parsed*
    and say so, rather than an empty late list over zero blocks;
  * header times moved forward so that no block is late must keep all 83
    blocks and report 0 late -- the other half of the same distinction.

    python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
"""
import importlib.util
import json
import os
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "block-arrival-lag.py")
FIXTURE = os.path.join(HERE, "fixtures", "block-arrival-2026-09-10.json")

spec = importlib.util.spec_from_file_location("block_arrival_lag", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with open(FIXTURE, encoding="utf-8") as f:
    FIX = json.load(f)

LATE_HEIGHT = 11059
LATE_HASH = "ac62712cc66349eabfaad62d79bc0f194c2c9dc7678768d88e117bbc3a25e903"


def parsed():
    return mod.parse_log(FIX["logLines"])


def rows():
    tips, _ = parsed()
    return mod.lag_rows(tips, FIX["headerTimes"])


class Parsing(unittest.TestCase):
    def test_reads_every_updatetip_and_the_timeout(self):
        tips, timeouts = parsed()
        # 85 UpdateTip lines over 83 heights: the window really contains a
        # one-block reorg (11107 connected twice, under two different hashes)
        # and one re-connect of the same hash (11106).
        self.assertEqual(len(FIX["logLines"]) - 1, 85)
        self.assertEqual(len(tips), 83)
        self.assertEqual(min(tips), 11040)
        self.assertEqual(max(tips), 11122)
        self.assertEqual(list(timeouts), [LATE_HASH])
        self.assertEqual(timeouts[LATE_HASH], [(datetime(2026, 9, 10, 13, 39, 18, tzinfo=timezone.utc), "577")])

    def test_timestamps_are_utc(self):
        tips, _ = parsed()
        self.assertEqual(tips[LATE_HEIGHT]["seen"].tzinfo, timezone.utc)
        self.assertEqual(tips[LATE_HEIGHT]["seen"].hour, 13)

    def test_first_sight_wins_over_a_later_reconnect(self):
        # A reorg re-connects a height; the question is when the node first
        # had that block, so the second line must not overwrite the first.
        line = "2026-09-10T13:39:34Z UpdateTip: new best={} height={} version=0x20000000".format(LATE_HASH, LATE_HEIGHT)
        later = "2026-09-10T14:00:00Z UpdateTip: new best={} height={} version=0x20000000".format(LATE_HASH, LATE_HEIGHT)
        tips, _ = mod.parse_log([line, later])
        self.assertEqual(tips[LATE_HEIGHT]["seen"].hour, 13)

    def test_a_reorged_height_keeps_the_first_hash_the_node_had(self):
        import re
        seen = [re.match(r"^\S+Z UpdateTip: new best=([0-9a-f]{64}) height=11107 ", l)
                for l in FIX["logLines"]]
        hashes = [m.group(1) for m in seen if m]
        self.assertEqual(len(hashes), 2)
        self.assertNotEqual(hashes[0], hashes[1])
        self.assertEqual(parsed()[0][11107]["hash"], hashes[0])

    def test_an_unknown_log_format_parses_to_nothing(self):
        # The negative control: mangle the two line shapes the parser knows.
        mangled = [l.replace("UpdateTip:", "UpdateTop:").replace("Timeout downloading block", "Timeout fetching block")
                   for l in FIX["logLines"]]
        tips, timeouts = mod.parse_log(mangled)
        self.assertEqual(tips, {})
        self.assertEqual(timeouts, {})
        summary = mod.summarise(mod.lag_rows(tips, FIX["headerTimes"]), timeouts)
        self.assertEqual(summary["blocks"], 0)
        self.assertIn("no blocks parsed", mod.render(summary, [], 120))


class Lag(unittest.TestCase):
    def test_the_late_block_is_the_one_the_node_blamed_on_a_peer(self):
        r = {x["height"]: x for x in rows()}
        self.assertAlmostEqual(r[LATE_HEIGHT]["lagSec"], 172.0, places=0)
        neighbours = [r[h]["lagSec"] for h in (11057, 11058, 11060, 11061) if h in r]
        self.assertTrue(all(v <= 11 for v in neighbours), neighbours)

    def test_distribution_over_the_window(self):
        summary = mod.summarise(rows(), parsed()[1])
        self.assertEqual(summary["blocks"], 83)  # 85 heights, two without a header time in the fixture
        self.assertEqual(summary["firstHeight"], 11040)
        self.assertLessEqual(summary["medianSec"], 5)
        self.assertEqual(summary["maxSec"], 172.0)
        self.assertEqual(summary["late"][120]["blocks"], 1)
        self.assertEqual(summary["late"][120]["withNamedPeer"], 1)
        self.assertEqual(summary["late"][120]["heights"], [LATE_HEIGHT])

    def test_nothing_late_is_reported_over_the_same_block_count(self):
        # The other negative control: shift every header forward past the
        # observed lag. Zero late, but still 83 blocks measured -- which is
        # what "nothing was late" has to look like to be believable.
        shifted = {h: t + 600 for h, t in FIX["headerTimes"].items()}
        summary = mod.summarise(mod.lag_rows(parsed()[0], shifted), parsed()[1])
        self.assertEqual(summary["blocks"], 83)
        self.assertEqual(summary["late"][120]["blocks"], 0)
        self.assertLess(summary["maxSec"], 0)

    def test_a_block_without_a_header_time_is_dropped_not_zeroed(self):
        tips, _ = parsed()
        one_missing = {h: t for h, t in FIX["headerTimes"].items() if h != LATE_HASH}
        heights = [r["height"] for r in mod.lag_rows(tips, one_missing)]
        self.assertNotIn(LATE_HEIGHT, heights)
        self.assertEqual(len(heights), 82)

    def test_select_drops_excluded_ranges(self):
        kept = mod.select(rows(), first=11050, last=11070, exclude=[(11058, 11060)])
        heights = [r["height"] for r in kept]
        self.assertNotIn(LATE_HEIGHT, heights)
        self.assertIn(11057, heights)
        self.assertIn(11061, heights)
        self.assertTrue(all(11050 <= h <= 11070 for h in heights))


class Detail(unittest.TestCase):
    def test_late_detail_names_the_peers_in_order(self):
        detail = mod.late_detail(rows(), parsed()[1], 120)
        self.assertEqual(len(detail), 1)
        self.assertEqual(detail[0]["height"], LATE_HEIGHT)
        self.assertEqual(detail[0]["timedOutPeers"], ["577"])

    def test_render_quotes_the_rate_with_its_denominator(self):
        text = mod.render(mod.summarise(rows(), parsed()[1]), [], 120)
        self.assertIn("of 83", text)


if __name__ == "__main__":
    unittest.main()
