"""Physics contract tests: deterministic Rapier behavior (Track C.4).

Runs harness/physics/contract.mjs 3x and asserts bit-identical snapshot
hashes (local determinism proof), plus structural checks on the report
(fixture bodies present, fixed dt, pinned gravity).

Run from the repository root:
    python3 -m unittest harness.physics.test_contract
"""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUNNER = os.path.join("harness", "physics", "contract.mjs")


def run_contract(steps=600):
    proc = subprocess.run(
        ["node", RUNNER, "--steps", str(steps)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=300,
    )
    if proc.returncode != 0:
        raise AssertionError(f"contract.mjs failed: {proc.stderr[:400]}")
    return json.loads(proc.stdout)


class PhysicsContractTests(unittest.TestCase):
    def test_snapshot_hash_stable_across_runs(self):
        hashes = {run_contract()["snapshotMd5"] for _ in range(3)}
        self.assertEqual(len(hashes), 1, f"non-deterministic snapshots: {hashes}")

    def test_report_structure(self):
        report = run_contract(steps=120)
        self.assertEqual(report["steps"], 120)
        self.assertAlmostEqual(report["dt"], 1 / 60)
        self.assertEqual(report["gravity"], [0, -9.81, 0])
        names = [b["name"] for b in report["bodies"]]
        self.assertEqual(names, ["drop", "roller", "lower", "upper"])
        for body in report["bodies"]:
            self.assertEqual(len(body["pos"]), 3)
            self.assertEqual(len(body["rot"]), 4)
            for value in body["pos"] + body["vel"]:
                self.assertTrue(
                    abs(value) != float("inf") and value == value,
                    f"non-finite state in {body['name']}",
                )

    def test_short_run_differs_from_golden(self):
        # Sanity: the hash actually responds to the scenario (not constant).
        short_hash = run_contract(steps=60)["snapshotMd5"]
        self.assertNotEqual(short_hash, run_contract(steps=600)["snapshotMd5"])


if __name__ == "__main__":
    unittest.main()
