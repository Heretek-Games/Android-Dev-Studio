"""Unit tests for the A.2 visual critic (rubric + deterministic proxies + gate).

Run from the repository root:
    python3 -m unittest harness.loop.test_aesthetic
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.aesthetic import (  # noqa: E402
    audit_scene,
    contrast_ratio,
    evaluate_visual_rule,
)
from harness.loop.iterate_loop import IterateLoop  # noqa: E402
from harness.loop.llm_client import LlmResponse  # noqa: E402
from harness.loop.vision import (  # noqa: E402
    defects_to_notes,
    make_frame_critique,
    parse_rubric,
)


def good_scene():
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
    }


def mud_scene():
    """Every prop the same gray as the ground: unreadable by construction."""
    return {
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "color": "#808080",
                "physics": "fixed",
            },
            {
                "name": "Player",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 2],
                "color": "#808080",
                "physics": "dynamic",
                "controller": True,
            },
            {
                "name": "Coin",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [-4, 1.2, -2],
                "color": "#808080",
            },
        ]
    }


class ContrastTests(unittest.TestCase):
    def test_black_white_is_21(self):
        self.assertAlmostEqual(contrast_ratio("#000000", "#ffffff"), 21.0, places=1)

    def test_same_color_is_1(self):
        self.assertAlmostEqual(contrast_ratio("#808080", "#808080"), 1.0, places=2)

    def test_symmetry(self):
        self.assertEqual(
            contrast_ratio("#3b82f6", "#27272a"),
            contrast_ratio("#27272a", "#3b82f6"),
        )


class AuditTests(unittest.TestCase):
    def test_good_scene_scores_high(self):
        audit = audit_scene(good_scene())
        self.assertGreaterEqual(audit["overall"], 3)
        self.assertEqual(audit["defects"], [])

    def test_mud_scene_fails_readability(self):
        audit = audit_scene(mud_scene())
        self.assertEqual(audit["scores"]["readability"], 1)
        self.assertLess(audit["overall"], 3)
        self.assertTrue(any("repair:" in d["defect"] for d in audit["defects"]))

    def test_player_without_ground_fails_composition(self):
        scene = {
            "gameObjects": [
                {
                    "name": "Floater",
                    "shape": "capsule",
                    "size": [1, 1.5, 1],
                    "position": [0, 5, 0],
                    "color": "#3b82f6",
                    "physics": "dynamic",
                    "controller": True,
                },
            ]
        }
        audit = audit_scene(scene)
        self.assertLessEqual(audit["scores"]["composition"], 2)
        self.assertTrue(any(d["axis"] == "composition" for d in audit["defects"]))

    def test_empty_scene_scores_one(self):
        audit = audit_scene({"gameObjects": []})
        self.assertEqual(audit["overall"], 1)

    def test_audit_is_deterministic(self):
        self.assertEqual(audit_scene(good_scene()), audit_scene(good_scene()))

    def test_ui_alignment_is_neutral_stub(self):
        self.assertEqual(audit_scene(good_scene())["scores"]["ui_alignment"], 3)


class RuleTests(unittest.TestCase):
    def test_passing_rule(self):
        result = evaluate_visual_rule(
            good_scene(), {"id": "v1", "type": "visual_quality_min", "minScore": 3}
        )
        self.assertTrue(result["pass"])
        self.assertFalse(result["enforce"])

    def test_failing_rule_reports_axes(self):
        result = evaluate_visual_rule(
            mud_scene(),
            {"id": "v1", "type": "visual_quality_min", "minScore": 3, "enforce": True},
        )
        self.assertFalse(result["pass"])
        self.assertTrue(result["enforce"])
        self.assertTrue(any(f["axis"] == "readability" for f in result["failingAxes"]))
        self.assertTrue(len(result["defects"]) > 0)

    def test_axis_subset(self):
        result = evaluate_visual_rule(
            mud_scene(),
            {"type": "visual_quality_min", "minScore": 3, "axes": ["ui_alignment"]},
        )
        self.assertTrue(result["pass"])  # neutral stub passes a 3-bar


class RubricParseTests(unittest.TestCase):
    RUBRIC = json.dumps(
        {
            "scores": {
                "composition": 3,
                "color_harmony": 2,
                "readability": 4,
                "ui_alignment": 3,
            },
            "defects": [
                {
                    "axis": "color_harmony",
                    "defect": "rainbow props",
                    "repair": "consolidate to gold + slate",
                }
            ],
        }
    )

    def test_parses_scores_and_defects(self):
        parsed = parse_rubric(self.RUBRIC)
        self.assertEqual(parsed["scores"]["color_harmony"], 2)
        self.assertEqual(parsed["defects"][0]["repair"], "consolidate to gold + slate")

    def test_clamps_out_of_range(self):
        parsed = parse_rubric(
            json.dumps(
                {"scores": {"composition": 99, "readability": -3}, "defects": []}
            )
        )
        self.assertEqual(parsed["scores"]["composition"], 5)
        self.assertEqual(parsed["scores"]["readability"], 1)

    def test_drops_unknown_axes(self):
        parsed = parse_rubric(
            json.dumps({"scores": {"vibes": 5, "composition": 4}, "defects": []})
        )
        self.assertEqual(list(parsed["scores"]), ["composition"])

    def test_legacy_payload_is_not_a_rubric(self):
        self.assertEqual(
            parse_rubric(json.dumps({"issues": ["x"], "suggestions": []})), {}
        )

    def test_garbage_is_empty(self):
        self.assertEqual(parse_rubric("no json here"), {})

    def test_notes_carry_repairs(self):
        parsed = parse_rubric(self.RUBRIC)
        notes = defects_to_notes(parsed["scores"], parsed["defects"])
        self.assertEqual(len(notes), 1)
        self.assertIn("[color_harmony 2/5]", notes[0])
        self.assertIn("repair: consolidate to gold + slate", notes[0])


class FrameCritiqueTests(unittest.TestCase):
    def test_frame_critique_returns_rubric_notes(self):
        rubric = json.dumps(
            {
                "scores": {
                    "composition": 2,
                    "color_harmony": 2,
                    "readability": 3,
                    "ui_alignment": 3,
                },
                "defects": [
                    {
                        "axis": "composition",
                        "defect": "props piled at center",
                        "repair": "spread props ≥1u apart",
                    }
                ],
            }
        )

        class FakeClient:
            def chat_with_image(self, prompt, image_bytes, **kwargs):
                self.prompt = prompt
                return LlmResponse(
                    text=rubric, model="fake", prompt_tokens=10, completion_tokens=20
                )

        client = FakeClient()
        result = make_frame_critique(client)(good_scene(), [])
        self.assertIn("GAMEPLAY-CAMERA", client.prompt)
        self.assertEqual(result.rubric_scores["composition"], 2)
        self.assertEqual(result.rubric_overall, 2)
        self.assertEqual(len(result.notes), 1)
        self.assertIn("repair: spread props", result.notes[0])


class LoopGateTests(unittest.TestCase):
    def _loop(self, scene, rule):
        class NoopClient:
            def chat(self, messages, model=None, max_tokens=8000):
                return LlmResponse(
                    text=json.dumps({"summary": "noop", "actions": []}),
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

        tmp = Path(tempfile.mkdtemp())
        return IterateLoop(
            "visual gate test",
            [rule],
            NoopClient(),
            qa_runner=fake_qa,
            max_iterations=1,
            seed_scene=scene,
            runs_dir=tmp,
            work_scene_path=tmp / "work.json",
        ).run()

    def test_enforced_gate_blocks_green(self):
        result = self._loop(
            mud_scene(),
            {
                "id": "look",
                "type": "visual_quality_min",
                "minScore": 3,
                "enforce": True,
            },
        )
        self.assertEqual(result.verdict, "unresolved")
        record = result.iterations[0]
        self.assertIn("visual", record)
        self.assertFalse(record["visual"][0]["pass"])
        # Gameplay verdict stays machine-ruled: the node QA still SUCCEEDED;
        # only the look-dev gate holds the loop open for repair.
        self.assertEqual(record["qa"]["verdict"], "SUCCEEDED")

    def test_advisory_gate_stays_green(self):
        result = self._loop(
            mud_scene(), {"id": "look", "type": "visual_quality_min", "minScore": 3}
        )
        self.assertEqual(result.verdict, "green")
        self.assertIn("visual", result.iterations[0])
        self.assertFalse(result.iterations[0]["visual"][0]["pass"])


if __name__ == "__main__":
    unittest.main()
