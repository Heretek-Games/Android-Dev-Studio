"""Unit tests for B.3 mutation diffs + loop wiring (hermetic).

Run from the repository root:
    python3 -m unittest harness.spatial.test_diff
"""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.prompts import repair_messages  # noqa: E402
from harness.spatial.spatial_diff import diff_scenes, summarize_diff  # noqa: E402


def scene():
    return {
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            {
                "name": "Wall",
                "shape": "box",
                "size": [4, 4, 1],
                "position": [0, 2, -6],
                "color": "#78716c",
                "physics": "fixed",
            },
        ],
        "ui": {"theme": "fantasy", "elements": []},
        "places": [{"name": "gate", "position": [0, 0.5, -12], "radius": 2}],
    }


class DiffTests(unittest.TestCase):
    def test_empty_diff(self):
        diff = diff_scenes(scene(), copy.deepcopy(scene()))
        self.assertTrue(diff["empty"])
        self.assertEqual(summarize_diff(diff), "")

    def test_added_removed(self):
        after = scene()
        after["gameObjects"].append(
            {"name": "Coin", "position": [1, 1, 1], "physics": "none"}
        )
        after["gameObjects"] = [o for o in after["gameObjects"] if o["name"] != "Wall"]
        diff = diff_scenes(scene(), after)
        self.assertEqual(diff["added"], ["Coin"])
        self.assertEqual(diff["removed"], ["Wall"])
        summary = summarize_diff(diff)
        self.assertIn("+Coin", summary)
        self.assertIn("-Wall", summary)

    def test_moved_sorted_by_distance(self):
        after = scene()
        after["gameObjects"][0]["position"] = [0.5, -0.5, 0]
        after["gameObjects"][1]["position"] = [5, 2, -6]
        diff = diff_scenes(scene(), after)
        self.assertEqual([m["name"] for m in diff["moved"]], ["Wall", "Ground"])
        self.assertAlmostEqual(diff["moved"][0]["dist"], 5.0)
        summary = summarize_diff(diff)
        self.assertIn("Wall [0,2,-6]→[5,2,-6]", summary)

    def test_resized_and_physics(self):
        after = scene()
        after["gameObjects"][1]["size"] = [6, 4, 1]
        after["gameObjects"][1]["physics"] = "dynamic"
        diff = diff_scenes(scene(), after)
        self.assertEqual(len(diff["resized"]), 1)
        self.assertEqual(diff["physics_changed"][0]["to"], "dynamic")

    def test_places_and_ui(self):
        after = scene()
        after["places"] = []
        after["ui"] = {"theme": "dungeon", "elements": []}
        diff = diff_scenes(scene(), after)
        self.assertEqual(diff["places_changed"], ["gate"])
        self.assertTrue(diff["ui_changed"])
        self.assertTrue(diff["theme_changed"])

    def test_survives_garbage(self):
        diff = diff_scenes({}, {"gameObjects": [None, {"name": "x"}]})
        self.assertEqual(diff["added"], ["x"])


class PromptTests(unittest.TestCase):
    def test_diff_line_in_repair_prompt(self):
        messages = repair_messages(
            "g", [], scene(), [], {}, 2, spatial_diff="Last patch moved: +Coin."
        )
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertIn("Last patch moved: +Coin.", user)

    def test_no_diff_no_line(self):
        messages = repair_messages("g", [], scene(), [], {}, 2)
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertNotIn("Last patch moved", user)


class LoopDiffTests(unittest.TestCase):
    def test_iteration_records_spatial_diff(self):
        from harness.loop.iterate_loop import IterateLoop
        from harness.loop.llm_client import LlmResponse

        calls = {"n": 0}

        class FakeClient:
            def chat(self, messages, model=None, max_tokens=8000):
                calls["n"] += 1
                if calls["n"] == 1:
                    actions = [
                        {
                            "type": "spawn",
                            "name": "Coin",
                            "shape": "cylinder",
                            "size": [0.8, 0.2, 0.8],
                            "position": [2, 1, 2],
                            "color": "#fbbf24",
                            "physics": "none",
                        }
                    ]
                else:
                    actions = []
                return LlmResponse(
                    text=json.dumps({"summary": "t", "actions": actions}),
                    model="fake",
                    prompt_tokens=1,
                    completion_tokens=1,
                )

        def fake_qa(path, frames, out):
            return {
                "verdict": "SUCCEEDED",
                "passed": 1,
                "total": 1,
                "rules": [{"id": "r1", "type": "object_count", "pass": True}],
                "metrics": {},
            }

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "diff test",
                [{"id": "r1", "type": "object_count"}],
                FakeClient(),
                qa_runner=fake_qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
            )
            result = loop.run()
        self.assertEqual(result.verdict, "green")
        record = result.iterations[0]
        self.assertIn("spatialDiff", record)
        self.assertEqual(record["spatialDiff"]["added"], ["Coin"])


if __name__ == "__main__":
    unittest.main()
