"""Traversal-audit tests: grid raycast sweeps over real Rapier collision hulls.

Drives harness/agents/qa_scenario_runner.mjs via subprocess (same pattern as
test_quadtree_parity.py): a full ground plane must report coverage 1.0, while
a gapped ground must report voids and fail a min-1.0 coverage rule.

Run from the repository root:
    python3 -m unittest harness.agents.test_traversal_audit
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "harness" / "agents" / "qa_scenario_runner.mjs"


def run_scenario(spec, extra_args=()):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "scenario.json"
        path.write_text(json.dumps(spec), encoding="utf-8")
        proc = subprocess.run(
            [
                "node",
                str(RUNNER),
                "--scenario",
                str(path),
                "--frames",
                "60",
                *extra_args,
            ],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            timeout=300,
        )
        return proc


def slab(name, x, size=8):
    return {
        "name": name,
        "shape": "box",
        "size": [size, 1, size],
        "position": [x, -0.5, 0],
        "color": "#27272a",
        "physics": "fixed",
    }


class TraversalAuditTests(unittest.TestCase):
    def test_full_ground_reports_full_coverage(self):
        spec = {
            "name": "FlatGround",
            "goal": "traversal audit",
            "gameObjects": [slab("Ground", 0, size=20)],
            "rules": [{"id": "cover", "type": "traversal_coverage_min", "min": 1.0}],
            "traversal": {"grid": 5},
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        traversal = report["metrics"]["traversal"]
        self.assertEqual(traversal["coverage"], 1.0)
        self.assertEqual(traversal["holes"], [])
        self.assertEqual(traversal["steep"], [])
        self.assertEqual(traversal["stepHazards"], [])
        self.assertEqual(
            report["verdict"], "SUCCEEDED", json.dumps(report["rules"], indent=1)
        )
        self.assertEqual(proc.returncode, 0)

    def test_gapped_ground_reports_voids_and_fails_min_coverage(self):
        spec = {
            "name": "GappedGround",
            "goal": "traversal audit",
            "gameObjects": [slab("West", -6), slab("East", 6)],
            "rules": [{"id": "cover", "type": "traversal_coverage_min", "min": 1.0}],
            "traversal": {"grid": 5},
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        traversal = report["metrics"]["traversal"]
        # The x=0 column (5 cells) falls through the 4-wide gap.
        self.assertEqual(traversal["coverage"], 0.8)
        self.assertEqual(len(traversal["holes"]), 5)
        self.assertEqual(report["verdict"], "FAILED")
        self.assertEqual(proc.returncode, 1)
        rule = next(r for r in report["rules"] if r["id"] == "cover")
        self.assertFalse(rule["pass"])
        self.assertIn("holes=5", rule["detail"])

    def test_rule_without_audit_fails_explicitly(self):
        spec = {
            "name": "NoAudit",
            "goal": "traversal audit",
            "gameObjects": [slab("Ground", 0, size=20)],
            "rules": [{"id": "cover", "type": "traversal_coverage_min", "min": 0.5}],
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        self.assertNotIn("traversal", report["metrics"])
        rule = next(r for r in report["rules"] if r["id"] == "cover")
        self.assertFalse(rule["pass"])
        self.assertIn("did not run", rule["detail"])

    def test_traverse_flag_prints_human_summary(self):
        spec = {
            "name": "FlatGround",
            "goal": "traversal audit",
            "gameObjects": [slab("Ground", 0, size=20)],
            "rules": [],
            "traversal": {"grid": 5},
        }
        proc = run_scenario(spec, extra_args=("--traverse",))
        self.assertIn("[traverse] grid=5 coverage=1", proc.stderr)


if __name__ == "__main__":
    unittest.main()
