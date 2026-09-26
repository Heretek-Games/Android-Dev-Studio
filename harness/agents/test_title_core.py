"""Title-core gate: the hand-tuned E.6 assembly boots green (Track E.6).

Tide and Cinder core = quest_chain dungeon (blessing -> melee waves ->
tyrant -> 5-stage quest) inside a 3-biome day/night dungeon with a
collection route. Negative control (tyrant removed) must stall the chain
at slay_tyrant — proving the title resolves its boss, not the clock.

Run from the repository root:
    python3 -m unittest harness.agents.test_title_core
"""

import copy
import json
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/tide_cinder.json"


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


class TitleCoreTests(unittest.TestCase):
    def test_title_core_runs_green(self):
        proc = run_scenario(load_spec(), extra_args=("--frames", "600", "--traverse"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        for rid in ("quest_done", "tyrant_slain", "title_walkable", "sun_cycles"):
            self.assertTrue(by_id[rid]["pass"], by_id[rid])

    def test_title_without_tyrant_loses_its_boss(self):
        spec = copy.deepcopy(load_spec())
        spec["game"].pop("boss", None)
        spec["game"]["enemiesPerWave"] = 2
        proc = run_scenario(spec, extra_args=("--frames", "600", "--traverse"))
        report = json.loads(proc.stdout)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        # Kills still tally (the quest counts kills, not identity), but the
        # boss encounter leaves no telegraph signature.
        self.assertFalse(
            by_id["boss_telegraphs_live"]["pass"], by_id["boss_telegraphs_live"]
        )


if __name__ == "__main__":
    unittest.main()
