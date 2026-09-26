"""Headless performance leg through the real QA runner (Track E.5 gate).

2400 GPU-instanced background entities + 32 live AI combatants + 6 VFX
emitters resolve melee kills inside the S-tier draw budget with p95
sim-frame headroom to spare. Negative control (crowd removed) must fail
the instance rule — proving the scene measures instancing, not emptiness.

Run from the repository root:
    python3 -m unittest harness.agents.test_perf_action
"""

import copy
import json
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/perf_action.json"


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


class PerfActionTests(unittest.TestCase):
    def test_heavy_action_scene_runs_green(self):
        proc = run_scenario(load_spec(), extra_args=("--frames", "600"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        self.assertGreaterEqual(report["metrics"]["instancedEntities"], 2000)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        self.assertTrue(by_id["sim_headroom"]["pass"], by_id["sim_headroom"])
        self.assertTrue(by_id["draws"]["pass"], by_id["draws"])

    def test_crowd_removed_fails_instance_rule(self):
        spec = copy.deepcopy(load_spec())
        spec["gameObjects"] = [o for o in spec["gameObjects"] if "foliage" not in o]
        proc = run_scenario(spec, extra_args=("--frames", "120"))
        report = json.loads(proc.stdout)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["id"] == "crowd_instanced" for r in failed), report)


if __name__ == "__main__":
    unittest.main()
