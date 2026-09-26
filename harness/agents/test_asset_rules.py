"""Asset rule tests through the real QA runner (Track D.3).

A spec carrying modelUrl + license objects must satisfy asset_count and
asset_license; an unlicensed model must fail the license gate.

Run from the repository root:
    python3 -m unittest harness.agents.test_asset_rules
"""

import json
import unittest

from harness.agents.test_traversal_audit import run_scenario


def spec(objects, rules):
    return {
        "name": "AssetRules",
        "goal": "asset rules",
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [30, 1, 30],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            *objects,
        ],
        "rules": rules,
    }


def knight(name="Knight", license="CC0-1.0"):
    return {
        "name": name,
        "shape": "box",
        "size": [1, 2, 1],
        "position": [3, 1, 0],
        "color": "#8b5cf6",
        "physics": "none",
        "modelUrl": "uid://0123456789abcdef0123456789abcdef",
        "license": license,
    }


class AssetRuleTests(unittest.TestCase):
    def test_licensed_assets_pass(self):
        proc = run_scenario(
            spec(
                [knight()],
                [
                    {"id": "ac", "type": "asset_count", "min": 1},
                    {"id": "al", "type": "asset_license", "allow": ["CC0-1.0", "MIT"]},
                ],
            )
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)

    def test_unlicensed_model_fails_license_gate(self):
        proc = run_scenario(
            spec(
                [knight(license="All-Rights-Reserved")],
                [{"id": "al", "type": "asset_license", "allow": ["CC0-1.0", "MIT"]}],
            )
        )
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "FAILED", report)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["type"] == "asset_license" for r in failed))

    def test_missing_assets_fail_count_gate(self):
        proc = run_scenario(
            spec(
                [],
                [{"id": "ac", "type": "asset_count", "min": 2}],
            )
        )
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "FAILED", report)


if __name__ == "__main__":
    unittest.main()
