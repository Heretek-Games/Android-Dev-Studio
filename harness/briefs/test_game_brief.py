"""Unit tests for the Game Production Brief schema (pure, no network/engine needed).

Run from the repository root:
    python3 -m unittest harness.briefs.test_game_brief
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.briefs.game_brief import (  # noqa: E402
    BriefValidationError,
    GameProductionBrief,
    PerformanceContract,
    VALID_AXES,
)


def minimal_dict(**overrides):
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


class SchemaTests(unittest.TestCase):
    def test_minimal_brief_validates_with_hardware_defaults(self):
        brief = GameProductionBrief.from_dict(minimal_dict())
        contract = brief.performance
        self.assertEqual(contract.targetFps, 60)
        self.assertEqual(contract.maxDrawCalls, 100)
        self.assertEqual(contract.deviceProfile, "android16-snapdragon8elite")
        self.assertEqual(len(brief.acceptance), 2)

    def test_missing_title_rejected(self):
        data = minimal_dict()
        del data["title"]
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(data)

    def test_unknown_axis_rejected(self):
        with self.assertRaises(BriefValidationError) as ctx:
            GameProductionBrief.from_dict(
                minimal_dict(
                    acceptance=[{"id": "x", "axis": "Fun", "description": "is fun"}]
                )
            )
        self.assertIn("Fun", str(ctx.exception))

    def test_duplicate_criterion_ids_rejected(self):
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(
                minimal_dict(
                    acceptance=[
                        {"id": "same", "axis": "Functional", "description": "a"},
                        {"id": "same", "axis": "Playable", "description": "b"},
                    ]
                )
            )

    def test_empty_criterion_text_rejected(self):
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(
                minimal_dict(
                    acceptance=[{"id": "x", "axis": "Functional", "description": "  "}]
                )
            )

    def test_draw_call_ceiling_enforced(self):
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(
                minimal_dict(performance={"maxDrawCalls": 400, "targetFps": 60})
            )

    def test_fps_floor_enforced(self):
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(minimal_dict(performance={"targetFps": 15}))

    def test_negative_area_rejected(self):
        with self.assertRaises(BriefValidationError):
            GameProductionBrief.from_dict(
                minimal_dict(
                    world={"areaKm2": -1, "biomes": ["meadow"], "streamingRadiusM": 50}
                )
            )

    def test_axes_cover_all_five(self):
        self.assertEqual(
            sorted(VALID_AXES),
            [
                "Functional",
                "Performant",
                "Playable",
                "Spec-Accurate",
                "Visually Coherent",
            ],
        )


class RoundTripTests(unittest.TestCase):
    def test_to_dict_from_dict_is_stable(self):
        brief = GameProductionBrief.from_dict(minimal_dict())
        clone = GameProductionBrief.from_dict(brief.to_dict())
        self.assertEqual(clone.to_dict(), brief.to_dict())

    def test_save_and_load_file(self):
        brief = GameProductionBrief.from_dict(minimal_dict())
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "game_brief.json"
            brief.save(path)
            loaded = GameProductionBrief.load(path)
        self.assertEqual(loaded.to_dict(), brief.to_dict())

    def test_load_rejects_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "game_brief.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(BriefValidationError):
                GameProductionBrief.load(path)


class AcceptanceCompilationTests(unittest.TestCase):
    def test_qa_rules_compile_to_runner_vocabulary(self):
        brief = GameProductionBrief.from_dict(
            minimal_dict(
                acceptance=[
                    {
                        "id": "player",
                        "axis": "Functional",
                        "description": "player exists",
                        "qaRule": {"type": "entity_exists", "target": "Player Hero"},
                    },
                    {
                        "id": "budget",
                        "axis": "Performant",
                        "description": "within budget",
                        "qaRule": {"type": "draw_call_budget", "max": 100},
                    },
                    {
                        "id": "vibe",
                        "axis": "Visually Coherent",
                        "description": "looks like sunset",
                    },
                ]
            )
        )
        rules = brief.compile_acceptance_rules()
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0]["id"], "player")
        self.assertEqual(rules[0]["type"], "entity_exists")
        self.assertEqual(rules[1]["id"], "budget")

    def test_criteria_without_qa_rules_are_reported_not_compiled(self):
        brief = GameProductionBrief.from_dict(minimal_dict())
        self.assertEqual(brief.compile_acceptance_rules(), [])
        self.assertEqual(len(brief.unautomatable_criteria()), 2)

    def test_task_seeds_cover_each_criterion(self):
        brief = GameProductionBrief.from_dict(minimal_dict())
        seeds = brief.task_seeds()
        self.assertEqual(len(seeds), 2)
        self.assertTrue(all(s["criterionId"] in ("player", "budget") for s in seeds))
        self.assertTrue(all(s["status"] == "pending" for s in seeds))


class PerformanceContractTests(unittest.TestCase):
    def test_custom_contract_values_accepted(self):
        contract = PerformanceContract.from_dict(
            {
                "targetFps": 90,
                "maxDrawCalls": 80,
                "maxApkMb": 150,
                "deviceProfile": "android16-snapdragon8elite",
            }
        )
        self.assertEqual(contract.targetFps, 90)
        self.assertEqual(contract.maxDrawCalls, 80)
        self.assertEqual(contract.maxApkMb, 150)

    def test_apk_budget_must_be_positive(self):
        with self.assertRaises(BriefValidationError):
            PerformanceContract.from_dict({"maxApkMb": 0})


if __name__ == "__main__":
    unittest.main()
