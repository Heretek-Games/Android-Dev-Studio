"""
Unit tests for the 7-point scene invariant gate.

Run from the repository root:
    python3 -m unittest harness.validation.test_scene_invariants
"""

import copy
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.validation.scene_invariants import (  # noqa: E402
    MAX_MOBILE_DRAW_CALLS,
    MAX_PHYSICS_SPEED,
    validate_scene_invariants,
)


def base_scene():
    """A minimal valid scene in the flat store schema."""
    return {
        "id": "test_scene",
        "name": "TestScene",
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "physics": "fixed",
            },
            {
                "name": "Player",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 2, 0],
                "physics": "dynamic",
                "mass": 1.0,
                "controller": True,
            },
            {
                "name": "Coin",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [3, 1.2, 0],
                "events": [
                    {
                        "name": "Spin",
                        "conditions": [
                            {"type": "Timer", "params": {"name": "c", "interval": 1.0}}
                        ],
                        "actions": [{"type": "RotateY", "params": {"degrees": 20}}],
                    }
                ],
            },
            {
                "kind": "light",
                "name": "Sun",
                "lightType": "directional",
                "color": "#ffffff",
                "intensity": 2.5,
            },
        ],
    }


def codes(violations):
    return [v["code"] for v in violations]


class SceneInvariantTests(unittest.TestCase):
    def assert_fails_with(self, scene, code, msg=None):
        valid, violations = validate_scene_invariants(scene)
        self.assertFalse(valid, f"expected invalid scene, got valid (wanted {code})")
        self.assertIn(
            code, codes(violations), msg or f"expected {code}, got {codes(violations)}"
        )

    # ---- Positive ---------------------------------------------------------

    def test_valid_scene_passes(self):
        valid, violations = validate_scene_invariants(base_scene())
        self.assertTrue(valid, f"expected valid scene, got {violations}")

    def test_validation_does_not_mutate_input(self):
        scene = base_scene()
        before = copy.deepcopy(scene)
        validate_scene_invariants(scene)
        self.assertEqual(scene, before)

    def test_engine_exported_nested_schema_normalizes(self):
        scene = {
            "name": "EngineDump",
            "gameObjects": [
                {
                    "name": "Hero",
                    "transform": {
                        "position": [0, 2, 0],
                        "rotation": [0, 0, 0],
                        "scale": [1, 1, 1],
                    },
                    "components": [
                        {
                            "type": "MeshRenderer",
                            "shape": "capsule",
                            "size": [1, 1.5, 1],
                        },
                        {"type": "RigidBody3D", "bodyType": "dynamic", "mass": 1.0},
                        {"type": "Collider3D", "size": [1, 1.5, 1]},
                    ],
                },
                {
                    "name": "Sun",
                    "components": [
                        {"type": "LightComponent", "lightType": "directional"}
                    ],
                },
            ],
        }
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(
            valid, f"nested engine schema should normalize, got {violations}"
        )

    # ---- Invariant 1: finite transforms ------------------------------------

    def test_non_finite_position_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["position"] = [0, math.nan, 0]
        self.assert_fails_with(scene, "NON_FINITE_POSITION")

    def test_invalid_scale_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["scale"] = [1, 0, 1]
        self.assert_fails_with(scene, "INVALID_SCALE")

    # ---- Invariant 2: draw budget ------------------------------------------

    def test_draw_budget_exceeded_fails(self):
        scene = base_scene()
        for i in range(MAX_MOBILE_DRAW_CALLS):
            scene["gameObjects"].append(
                {
                    "name": f"Prop {i}",
                    "shape": "box",
                    "size": [1, 1, 1],
                    "position": [100 + i, 0, 0],
                }
            )
        self.assert_fails_with(scene, "DRAW_CALL_BUDGET_EXCEEDED")

    def test_batched_objects_do_not_count_against_budget(self):
        scene = base_scene()
        for i in range(MAX_MOBILE_DRAW_CALLS):
            scene["gameObjects"].append(
                {
                    "name": f"Foliage {i}",
                    "shape": "box",
                    "size": [0.2, 0.5, 0.2],
                    "position": [200 + i, 0, 0],
                    "batched": True,
                }
            )
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(
            valid, f"batched instances must not count as draws: {violations}"
        )

    # ---- Invariant 3: collision non-penetration -----------------------------

    def test_dynamic_inside_fixed_fails(self):
        scene = base_scene()
        scene["gameObjects"].append(
            {
                "name": "Buried Crate",
                "shape": "box",
                "size": [2, 2, 2],
                "position": [0, -0.5, 0],  # inside the Ground box
                "physics": "dynamic",
            }
        )
        self.assert_fails_with(scene, "COLLIDER_PENETRATION_AT_SPAWN")

    def test_dynamic_resting_on_fixed_passes(self):
        scene = base_scene()
        scene["gameObjects"].append(
            {
                "name": "Resting Crate",
                "shape": "box",
                "size": [2, 2, 2],
                "position": [5, 1.01, 0],  # sits on top of the ground, no overlap
                "physics": "dynamic",
            }
        )
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"resting crate should pass: {violations}")

    # ---- Invariant 4: entity identity ---------------------------------------

    def test_duplicate_names_fail(self):
        scene = base_scene()
        scene["gameObjects"].append(
            {"name": "Player", "shape": "box", "size": [1, 1, 1], "position": [8, 1, 0]}
        )
        self.assert_fails_with(scene, "DUPLICATE_ENTITY_NAME")

    def test_missing_name_fails(self):
        scene = base_scene()
        scene["gameObjects"].append(
            {"shape": "box", "size": [1, 1, 1], "position": [8, 1, 0]}
        )
        self.assert_fails_with(scene, "MISSING_ENTITY_NAME")

    # ---- Invariant 5: component contract ------------------------------------

    def test_invalid_shape_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["shape"] = "dodecahedron"
        self.assert_fails_with(scene, "INVALID_MESH_SHAPE")

    def test_invalid_physics_type_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["physics"] = "floaty"
        self.assert_fails_with(scene, "INVALID_PHYSICS_TYPE")

    def test_invalid_light_type_fails(self):
        scene = base_scene()
        scene["gameObjects"][3]["lightType"] = "laser"
        self.assert_fails_with(scene, "INVALID_LIGHT_TYPE")

    # ---- Invariant 6: event integrity ---------------------------------------

    def test_invalid_event_condition_fails(self):
        scene = base_scene()
        scene["gameObjects"][2]["events"][0]["conditions"] = [
            {"type": "WhenItFeelsLikeIt"}
        ]
        self.assert_fails_with(scene, "INVALID_EVENT_CONDITION")

    def test_invalid_event_action_fails(self):
        scene = base_scene()
        scene["gameObjects"][2]["events"][0]["actions"] = [{"type": "Explode"}]
        self.assert_fails_with(scene, "INVALID_EVENT_ACTION")

    def test_event_without_conditions_fails(self):
        scene = base_scene()
        scene["gameObjects"][2]["events"][0]["conditions"] = []
        self.assert_fails_with(scene, "MALFORMED_EVENT")

    def test_event_target_missing_entity_fails(self):
        scene = base_scene()
        scene["gameObjects"][2]["events"].append(
            {
                "name": "Chase",
                "target": "Nonexistent Enemy",
                "conditions": [{"type": "EveryFrame"}],
                "actions": [{"type": "Translate", "params": {"x": 1}}],
            }
        )
        self.assert_fails_with(scene, "MISSING_EVENT_TARGET")

    def test_event_target_existing_entity_passes(self):
        scene = base_scene()
        scene["gameObjects"][2]["events"].append(
            {
                "name": "Chase",
                "target": "Player",
                "conditions": [{"type": "EveryFrame"}],
                "actions": [{"type": "Translate", "params": {"x": 1}}],
            }
        )
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"existing target should pass: {violations}")

    # ---- Invariant 7: physics caps ------------------------------------------

    def test_velocity_cap_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["linearVelocity"] = [0, 0, MAX_PHYSICS_SPEED * 2]
        self.assert_fails_with(scene, "PHYSICS_SPEED_LIMIT_EXCEEDED")

    def test_angular_velocity_cap_fails(self):
        scene = base_scene()
        scene["gameObjects"][1]["angularVelocity"] = [0, 500, 0]
        self.assert_fails_with(scene, "PHYSICS_SPEED_LIMIT_EXCEEDED")

    def test_reasonable_velocity_passes(self):
        scene = base_scene()
        scene["gameObjects"][1]["linearVelocity"] = [0, -9.8, 0]
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"normal velocity should pass: {violations}")

    # ---- Root validation -----------------------------------------------------

    def test_missing_game_objects_fails(self):
        valid, violations = validate_scene_invariants({"name": "Empty"})
        self.assertTrue(valid, "scene without gameObjects key defaults to empty list")

    def test_non_list_game_objects_fails(self):
        valid, violations = validate_scene_invariants({"gameObjects": "nope"})
        self.assertFalse(valid)
        self.assertIn("INVALID_ROOT", codes(violations))


if __name__ == "__main__":
    unittest.main()
