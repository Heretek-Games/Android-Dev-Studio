"""Unit tests for the loop run dashboard (temp run logs, no network).

Run from the repository root:
    python3 -m unittest harness.loop.test_report
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.report import build_summary, load_runs, render_markdown  # noqa: E402


def write_run(
    runs_dir: Path,
    name: str,
    verdict: str,
    iterations: int,
    tokens: int,
    latency: float,
):
    payload = {
        "goal": f"goal {name}",
        "verdict": verdict,
        "iterations": [{"iteration": i + 1} for i in range(iterations)],
        "totalTokens": tokens,
        "totalLatencySeconds": latency,
    }
    (runs_dir / name).write_text(json.dumps(payload), encoding="utf-8")


class ReportTests(unittest.TestCase):
    def test_summary_aggregates_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs_dir = Path(tmp)
            write_run(runs_dir, "a.json", "green", 2, 1000, 10.0)
            write_run(runs_dir, "b.json", "unresolved", 3, 2000, 20.0)
            write_run(runs_dir, "c.json", "error", 1, 500, 5.0)
            summary = build_summary(load_runs(runs_dir))

        self.assertEqual(summary["runs"], 3)
        self.assertEqual(summary["verdicts"]["green"], 1)
        self.assertEqual(summary["verdicts"]["unresolved"], 1)
        self.assertEqual(summary["verdicts"]["error"], 1)
        self.assertEqual(summary["totalTokens"], 3500)
        self.assertEqual(summary["totalLatencySeconds"], 35.0)
        self.assertEqual(summary["avgIterationsToGreen"], 2.0)

    def test_markdown_contains_rows_and_totals(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs_dir = Path(tmp)
            write_run(runs_dir, "a.json", "green", 2, 1000, 10.0)
            markdown = render_markdown(build_summary(load_runs(runs_dir)))

        self.assertIn("Runs: **1**", markdown)
        self.assertIn("Tokens: **1000**", markdown)
        self.assertIn("| goal a.json | green | 2 | 1000 | 10.0 |", markdown)

    def test_malformed_and_unrelated_json_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs_dir = Path(tmp)
            (runs_dir / "broken.json").write_text("{not json", encoding="utf-8")
            (runs_dir / "other.json").write_text(
                json.dumps({"hello": "world"}), encoding="utf-8"
            )
            write_run(runs_dir, "good.json", "green", 1, 10, 1.0)
            runs = load_runs(runs_dir)

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["verdict"], "green")

    def test_missing_dir_is_empty(self):
        summary = build_summary(load_runs(Path("/nonexistent/loop_runs")))
        self.assertEqual(summary["runs"], 0)
        self.assertIsNone(summary["avgIterationsToGreen"])


if __name__ == "__main__":
    unittest.main()
