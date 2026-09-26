"""Unit tests for A.4 taste memory + frame diff (hermetic).

Run from the repository root:
    python3 -m unittest harness.loop.test_taste
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.frame_diff import (  # noqa: E402
    baseline_path,
    compare_pngs,
    compare_to_baseline,
)
from harness.loop.frame_preview import render_frame_png  # noqa: E402
from harness.loop.iterate_loop import IterateLoop  # noqa: E402
from harness.loop.llm_client import LlmResponse  # noqa: E402
from harness.loop.prompts import generation_messages  # noqa: E402
from harness.memory.project_memory import ProjectMemory  # noqa: E402


def scene(ui=True):
    objects = [
        {
            "name": "Ground",
            "shape": "box",
            "size": [24, 1, 24],
            "position": [0, -0.5, 0],
            "color": "#27272a",
            "physics": "fixed",
        },
        {
            "name": "Player",
            "shape": "capsule",
            "size": [1, 1.5, 1],
            "position": [0, 1.5, 2],
            "color": "#3b82f6",
            "physics": "dynamic",
            "controller": True,
        },
        {
            "name": "Coin",
            "shape": "cylinder",
            "size": [0.8, 0.2, 0.8],
            "position": [-4, 1.2, -2],
            "color": "#fbbf24",
        },
    ]
    out = {"gameObjects": objects}
    if ui:
        out["ui"] = {
            "theme": "fantasy",
            "elements": [
                {
                    "id": "score",
                    "kind": "label",
                    "zone": "top_center",
                    "size": [0.28, 0.08],
                    "order": 0,
                },
            ],
        }
    return out


class TasteMemoryTests(unittest.TestCase):
    def setUp(self):
        self.memory = ProjectMemory(db_path=":memory:")

    def test_record_and_query(self):
        row_id = self.memory.record_taste(
            {
                "genre": "arena",
                "theme": "fantasy",
                "kit_zones": ["top_center"],
                "palette": ["#d4a24e"],
                "scores": {"composition": 4},
                "overall": 4,
                "mean": 4.0,
                "source": "run1.json",
            }
        )
        self.assertGreater(row_id, 0)
        entries = self.memory.query_taste("arena")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["theme"], "fantasy")
        self.assertEqual(entries[0]["kit_zones"], ["top_center"])

    def test_genre_isolation_and_ordering(self):
        self.memory.record_taste({"genre": "arena", "overall": 3, "mean": 3.0})
        self.memory.record_taste({"genre": "arena", "overall": 5, "mean": 5.0})
        self.memory.record_taste({"genre": "racer", "overall": 5, "mean": 5.0})
        arena = self.memory.query_taste("arena")
        self.assertEqual([e["overall"] for e in arena], [5, 3])
        self.assertEqual(len(self.memory.query_taste("racer")), 1)
        self.assertEqual(self.memory.query_taste("dungeon"), [])

    def test_prunes_to_cap(self):
        for i in range(25):
            self.memory.record_taste({"genre": "arena", "overall": i, "mean": float(i)})
        entries = self.memory.query_taste("arena", limit=50)
        self.assertEqual(len(entries), 20)
        self.assertEqual(entries[0]["overall"], 24)  # best survive


class DiffTests(unittest.TestCase):
    def test_identical_frames_diff_zero(self):
        png = render_frame_png(scene())
        result = compare_pngs(png, png)
        self.assertFalse(result["sizesDiffer"])
        self.assertEqual(result["diffPercent"], 0.0)
        self.assertTrue(result["heatmap"].startswith(b"\x89PNG"))

    def test_moved_prop_diffs_positive(self):
        before = render_frame_png(scene())
        moved = scene()
        moved["gameObjects"][2]["position"] = [4, 1.2, 2]
        after = render_frame_png(moved)
        result = compare_pngs(before, after)
        self.assertGreater(result["diffPercent"], 0.0)
        self.assertLess(result["diffPercent"], 50.0)
        self.assertIn("col", result["worstRegion"])

    def test_size_mismatch_is_explicit(self):
        png = render_frame_png(scene())
        other = render_frame_png(scene(), width=160, height=90)
        result = compare_pngs(png, other)
        self.assertTrue(result["sizesDiffer"])
        self.assertEqual(result["diffPercent"], 100.0)

    def test_baseline_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            png = render_frame_png(scene())
            missing = compare_to_baseline("arena", png, baselines_dir=base)
            self.assertEqual(missing["status"], "no-baseline")
            promoted = compare_to_baseline(
                "arena", png, baselines_dir=base, promote=True
            )
            self.assertEqual(promoted["status"], "promoted")
            same = compare_to_baseline("arena", png, baselines_dir=base)
            self.assertEqual(same["status"], "compared")
            self.assertEqual(same["diffPercent"], 0.0)
            self.assertTrue(baseline_path("arena", base).is_file())


class LoopTasteTests(unittest.TestCase):
    def _client(self, actions):
        class FakeClient:
            def __init__(self):
                self.seen = []

            def chat(self, messages, model=None, max_tokens=8000):
                self.seen.extend(messages)
                return LlmResponse(
                    text=json.dumps({"summary": "t", "actions": actions}),
                    model="fake",
                    prompt_tokens=1,
                    completion_tokens=1,
                )

        return FakeClient()

    def _qa(self, path, frames, out):
        return {
            "verdict": "SUCCEEDED",
            "passed": 1,
            "total": 1,
            "rules": [{"id": "r1", "type": "object_count", "pass": True}],
            "metrics": {},
        }

    def test_green_records_taste(self):
        memory = ProjectMemory(db_path=":memory:")
        client = self._client(
            [
                {"type": "ui", "op": "kit", "kit": "hud_arena"},
                {
                    "type": "spawn",
                    "name": "Ground",
                    "shape": "box",
                    "size": [24, 1, 24],
                    "position": [0, -0.5, 0],
                    "color": "#27272a",
                    "physics": "fixed",
                },
                {
                    "type": "spawn",
                    "name": "Hero",
                    "shape": "capsule",
                    "size": [1, 1.5, 1],
                    "position": [0, 1.5, 2],
                    "color": "#3b82f6",
                    "physics": "dynamic",
                },
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "tasty arena",
                [{"id": "r1", "type": "object_count"}],
                client,
                qa_runner=self._qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
                genre="arena",
                taste_store=memory,
            )
            result = loop.run()
        self.assertEqual(result.verdict, "green")
        entries = memory.query_taste("arena")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["theme"], "fantasy")
        self.assertIn("top_center", entries[0]["kit_zones"])

    def test_taste_notes_reach_generation_prompt(self):
        memory = ProjectMemory(db_path=":memory:")
        memory.record_taste(
            {
                "genre": "arena",
                "theme": "fantasy",
                "kit_zones": ["top_center", "bottom_left"],
                "palette": ["#d4a24e"],
                "scores": {"composition": 5, "readability": 4},
                "overall": 4,
                "mean": 4.25,
                "source": "old.json",
            }
        )
        client = self._client([])
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "tasty arena",
                [],
                client,
                qa_runner=self._qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
                genre="arena",
                taste_store=memory,
            )
            loop.run()
        user_text = " ".join(
            m.get("content", "") for m in client.seen if m.get("role") == "user"
        )
        self.assertIn("PROVEN LOOKS", user_text)
        self.assertIn("fantasy", user_text)

    def test_no_store_stays_hermetic(self):
        client = self._client([])
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "plain",
                [],
                client,
                qa_runner=self._qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
            )
            result = loop.run()
        self.assertEqual(result.verdict, "green")

    def test_prompt_unit(self):
        messages = generation_messages(
            "goal", [], None, taste_notes=["theme 'fantasy' scored composition=5"]
        )
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertIn("PROVEN LOOKS", user)
        plain = generation_messages("goal", [], None)
        user_plain = next(m["content"] for m in plain if m["role"] == "user")
        self.assertNotIn("PROVEN LOOKS", user_plain)


if __name__ == "__main__":
    unittest.main()
