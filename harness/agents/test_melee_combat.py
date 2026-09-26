"""Melee combat encounter gate through the real QA runner (Track E.2 gate).

A hydro-infused hero swings a MeleeHitbox (soft lock-on facing) at two
waves of pyro-aura slimes: arc/range/i-frame resolution is real engine
math, kills tally off Hurtbox fatal resolutions, reactions off Vaporize.
Negative control (blade range too short to ever connect) must fail the
kill rule — proving the gate measures melee, not background progress.

Run from the repository root:
    python3 -m unittest harness.agents.test_melee_combat
"""

import copy
import json
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/melee_combat.json"


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


class MeleeCombatTests(unittest.TestCase):
    def test_melee_encounter_runs_green(self):
        proc = run_scenario(load_spec(), extra_args=("--frames", "600"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        self.assertTrue(by_id["melee_kills"]["pass"], by_id["melee_kills"])
        self.assertTrue(
            by_id["vaporize_reactions"]["pass"], by_id["vaporize_reactions"]
        )

    def test_out_of_range_blade_scores_no_kills(self):
        spec = load_spec()
        spec = copy.deepcopy(spec)
        spec["game"]["melee"]["range"] = 0.5
        proc = run_scenario(spec, extra_args=("--frames", "600"))
        report = json.loads(proc.stdout)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["id"] == "melee_kills" for r in failed), report)


if __name__ == "__main__":
    unittest.main()
