"""Unit tests for the loop action applier (pure, no network/engine needed).

Run from the repository root:
    python3 -m unittest harness.loop.test_action_applier
"""

import copy
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.action_applier import apply_actions  # noqa: E402
from harness.validation.scene_invariants import validate_scene_invariants  # noqa: E402


def base_scene():
    return {
        "id": "loop_test",
        "name": "Loop Test Scene",
        "goal": "unit test",
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [20, 1, 20],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            }
        ],
        "rules": [],
    }


class SpawnTests(unittest.TestCase):
    def test_spawn_applies_with_defaults(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "spawn", "name": "Crate"}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(result.failures, 0)
        obj = scene["gameObjects"][1]
        self.assertEqual(obj["name"], "Crate")
        self.assertEqual(obj["shape"], "box")
        self.assertEqual(obj["physics"], "none")

    def test_spawn_controller_flag_maps_to_mobile_controller(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Player Capsule",
                    "shape": "capsule",
                    "physics": "dynamic",
                    "controller": True,
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertIs(scene["gameObjects"][1]["controller"], True)

    def test_modify_controller_flag(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "modify", "target": "Ground", "controller": True}]
        )
        self.assertEqual(result.applied, 1)
        self.assertIs(scene["gameObjects"][0]["controller"], True)

    def test_spawn_dynamic_carries_mass(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Hero",
                    "shape": "capsule",
                    "physics": "dynamic",
                    "mass": 2.5,
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["gameObjects"][1]["mass"], 2.5)

    def test_spawn_duplicate_name_is_invalid(self):
        _, result = apply_actions(base_scene(), [{"type": "spawn", "name": "Ground"}])
        self.assertEqual(result.invalid, 1)
        self.assertIn("already exists", result.outcomes[0]["detail"])

    def test_spawn_bad_shape_is_invalid(self):
        _, result = apply_actions(
            base_scene(), [{"type": "spawn", "name": "X", "shape": "pyramid"}]
        )
        self.assertEqual(result.invalid, 1)

    def test_spawn_non_finite_position_is_invalid(self):
        _, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "X", "position": [0, float("nan"), 0]}],
        )
        self.assertEqual(result.invalid, 1)

    def test_spawn_bad_color_is_invalid(self):
        _, result = apply_actions(
            base_scene(), [{"type": "spawn", "name": "X", "color": "red"}]
        )
        self.assertEqual(result.invalid, 1)


class LightTests(unittest.TestCase):
    def test_light_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "light",
                    "name": "Sun",
                    "lightType": "directional",
                    "intensity": 3.0,
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        light = scene["gameObjects"][1]
        self.assertEqual(light["kind"], "light")
        self.assertEqual(light["intensity"], 3.0)

    def test_light_bad_type_is_invalid(self):
        _, result = apply_actions(
            base_scene(), [{"type": "light", "name": "L", "lightType": "laser"}]
        )
        self.assertEqual(result.invalid, 1)


