"""Unit tests for B.2 spatial queries + named places + digest (hermetic).

Run from the repository root:
    python3 -m unittest harness.spatial.test_queries
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.action_applier import apply_actions  # noqa: E402
from harness.loop.prompts import repair_messages  # noqa: E402
from harness.spatial.spatial_audit import spatial_audit  # noqa: E402
from harness.spatial.spatial_queries import (  # noqa: E402
    QueryRunner,
    objects_in,
    scene_digest,
    validate_places,
)


def arena():
    return {
        "name": "Arena",
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [30, 1, 30],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            {
                "name": "Player",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [-8, 1.5, 0],
                "color": "#3b82f6",
                "physics": "dynamic",
                "controller": True,
            },
            {
                "name": "Pillar",
                "shape": "box",
                "size": [2, 6, 2],
                "position": [0, 3, 0],
                "color": "#78716c",
                "physics": "fixed",
            },
            {
                "name": "Imp",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [6, 1.5, 6],
                "color": "#ef4444",
                "physics": "none",
                "ai": {"targetName": "Player", "moveSpeed": 2},
            },
        ],
        "places": [
            {"name": "north gate", "position": [-8, 0.5, -12], "radius": 2},
            {"name": "plaza", "position": [4, 0.5, 6], "radius": 3},
        ],
    }


class PlaceValidationTests(unittest.TestCase):
    def test_valid_places(self):
        self.assertEqual(validate_places(arena()["places"]), [])
        self.assertEqual(validate_places(None), [])

    def test_problems(self):
        self.assertTrue(validate_places("nope"))
        self.assertTrue(validate_places([{"name": "", "position": [0, 0, 0]}]))
        self.assertTrue(
            validate_places(
                [
                    {"name": "a", "position": [0, 0, 0]},
                    {"name": "a", "position": [1, 0, 1]},
                ]
            )
        )
        self.assertTrue(validate_places([{"name": "a", "position": [0, "x", 0]}]))
        self.assertTrue(
            validate_places([{"name": "a", "position": [0, 0, 0], "radius": -1}])
        )


class QueryTests(unittest.TestCase):
    def test_named_and_place_contexts(self):
        runner = QueryRunner(arena())
        self.assertEqual(runner.named("Pillar")["shape"], "box")
        self.assertIsNone(runner.named("Ghost"))
        self.assertEqual(runner.place_position("north gate"), (-8, 0.5, -12))
        self.assertIsNone(runner.place_position("Ghost"))

    def test_within_sorted_by_distance(self):
        runner = QueryRunner(arena())
        found = runner.within(0, 0, 7)
        names = {o["name"] for o in found}
        self.assertEqual(names, {"Ground", "Pillar"})
        ordered = [o["name"] for o in found]
        self.assertLessEqual(ordered.index("Ground"), ordered.index("Pillar"))
        self.assertNotIn("Player", names)
        self.assertNotIn("Imp", names)

    def test_nearest_excludes_self(self):
        runner = QueryRunner(arena())
        nearest = runner.nearest(-8, 0, exclude="Player")
        self.assertNotEqual(nearest["name"], "Player")

    def test_walkable_los_reachable(self):
        runner = QueryRunner(arena())
        self.assertTrue(runner.is_walkable(-8, 0))
        self.assertFalse(runner.is_walkable(0, 0))
        self.assertTrue(runner.has_los(-8, 0, -8, 6))
        self.assertFalse(runner.has_los(-8, 0, 8, 0))
        self.assertTrue(runner.reachable(-8, 0, 6, 6))

    def test_camera_visible(self):
        runner = QueryRunner(arena())
        self.assertTrue(runner.camera_visible("Player"))
        self.assertIsNone(runner.camera_visible("Ghost"))

    def test_nearest_open_finds_spawn(self):
        runner = QueryRunner(arena())
        spot = runner.nearest_open(0, 0)  # inside the pillar
        self.assertIsNotNone(spot)
        self.assertTrue(runner.is_walkable(*spot))

    def test_nearest_cover_hides_from_threat(self):
        runner = QueryRunner(arena())
        # Imp at (6,6) threatens the player at (-8,0): cover hides behind pillar.
        cover = runner.nearest_cover(-8, 0, 6, 6)
        self.assertIsNotNone(cover)
        self.assertFalse(runner.has_los(cover["x"], cover["z"], 6, 6))

    def test_query_cover_eqs_shape(self):
        runner = QueryRunner(arena())
        result = runner.query_cover("Player", "Imp")
        self.assertIsNotNone(result["point"])
        self.assertFalse(
            runner.has_los(result["point"]["x"], result["point"]["z"], 6, 6)
        )
        self.assertTrue(
            runner.reachable(-8, 0, result["point"]["x"], result["point"]["z"])
        )
        self.assertGreater(result["candidates"], result["passing"])
        unknown = runner.query_cover("Ghost", "Imp")
        self.assertIsNone(unknown["point"])


class PlaceActionTests(unittest.TestCase):
    def test_define_and_remove(self):
        scene, result = apply_actions(
            {"gameObjects": []},
            [
                {
                    "type": "place",
                    "op": "define",
                    "place": {"name": "gate", "position": [0, 0.5, -12], "radius": 2},
                },
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["places"][0]["name"], "gate")
        scene, result = apply_actions(
            scene, [{"type": "place", "op": "remove", "name": "gate"}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["places"], [])

    def test_rejections_are_outcomes(self):
        scene, result = apply_actions(
            {"gameObjects": []},
            [
                {"type": "place", "op": "define", "place": {"name": "x"}},
                {
                    "type": "place",
                    "op": "define",
                    "place": {"name": "dup", "position": [0, 0, 0]},
                },
                {
                    "type": "place",
                    "op": "define",
                    "place": {"name": "dup", "position": [1, 0, 1]},
                },
                {"type": "place", "op": "remove", "name": "ghost"},
                {"type": "place", "op": "warp"},
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual([p["name"] for p in scene["places"]], ["dup"])
        statuses = [o["status"] for o in result.as_dict()["outcomes"]]
        self.assertIn("applied", statuses)
        self.assertTrue(
            all(s in ("applied", "invalid", "target-missing") for s in statuses)
        )


class PlacesAuditTests(unittest.TestCase):
    def test_good_places_pass(self):
        audit = spatial_audit(arena())
        self.assertTrue(audit["pass"], audit["defects"])

    def test_blocked_place_fails(self):
        scene = arena()
        scene["places"] = [{"name": "inside", "position": [0, 3, 0], "radius": 1}]
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])
        self.assertTrue(
            any(
                c["check"] == "place 'inside'" and not c["pass"]
                for c in audit["checks"]
            )
        )

    def test_floating_place_fails(self):
        scene = arena()
        scene["places"] = [{"name": "sky", "position": [-8, 30, 0], "radius": 1}]
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])

    def test_schema_problems_fail(self):
        scene = arena()
        scene["places"] = [{"name": "bad"}]
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])


class DigestTests(unittest.TestCase):
    def test_digest_compacts(self):
        text = scene_digest(arena())
        self.assertIn("4 objects", text)
        self.assertIn("Player", text)
        self.assertIn("north gate", text)

    def test_drill_down(self):
        rows = objects_in(arena(), -10, -10, -6, 2)
        self.assertEqual([r["name"] for r in rows], ["Player"])
        self.assertEqual(set(rows[0]), {"name", "kind", "position"})

    def test_repair_prompt_gains_digest_when_large(self):
        big = {
            "name": "Big",
            "gameObjects": [
                {"name": f"o{i}", "position": [i, 0, 0]} for i in range(60)
            ],
        }
        messages = repair_messages("goal", [], big, [], {}, 2)
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertIn("Scene digest", user)
        small = {"name": "Small", "gameObjects": [{"name": "o", "position": [0, 0, 0]}]}
        plain = repair_messages("goal", [], small, [], {}, 2)
        user_plain = next(m["content"] for m in plain if m["role"] == "user")
        self.assertNotIn("Scene digest", user_plain)


if __name__ == "__main__":
    unittest.main()
