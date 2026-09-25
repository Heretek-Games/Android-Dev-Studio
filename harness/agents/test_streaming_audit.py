"""Streaming-audit tests: WorldStreamer coherence over a focus transect.

Drives harness/agents/qa_scenario_runner.mjs via subprocess (same pattern as
test_traversal_audit.py): a player-carried streamer must show full coverage,
zero gaps, and zero thrash reloads; a scenario without streaming config must
fail the coherence rule explicitly instead of passing silently.

Run from the repository root:
    python3 -m unittest harness.agents.test_streaming_audit
"""

import json
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "harness" / "agents" / "qa_scenario_runner.mjs"


def run_scenario(spec, frames=30):
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "scenario.json"
        path.write_text(json.dumps(spec), encoding="utf-8")
        proc = subprocess.run(
            ["node", str(RUNNER), "--scenario", str(path), "--frames", str(frames)],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            timeout=300,
        )
        return proc


def player_with_streamer():
    return {
        "name": "Player Hero",
        "shape": "box",
        "size": [1, 2, 1],
        "position": [0, 5, 0],
        "color": "#3b82f6",
        "streamer": {
            "chunkSize": 16,
            "renderDistance": 1,
            "resolution": 8,
            "maxHeight": 4,
        },
    }


def streaming_config():
    return {
        "samples": 5,
        "settleFrames": 12,
        "path": {"from": {"x": -40, "z": 0}, "to": {"x": 40, "z": 0}},
    }


class StreamingAuditTests(unittest.TestCase):
    def test_coherent_streaming_passes(self):
        spec = {
            "name": "StreamFixture",
            "goal": "streaming audit",
            "gameObjects": [player_with_streamer()],
            "streaming": streaming_config(),
            "rules": [
                {"id": "coherent", "type": "streaming_coherence_min", "min": 1.0}
            ],
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        streaming = report["metrics"]["streaming"]
        self.assertEqual(streaming["coverage"], 1)
        self.assertEqual(streaming["gaps"], [])
        self.assertEqual(streaming["thrashReloads"], 0)
        # renderDistance 1 -> exactly a 3x3 active window.
        self.assertEqual(streaming["maxActiveChunks"], 9)
        self.assertGreater(streaming["uniqueChunks"], 9)
        self.assertEqual(report["verdict"], "SUCCEEDED")
        self.assertEqual(proc.returncode, 0)
        rule = next(r for r in report["rules"] if r["id"] == "coherent")
        self.assertTrue(rule["pass"])

    def test_rule_presence_opts_into_audit_with_defaults(self):
        spec = {
            "name": "RuleDriven",
            "goal": "streaming audit",
            "gameObjects": [player_with_streamer()],
            "rules": [
                {"id": "coherent", "type": "streaming_coherence_min", "min": 1.0}
            ],
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        # No spec.streaming block, but the rule alone triggers the audit.
        streaming = report["metrics"]["streaming"]
        self.assertEqual(streaming["coverage"], 1)
        rule = next(r for r in report["rules"] if r["id"] == "coherent")
        self.assertTrue(rule["pass"])

    def test_rule_without_streamer_fails_explicitly(self):
        spec = {
            "name": "NoStreamer",
            "goal": "streaming audit",
            "gameObjects": [
                {
                    "name": "Player Hero",
                    "shape": "box",
                    "size": [1, 2, 1],
                    "position": [0, 5, 0],
                    "color": "#3b82f6",
                }
            ],
            "rules": [
                {"id": "coherent", "type": "streaming_coherence_min", "min": 1.0}
            ],
        }
        proc = run_scenario(spec)
        report = json.loads(proc.stdout)
        self.assertNotIn("streaming", report["metrics"])
        rule = next(r for r in report["rules"] if r["id"] == "coherent")
        self.assertFalse(rule["pass"])
        self.assertIn("did not run", rule["detail"])


if __name__ == "__main__":
    unittest.main()