class VehicleTests(unittest.TestCase):
    def test_spawn_vehicle_config_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Player Car",
                    "shape": "box",
                    "physics": "dynamic",
                    "vehicle": {
                        "throttle": 1.0,
                        "wheels": [
                            {"offset": [-0.8, 0, 1.2]},
                            {"offset": [0.8, 0, -1.2]},
                        ],
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["vehicle"],
            {
                "throttle": 1.0,
                "wheels": [{"offset": [-0.8, 0.0, 1.2]}, {"offset": [0.8, 0.0, -1.2]}],
            },
        )

    def test_spawn_vehicle_rejects_non_dict(self):
        _, result = apply_actions(
            base_scene(), [{"type": "spawn", "name": "Car", "vehicle": "fast"}]
        )
        self.assertEqual(result.invalid, 1)

    def test_spawn_vehicle_rejects_bad_keys_and_values(self):
        _, result = apply_actions(
            base_scene(), [{"type": "spawn", "name": "Car", "vehicle": {"warp": 9}}]
        )
        self.assertEqual(result.invalid, 1)

    def test_spawn_vehicle_requires_wheels(self):
        _, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Car", "vehicle": {"throttle": 1.0}}],
        )
        self.assertEqual(result.invalid, 1)
        _, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Car",
                    "vehicle": {"throttle": 1.0, "wheels": []},
                }
            ],
        )
        self.assertEqual(result.invalid, 1)
        _, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Car",
                    "vehicle": {
                        "throttle": 1.0,
                        "wheels": [{"offset": [0, "high", 0]}],
                    },
                }
            ],
        )
        self.assertEqual(result.invalid, 1)
        _, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Car", "vehicle": {"throttle": "full"}}],
        )
        self.assertEqual(result.invalid, 1)

    def test_modify_vehicle_replaces_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Car", "physics": "dynamic"},
                {
                    "type": "modify",
                    "target": "Car",
                    "vehicle": {"throttle": 0.5, "wheels": [{"offset": [0, 0, 0]}]},
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(
            scene["gameObjects"][1]["vehicle"],
            {"throttle": 0.5, "wheels": [{"offset": [0.0, 0.0, 0.0]}]},
        )

    def test_modify_vehicle_rejects_malformed(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Car", "physics": "dynamic"},
                {"type": "modify", "target": "Car", "vehicle": [1, 2]},
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(result.invalid, 1)
        self.assertNotIn("vehicle", scene["gameObjects"][1])


class StreamerTests(unittest.TestCase):
    def test_spawn_streamer_config_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Player Hero",
                    "streamer": {"chunkSize": 16, "renderDistance": 1},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["streamer"],
            {"chunkSize": 16.0, "renderDistance": 1.0},
        )

    def test_spawn_streamer_defaults_to_empty_config(self):
        scene, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Player Hero", "streamer": {}}],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["gameObjects"][1]["streamer"], {})

    def test_spawn_streamer_rejects_malformed(self):
        for bad in (
            "fast",
            {"chunkSize": -16},
            {"chunkSize": "big"},
            {"warp": 9},
            {"chunkSize": 0},
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Car", "streamer": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")

    def test_modify_streamer_replaces_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Player Hero"},
                {
                    "type": "modify",
                    "target": "Player Hero",
                    "streamer": {"renderDistance": 2},
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(scene["gameObjects"][1]["streamer"], {"renderDistance": 2.0})


class ModifyTests(unittest.TestCase):
    def test_modify_position_and_color(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "modify",
                    "target": "Ground",
                    "position": [0, 0, 0],
                    "color": "#111111",
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["gameObjects"][0]["position"], [0, 0, 0])
        self.assertEqual(scene["gameObjects"][0]["color"], "#111111")

    def test_modify_missing_target(self):
        _, result = apply_actions(
            base_scene(), [{"type": "modify", "target": "Ghost", "color": "#ffffff"}]
        )
        self.assertEqual(result.target_missing, 1)

    def test_modify_without_supported_fields_is_invalid(self):
        _, result = apply_actions(
            base_scene(), [{"type": "modify", "target": "Ground", "shininess": 9}]
        )
        self.assertEqual(result.invalid, 1)


class DeleteTests(unittest.TestCase):
    def test_delete_removes(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "delete", "target": "Ground"}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["gameObjects"], [])

    def test_delete_missing_target(self):
        _, result = apply_actions(base_scene(), [{"type": "delete", "target": "Ghost"}])
        self.assertEqual(result.target_missing, 1)


class EventTests(unittest.TestCase):
    def test_event_appends_flat_schema(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "event",
                    "target": "Ground",
                    "event_name": "Spin",
                    "condition": "EveryFrame",
                    "action": "RotateY",
                    "params": {"speed": 1.5},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        event = scene["gameObjects"][0]["events"][0]
        self.assertEqual(event["name"], "Spin")
        self.assertEqual(event["conditions"][0]["type"], "EveryFrame")
        self.assertEqual(
            event["actions"][0], {"type": "RotateY", "params": {"speed": 1.5}}
        )

    def test_event_bad_condition_is_invalid(self):
        _, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "event",
                    "target": "Ground",
                    "condition": "OnExplode",
                    "action": "RotateY",
                }
            ],
        )
        self.assertEqual(result.invalid, 1)

    def test_event_missing_target(self):
        _, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "event",
                    "target": "Ghost",
                    "condition": "EveryFrame",
                    "action": "RotateY",
                }
            ],
        )
        self.assertEqual(result.target_missing, 1)


class PurityAndGateTests(unittest.TestCase):
    def test_original_scene_is_untouched(self):
        original = base_scene()
        snapshot = copy.deepcopy(original)
        apply_actions(
            original,
            [{"type": "spawn", "name": "New"}, {"type": "delete", "target": "Ground"}],
        )
        self.assertEqual(original, snapshot)

    def test_malformed_and_unknown_actions_are_outcomes(self):
        _, result = apply_actions(base_scene(), [None, {"type": "teleport"}, 42])
        self.assertEqual(result.invalid, 3)
        self.assertEqual(result.failures, 3)

    def test_generated_scene_passes_the_invariant_gate(self):
        actions = [
            {
                "type": "spawn",
                "name": "Hero",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 0],
                "physics": "dynamic",
                "mass": 1,
            },
            {
                "type": "spawn",
                "name": "Coin 1",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [-4, 1.2, 6],
                "color": "#fbbf24",
            },
            {
                "type": "light",
                "name": "Sunset",
                "lightType": "directional",
                "color": "#ffd7a8",
                "intensity": 2.5,
            },
            {
                "type": "event",
                "target": "Coin 1",
                "event_name": "Spin",
                "condition": "Timer",
                "condition_params": {"name": "coin1", "interval": 0.5},
                "action": "RotateY",
                "params": {"degrees": 20},
            },
        ]
        scene, result = apply_actions(base_scene(), actions)
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected generated scene: {violations}")


if __name__ == "__main__":
    unittest.main()
