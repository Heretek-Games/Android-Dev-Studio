"""Unit tests for Game Production Brief persistence in ProjectMemory.

Uses an isolated temp SQLite file per test — never touches the real
project_memory.sqlite.

Run from the repository root:
    python3 -m unittest harness.memory.test_project_memory
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.memory.project_memory import ProjectMemory  # noqa: E402


def minimal_brief(**overrides):
    data = {
        "title": "Test Game",
        "fantasy": {"genre": "action-rpg", "loop": "explore and fight"},
        "experience": {"beats": ["first victory"], "inputs": ["touch"]},
        "world": {"areaKm2": 0.25, "biomes": ["meadow"], "streamingRadiusM": 120},
        "systems": {
            "components": ["HealthComponent"],
            "saveSchema": {"slot": "string"},
        },
        "lookdev": {"palette": ["green"], "lighting": "stylized"},
        "acceptance": [
            {"id": "player", "axis": "Functional", "description": "player exists"},
            {"id": "budget", "axis": "Performant", "description": "within budget"},
        ],
    }
    data.update(overrides)
    return data


class BriefPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ProjectMemory(db_path=str(Path(self.tmp.name) / "memory.sqlite"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_record_and_get_roundtrip(self):
        brief_id = self.memory.record_brief(minimal_brief())
        self.assertTrue(brief_id.startswith("brief_"))
        stored = self.memory.get_brief(brief_id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored["title"], "Test Game")
        self.assertEqual(stored["brief"]["title"], "Test Game")
        self.assertEqual(len(stored["brief"]["acceptance"]), 2)

    def test_get_unknown_brief_returns_none(self):
        self.assertIsNone(self.memory.get_brief("brief_nope"))

    def test_record_rejects_invalid_brief(self):
        bad = minimal_brief()
        del bad["title"]
        with self.assertRaises(Exception):
            self.memory.record_brief(bad)
        self.assertEqual(self.memory.list_briefs(), [])

    def test_list_briefs_newest_first(self):
        first = self.memory.record_brief(minimal_brief(title="First"))
        second = self.memory.record_brief(minimal_brief(title="Second"))
        listed = self.memory.list_briefs()
        self.assertEqual([b["brief_id"] for b in listed], [second, first])
        self.assertEqual(listed[0]["title"], "Second")

    def test_summary_counts_briefs(self):
        summary = self.memory.get_project_summary()
        self.assertEqual(summary["brief_count"], 0)
        self.memory.record_brief(minimal_brief())
        self.assertEqual(self.memory.get_project_summary()["brief_count"], 1)


class ProductionContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ProjectMemory(db_path=str(Path(self.tmp.name) / "memory.sqlite"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_context_bundle_has_brief_adrs_failures_and_qa(self):
        brief_id = self.memory.record_brief(minimal_brief())
        self.memory.record_adr(
            title="Past decision", rationale="Because.", tags=["test"]
        )
        failed = self.memory.create_task(
            title="Broken build", description="x", assigned_agent="Y"
        )
        self.memory.update_task_state(failed, "failed", {"error": "boom"})
        done = self.memory.create_task(
            title="Good build", description="x", assigned_agent="Y"
        )
        self.memory.update_task_state(done, "completed", {"ok": True})

        context = self.memory.query_production_context(brief_id)
        self.assertEqual(context["brief"]["title"], "Test Game")
        self.assertEqual(len(context["adrs"]), 1)
        self.assertEqual(len(context["failed_tasks"]), 1)
        self.assertEqual(context["failed_tasks"][0]["task_id"], failed)
        self.assertEqual(context["latest_qa"], [])

    def test_context_unknown_brief_raises(self):
        with self.assertRaises(ValueError):
            self.memory.query_production_context("brief_nope")


if __name__ == "__main__":
    unittest.main()
