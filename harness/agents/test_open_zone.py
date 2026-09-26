"""Open-zone region gate through the real QA runner (Track E.3 gate).

The hand-authored region (3 biomes, 2 enemy camps, collection route,
day/night rig, player-carried streamer) must stream seamlessly and walk
fully flat; negative control (no streamer on the traveler) must fail the
coherence rule explicitly instead of passing silently.

Run from the repository root:
    python3 -m unittest harness.agents.test_open_zone
"""

import copy
import json
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/open_zone.json"


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


class OpenZoneTests(unittest.TestCase):
    def test_open_zone_runs_green(self):
        proc = run_scenario(load_spec(), extra_args=("--frames", "120", "--traverse"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        self.assertTrue(by_id["stream_seamless"]["pass"], by_id["stream_seamless"])
        self.assertTrue(by_id["ground_walkable"]["pass"], by_id["ground_walkable"])
        streaming = report["metrics"]["streaming"]
        self.assertEqual(streaming["gaps"], [])
        self.assertEqual(streaming["thrashReloads"], 0)

    def test_region_without_streamer_fails_coherence(self):
        spec = copy.deepcopy(load_spec())
        for obj in spec["gameObjects"]:
            if obj.get("name") == "Traveler":
                obj.pop("streamer", None)
        proc = run_scenario(spec, extra_args=("--frames", "120", "--traverse"))
        report = json.loads(proc.stdout)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["id"] == "stream_seamless" for r in failed), report)


if __name__ == "__main__":
    unittest.main()
