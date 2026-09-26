"""Unit tests for the agent activity feed summarizer (Track D.2, hermetic).

Run from the repository root:
    python3 -m unittest harness.loop.test_feed
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.feed import summarize_runs  # noqa: E402


def write_run(directory, name, payload):
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return path


def iteration(n, **over):
    record = {
        "iteration": n,
        "phase": "generate",
        "apply": {"applied": 3},
        "gate": {"valid": True},
        "qa": {"verdict": "SUCCEEDED", "passed": 5, "total": 5},
    }
    record.update(over)
    return record


class FeedTests(unittest.TestCase):
    def test_summarizes_runs_newest_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_run(
                tmp,
                "a.json",
                {"goal": "old", "verdict": "green", "totalTokens": 1, "iterations": []},
            )
            write_run(
                tmp,
                "b.json",
                {
                    "goal": "new",
                    "verdict": "unresolved",
                    "totalTokens": 2,
                    "iterations": [iteration(1), iteration(2)],
                },
            )
            feed = summarize_runs(tmp)
        self.assertEqual([r["goal"] for r in feed["runs"]], ["new", "old"])
        newest = feed["runs"][0]
        self.assertEqual(newest["verdict"], "unresolved")
        self.assertEqual(len(newest["iterations"]), 2)
        row = newest["iterations"][0]
        self.assertEqual(
            (row["phase"], row["applied"], row["gate"], row["qa"], row["qaScore"]),
            ("generate", 3, "ok", "SUCCEEDED", "5/5"),
        )

    def test_visual_spatial_diff_flags(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_run(
                tmp,
                "a.json",
                {
                    "goal": "g",
                    "verdict": "green",
                    "totalTokens": 0,
                    "iterations": [
                        iteration(
                            1,
                            visual=[{"pass": True}, {"pass": False}],
                            spatial=[{"pass": True}],
                            spatialDiff={"added": ["X"]},
                            frame={"path": "f.png"},
                        )
                    ],
                },
            )
            feed = summarize_runs(tmp)
        row = feed["runs"][0]["iterations"][0]
        self.assertEqual(row["visual"], "1/2")
        self.assertEqual(row["spatial"], "pass")
        self.assertTrue(row["hasDiff"])
        self.assertTrue(row["hasFrame"])

    def test_skips_garbage_and_missing_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "bad.json"), "w").write("{nope")
            feed = summarize_runs(tmp)
            self.assertEqual(feed["runs"], [])
        self.assertEqual(summarize_runs("/nonexistent-dir")["runs"], [])

    def test_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(8):
                write_run(
                    tmp,
                    f"r{i}.json",
                    {
                        "goal": f"g{i}",
                        "verdict": "green",
                        "totalTokens": 0,
                        "iterations": [iteration(n) for n in range(12)],
                    },
                )
            feed = summarize_runs(tmp, limit_runs=5, limit_iterations=8)
        self.assertEqual(len(feed["runs"]), 5)
        self.assertEqual(len(feed["runs"][0]["iterations"]), 8)


if __name__ == "__main__":
    unittest.main()
