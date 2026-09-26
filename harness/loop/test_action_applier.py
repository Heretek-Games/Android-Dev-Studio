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


class BiomeTests(unittest.TestCase):
    def test_spawn_biome_tag_applies_stripped(self):
        scene, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Dune", "biome": "  sand rim  "}],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["gameObjects"][1]["biome"], "sand rim")

    def test_spawn_biome_rejects_malformed(self):
        for bad in (42, "", "   ", "x" * 41, "sand;rim", "sand/rim"):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Dune", "biome": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")

    def test_modify_biome_tags_and_rejects(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Dune"},
                {"type": "modify", "target": "Dune", "biome": "grass infield"},
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(scene["gameObjects"][1]["biome"], "grass infield")

        rejected, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Dune"},
                {"type": "modify", "target": "Dune", "biome": ""},
            ],
        )
        self.assertEqual(result.invalid, 1)
        # The rejected tag leaves no residue on the object.
        self.assertNotIn("biome", rejected["gameObjects"][1])

    def test_tagged_scene_passes_the_invariant_gate(self):
        from harness.validation.scene_invariants import validate_scene_invariants

        scene, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Dune", "biome": "sand rim"}],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected tagged scene: {violations}")


class CombatQuestTests(unittest.TestCase):
    def test_spawn_weapon_and_health_apply(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Player Hero",
                    "shape": "capsule",
                    "physics": "dynamic",
                    "controller": True,
                    "weapon": {"damage": 50, "fireRate": 8},
                    "health": {"maxHealth": 100},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        hero = scene["gameObjects"][1]
        self.assertEqual(hero["weapon"], {"damage": 50.0, "fireRate": 8.0})
        self.assertEqual(hero["health"], {"maxHealth": 100.0})

    def test_spawn_weapon_and_health_reject_malformed(self):
        for bad_weapon in (
            True,
            "rifle",
            {"damage": -5},
            {"damage": "lots"},
            {"range": 10, "nope": 1},
        ):
            _, result = apply_actions(
                base_scene(),
                [{"type": "spawn", "name": "Hero", "weapon": bad_weapon}],
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad_weapon!r}")
        for bad_health in (
            True,
            [],
            {"maxHealth": 0},
            {"maxHealth": -10},
            {"destroyOnDeath": "yes"},
            {"regen": 5},
        ):
            _, result = apply_actions(
                base_scene(),
                [{"type": "spawn", "name": "Hero", "health": bad_health}],
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad_health!r}")

    def test_modify_weapon_and_health(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Hero"},
                {
                    "type": "modify",
                    "target": "Hero",
                    "weapon": {"damage": 25},
                    "health": {"maxHealth": 50, "destroyOnDeath": False},
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        hero = scene["gameObjects"][1]
        self.assertEqual(hero["weapon"], {"damage": 25.0})
        self.assertEqual(hero["health"], {"maxHealth": 50.0, "destroyOnDeath": False})

    def test_game_action_sets_scene_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "game",
                    "config": {
                        "mode": "waves",
                        "playerName": "Player Hero",
                        "totalWaves": 2,
                        "enemiesPerWave": 2,
                        "hitDamage": 50,
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["game"],
            {
                "mode": "waves",
                "playerName": "Player Hero",
                "totalWaves": 2.0,
                "enemiesPerWave": 2.0,
                "hitDamage": 50.0,
            },
        )

    def test_game_action_rejects_malformed(self):
        for bad in (
            None,
            "waves",
            {},
            {"mode": "boss-rush"},
            {"mode": "waves", "playerName": "  "},
            {"mode": "waves", "totalWaves": 0},
            {"mode": "waves", "hitDamage": float("inf")},
            {"mode": "waves", "enemy": {"shape": "dragon"}},
            {"mode": "waves", "settlement": {"targetPopulation": -1}},
            {"mode": "waves", "cheat": True},
        ):
            _, result = apply_actions(base_scene(), [{"type": "game", "config": bad}])
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")

    def test_game_rejection_names_the_offense(self):
        cases = [
            ({"mode": "boss-rush"}, "mode"),
            ({"mode": "waves", "playerName": "  "}, "playerName"),
            ({"mode": "waves", "totalWaves": 0}, "totalWaves"),
            ({"mode": "waves", "cheat": True}, "cheat"),
            ({"mode": "build", "settlement": {"placements": {}}}, "placements"),
            ({"mode": "waves", "enemy": {"shape": "dragon"}}, "shape"),
        ]
        for bad, hint in cases:
            _, result = apply_actions(base_scene(), [{"type": "game", "config": bad}])
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            detail = result.outcomes[0]["detail"]
            self.assertIn(hint, detail, f"rejection should name '{hint}': {detail}")

    def test_settlement_plots_validate_type_and_grid(self):
        good = {
            "mode": "build",
            "settlement": {
                "gridSize": 8,
                "targetPopulation": 6,
                "placements": [
                    {"type": "house", "x": 0, "z": 0},
                    {"type": "farm", "x": 1, "z": 0},
                ],
            },
        }
        scene, result = apply_actions(base_scene(), [{"type": "game", "config": good}])
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["game"]["settlement"]["placements"],
            [
                {"type": "house", "x": 0, "z": 0},
                {"type": "farm", "x": 1, "z": 0},
            ],
        )
        bad_plots = [
            [{"tpye": "house", "x": 0, "z": 0}],
            [{"type": "castle", "x": 0, "z": 0}],
            [{"type": "house", "x": -1, "z": 0}],
            [{"type": "house", "x": 8, "z": 0}],
            [{"type": "house", "x": 0.5, "z": 0}],
            [{"type": "house", "x": 0}],
            ["house"],
        ]
        for plots in bad_plots:
            bad = {"mode": "build", "settlement": {"placements": plots}}
            _, result = apply_actions(base_scene(), [{"type": "game", "config": bad}])
            self.assertEqual(result.invalid, 1, f"should reject {plots!r}")
            self.assertIn(
                "placements",
                result.outcomes[0]["detail"],
                f"rejection should name placements: {result.outcomes[0]['detail']}",
            )

    def test_quest_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Player Hero",
                    "shape": "capsule",
                    "position": [0, 1.5, 0],
                    "physics": "dynamic",
                    "controller": True,
                    "weapon": {"damage": 50},
                    "health": {"maxHealth": 100},
                },
                {
                    "type": "game",
                    "config": {
                        "mode": "waves",
                        "playerName": "Player Hero",
                        "totalWaves": 2,
                    },
                },
            ],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected quest scene: {violations}")


class NpcRoutineTests(unittest.TestCase):
    def test_spawn_ai_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Goblin",
                    "shape": "capsule",
                    "physics": "dynamic",
                    "ai": {"targetName": "Player Hero", "moveSpeed": 3.0},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["ai"],
            {"targetName": "Player Hero", "moveSpeed": 3.0},
        )

    def test_spawn_ai_rejects_malformed(self):
        for bad in (
            True,
            "Player Hero",
            {"targetName": "  "},
            {"targetName": "Player Hero", "moveSpeed": -1},
            {"targetName": "Player Hero", "aggroRange": float("inf")},
            {"targetName": "Player Hero", "brain": "smart"},
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Goblin", "ai": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")

    def test_modify_ai_replaces_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Goblin",
                    "ai": {"targetName": "Player Hero"},
                },
                {
                    "type": "modify",
                    "target": "Goblin",
                    "ai": {"targetName": "Player Hero", "attackDamage": 15},
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(
            scene["gameObjects"][1]["ai"],
            {"targetName": "Player Hero", "attackDamage": 15.0},
        )

    def test_npc_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Goblin",
                    "shape": "capsule",
                    "position": [5, 1.5, 0],
                    "physics": "dynamic",
                    "ai": {"targetName": "Player Hero"},
                }
            ],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected NPC scene: {violations}")


class ElementalTests(unittest.TestCase):
    def test_spawn_elemental_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Slime",
                    "shape": "sphere",
                    "physics": "none",
                    "elemental": {"aura": "Pyro", "maxHealth": 80},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["elemental"],
            {"aura": "Pyro", "maxHealth": 80.0},
        )

    def test_spawn_elemental_rejects_malformed(self):
        for bad in (True, "Pyro"):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Slime", "elemental": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
        for bad, hint in (
            ({"aura": "Fire"}, "aura"),
            ({"aura": "Pyro", "maxHealth": 0}, "maxHealth"),
            ({"aura": "Pyro", "color": "orange"}, "color"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Slime", "elemental": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_game_hitelement_and_enemy_elemental_apply(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "game",
                    "config": {
                        "mode": "waves",
                        "playerName": "Hero",
                        "hitElement": "Hydro",
                        "hitGauge": 1,
                        "enemy": {"elemental": {"aura": "Pyro"}},
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        game = scene["game"]
        self.assertEqual(game["hitElement"], "Hydro")
        self.assertEqual(game["enemy"]["elemental"], {"aura": "Pyro"})

    def test_game_rejects_bad_element(self):
        _, result = apply_actions(
            base_scene(),
            [{"type": "game", "config": {"mode": "waves", "hitElement": "Fire"}}],
        )
        self.assertEqual(result.invalid, 1)
        self.assertIn("hitElement", result.outcomes[0]["detail"])


class CelShadingTests(unittest.TestCase):
    def test_spawn_cel_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Hero",
                    "shape": "capsule",
                    "cel": {
                        "baseColor": "#38bdf8",
                        "shadowColor": "#1e3a8a",
                        "rimPower": 3.5,
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["cel"],
            {"baseColor": "#38bdf8", "shadowColor": "#1e3a8a", "rimPower": 3.5},
        )

    def test_spawn_cel_rejects_malformed(self):
        for bad, hint in (
            (True, "object"),
            ({"baseColor": "blue"}, "baseColor"),
            ({"rimPower": -1}, "rimPower"),
            ({"lightDirection": [0, 1, 0]}, "lightDirection"),
            ({"dissolve": 2}, "dissolve"),
            ({"dissolve": -0.5}, "dissolve"),
            ({"dissolveEdgeColor": "pink"}, "dissolveEdgeColor"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Hero", "cel": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_spawn_cel_dissolve_applies(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Wraith",
                    "shape": "capsule",
                    "cel": {
                        "baseColor": "#a5b4fc",
                        "dissolve": 0.35,
                        "dissolveEdgeColor": "#f472b6",
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["cel"],
            {"baseColor": "#a5b4fc", "dissolve": 0.35, "dissolveEdgeColor": "#f472b6"},
        )

    def test_modify_cel_replaces_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {"type": "spawn", "name": "Hero"},
                {"type": "modify", "target": "Hero", "cel": {"outlineThickness": 0.05}},
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(scene["gameObjects"][1]["cel"], {"outlineThickness": 0.05})

    def test_cel_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(),
            [{"type": "spawn", "name": "Hero", "cel": {"rimPower": 3.5}}],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected cel scene: {violations}")


class BehaviorArrayTests(unittest.TestCase):
    def test_spawn_behaviors_attach(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Walker",
                    "physics": "none",
                    "behaviors": [
                        {
                            "type": "TopDownMovement",
                            "options": {"moveSpeed": 5, "simulate": {"x": 1, "y": 0}},
                        },
                        {"type": "Tween", "options": {}},
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["behaviors"],
            [
                {
                    "type": "TopDownMovement",
                    "options": {"moveSpeed": 5.0, "simulate": {"x": 1.0, "y": 0.0}},
                },
                {"type": "Tween", "options": {}},
            ],
        )

    def test_spawn_behaviors_reject_malformed(self):
        for bad, hint in (
            (True, "array"),
            ([], "non-empty"),
            ([{"options": {}}], "TopDownMovement"),
            ([{"type": "Fly", "options": {}}], "Fly"),
            ([{"type": "TopDownMovement", "options": {"moveSpeed": -1}}], "moveSpeed"),
            (
                [{"type": "TopDownMovement", "options": {"allowDiagonals": "yes"}}],
                "allowDiagonals",
            ),
            (
                [{"type": "TopDownMovement", "options": {"simulate": {"x": 1}}}],
                "simulate",
            ),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "behaviors": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_behavior_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Walker",
                    "physics": "none",
                    "behaviors": [{"type": "Tween", "options": {}}],
                }
            ],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected behavior scene: {violations}")

    def test_draggable_and_destroy_outside_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Crate",
                    "physics": "none",
                    "behaviors": [
                        {
                            "type": "Draggable",
                            "options": {"axisLock": "x", "snapBack": True},
                        },
                        {"type": "DestroyOutsideScreen", "options": {"margin": 25}},
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        behaviors = scene["gameObjects"][1]["behaviors"]
        self.assertEqual(behaviors[0]["options"], {"axisLock": "x", "snapBack": True})
        self.assertEqual(behaviors[1]["options"], {"margin": 25.0})

        for bad, hint in (
            ([{"type": "Draggable", "options": {"axisLock": "diagonal"}}], "axisLock"),
            (
                [{"type": "Draggable", "options": {"dragTarget": {"x": 1}}}],
                "dragTarget",
            ),
            ([{"type": "DestroyOutsideScreen", "options": {"margin": -5}}], "margin"),
            ([{"type": "DestroyOutsideScreen", "options": {"radius": 5}}], "radius"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "behaviors": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_platformer_and_platform_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Hero",
                    "physics": "none",
                    "behaviors": [
                        {
                            "type": "PlatformerCharacter",
                            "options": {
                                "moveSpeed": 6,
                                "maxJumps": 2,
                                "simulate": {"x": 1, "jump": False},
                            },
                        },
                        {"type": "Platform", "options": {"platformType": "jumpthru"}},
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        behaviors = scene["gameObjects"][1]["behaviors"]
        self.assertEqual(behaviors[0]["options"]["maxJumps"], 2)
        self.assertEqual(behaviors[1]["options"], {"platformType": "jumpthru"})

        for bad, hint in (
            (
                [{"type": "PlatformerCharacter", "options": {"jumpForce": -1}}],
                "jumpForce",
            ),
            ([{"type": "PlatformerCharacter", "options": {"maxJumps": 0}}], "maxJumps"),
            (
                [{"type": "PlatformerCharacter", "options": {"maxJumps": 1.5}}],
                "maxJumps",
            ),
            (
                [{"type": "PlatformerCharacter", "options": {"simulate": {"x": 1}}}],
                "simulate",
            ),
            (
                [{"type": "Platform", "options": {"platformType": "cloud"}}],
                "platformType",
            ),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "behaviors": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_pathfollow_and_timer_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Patrol",
                    "physics": "none",
                    "behaviors": [
                        {
                            "type": "Pathfollow",
                            "options": {
                                "waypoints": [{"x": -5, "z": 0}, {"x": 5, "z": 0}],
                                "moveSpeed": 4,
                                "mode": "pingpong",
                            },
                        },
                        {"type": "Timer", "options": {"duration": 2, "repeat": True}},
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        behaviors = scene["gameObjects"][1]["behaviors"]
        self.assertEqual(len(behaviors[0]["options"]["waypoints"]), 2)
        self.assertEqual(behaviors[1]["options"], {"duration": 2.0, "repeat": True})

        for bad, hint in (
            ([{"type": "Pathfollow", "options": {"waypoints": []}}], "waypoints"),
            (
                [{"type": "Pathfollow", "options": {"waypoints": [{"x": 1}]}}],
                "waypoints",
            ),
            ([{"type": "Pathfollow", "options": {"mode": "random"}}], "mode"),
            ([{"type": "Pathfollow", "options": {"moveSpeed": -1}}], "moveSpeed"),
            ([{"type": "Timer", "options": {"duration": 0}}], "duration"),
            ([{"type": "Timer", "options": {"repeat": "yes"}}], "repeat"),
            ([{"type": "Timer", "options": {"period": 5}}], "period"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "behaviors": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_spawner_and_saveslot_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Nest",
                    "physics": "none",
                    "behaviors": [
                        {
                            "type": "Spawner",
                            "options": {
                                "interval": 2,
                                "maxSpawns": 5,
                                "template": {"shape": "sphere", "color": "#ff0000"},
                            },
                        },
                        {
                            "type": "SaveSlot",
                            "options": {
                                "slotName": "checkpoint1",
                                "autosaveInterval": 10,
                            },
                        },
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        behaviors = scene["gameObjects"][1]["behaviors"]
        self.assertEqual(behaviors[0]["options"]["maxSpawns"], 5)
        self.assertEqual(behaviors[0]["options"]["template"]["shape"], "sphere")
        self.assertEqual(behaviors[1]["options"]["slotName"], "checkpoint1")

        for bad, hint in (
            ([{"type": "Spawner", "options": {"interval": 0}}], "interval"),
            ([{"type": "Spawner", "options": {"maxSpawns": -1}}], "maxSpawns"),
            ([{"type": "Spawner", "options": {"maxSpawns": 1.5}}], "maxSpawns"),
            ([{"type": "Spawner", "options": {"spawnRadius": -2}}], "spawnRadius"),
            ([{"type": "Spawner", "options": {"spawnOffset": [1, 2]}}], "spawnOffset"),
            (
                [{"type": "Spawner", "options": {"template": {"shape": "dragon"}}}],
                "shape",
            ),
            ([{"type": "Spawner", "options": {"template": {"color": "red"}}}], "color"),
            ([{"type": "SaveSlot", "options": {"slotName": ""}}], "slotName"),
            (
                [{"type": "SaveSlot", "options": {"autosaveInterval": -1}}],
                "autosaveInterval",
            ),
            ([{"type": "SaveSlot", "options": {"slot": "a"}}], "slot"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "behaviors": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_particle_options_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Sparks",
                    "physics": "none",
                    "particle": {
                        "rate": 60,
                        "maxParticles": 200,
                        "shape": "sphere",
                        "direction": [0, 1, 0],
                        "speedMin": 2,
                        "speedMax": 5,
                        "lifetimeMin": 0.5,
                        "lifetimeMax": 1.5,
                        "startColor": "#ffaa00",
                        "endColor": "#ff0000",
                        "blending": "additive",
                        "seed": 7,
                        "tier": "S",
                        "governorEnabled": True,
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        particle = scene["gameObjects"][1]["particle"]
        self.assertEqual(particle["maxParticles"], 200)
        self.assertEqual(particle["shape"], "sphere")
        self.assertEqual(particle["tier"], "S")
        self.assertEqual(particle["governorEnabled"], True)

        for bad, hint in (
            ({"rate": -1}, "rate"),
            ({"maxParticles": 0}, "maxParticles"),
            ({"maxParticles": 2.5}, "maxParticles"),
            ({"shape": "cone"}, "shape"),
            ({"direction": [0, 1]}, "direction"),
            ({"speedMin": 5, "speedMax": 2}, "speedMin"),
            ({"lifetimeMin": 2, "lifetimeMax": 1}, "lifetimeMin"),
            ({"startColor": "red"}, "startColor"),
            ({"blending": "multiply"}, "blending"),
            ({"spread": 4}, "spread"),
            ({"opacity": 2}, "opacity"),
            ({"friction": 1}, "friction"),
            ({"tier": "XXL"}, "tier"),
            ({"governorEnabled": "yes"}, "governorEnabled"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "particle": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

    def test_anim_and_timeline_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Dancer",
                    "physics": "none",
                    "anim": {
                        "states": {
                            "Idle": {"clip": "idle", "clipLength": 2},
                            "Run": {"clip": "run", "clipLength": 1},
                        },
                        "initial": "Idle",
                        "transitions": [
                            {
                                "from": "Idle",
                                "to": "Run",
                                "conditions": [
                                    {"param": "speed", "op": ">", "value": 0.5}
                                ],
                            },
                            {
                                "from": "*",
                                "to": "Idle",
                                "conditions": [{"param": "stop", "op": "trigger"}],
                            },
                        ],
                    },
                    "timeline": {
                        "duration": 4,
                        "tracks": [
                            {
                                "target": "Dancer",
                                "clips": [
                                    {
                                        "id": "m1",
                                        "start": 1,
                                        "dur": 2,
                                        "type": "move",
                                        "data": {"to": [6, 0, 0]},
                                    },
                                    {
                                        "id": "e1",
                                        "start": 3,
                                        "type": "event",
                                        "data": {"name": "finale"},
                                    },
                                ],
                            },
                        ],
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        obj = scene["gameObjects"][1]
        self.assertEqual(obj["anim"]["initial"], "Idle")
        self.assertEqual(len(obj["anim"]["transitions"]), 2)
        self.assertEqual(obj["timeline"]["tracks"][0]["clips"][1]["type"], "event")

        for bad_field, bad, hint in (
            ("anim", {"states": {}}, "states"),
            ("anim", {"states": {"A": {}}}, "clip"),
            ("anim", {"states": {"A": {"clip": "a"}}, "initial": "B"}, "initial"),
            (
                "anim",
                {
                    "states": {"A": {"clip": "a"}},
                    "transitions": [{"from": "A", "to": "B"}],
                },
                "to",
            ),
            (
                "anim",
                {
                    "states": {"A": {"clip": "a"}},
                    "transitions": [
                        {
                            "from": "A",
                            "to": "A",
                            "conditions": [{"param": "x", "op": "~"}],
                        }
                    ],
                },
                "op",
            ),
            ("timeline", {"tracks": []}, "tracks"),
            ("timeline", {"tracks": [{"target": "X", "clips": []}]}, "clips"),
            (
                "timeline",
                {
                    "tracks": [
                        {
                            "target": "X",
                            "clips": [{"id": "c", "start": -1, "type": "move"}],
                        }
                    ]
                },
                "start",
            ),
            (
                "timeline",
                {
                    "tracks": [
                        {
                            "target": "X",
                            "clips": [{"id": "c", "start": 0, "type": "warp"}],
                        }
                    ]
                },
                "type",
            ),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", bad_field: bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


def keeper_tree():
    return {
        "id": "DungeonKeeper",
        "title": "The Dungeon Keeper",
        "startNodeId": "greet",
        "nodes": {
            "greet": {
                "id": "greet",
                "type": "choice",
                "speaker": "Dungeon Keeper",
                "text": "Take the blessing?",
                "choices": [
                    {"id": "bless", "text": "Take it", "nextNodeId": "blessed"},
                    {"id": "refuse", "text": "Refuse", "nextNodeId": "refused"},
                ],
            },
            "blessed": {
                "id": "blessed",
                "type": "action",
                "action": {
                    "setVariables": {"hydroBlessing": True},
                    "emitEvent": {"eventName": "hydro_blessing"},
                },
                "nextNodeId": "farewell",
            },
            "refused": {
                "id": "refused",
                "type": "text",
                "text": "Stubborn.",
                "nextNodeId": "farewell",
            },
            "farewell": {"id": "farewell", "type": "end"},
        },
    }


class DialogueActionTests(unittest.TestCase):
    def test_dialogue_action_registers_tree(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "dialogue", "tree": keeper_tree()}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["dialogues"]["DungeonKeeper"]["startNodeId"], "greet")

    def test_dialogue_action_rejects_dangling_refs(self):
        bad = keeper_tree()
        bad["nodes"]["greet"]["choices"][0]["nextNodeId"] = "missing"
        _, result = apply_actions(base_scene(), [{"type": "dialogue", "tree": bad}])
        self.assertEqual(result.invalid, 1)
        self.assertIn("missing", result.outcomes[0]["detail"])

        bad_start = keeper_tree()
        bad_start["startNodeId"] = "nowhere"
        _, result = apply_actions(
            base_scene(), [{"type": "dialogue", "tree": bad_start}]
        )
        self.assertEqual(result.invalid, 1)
        self.assertIn("startNodeId", result.outcomes[0]["detail"])

    def test_dialogue_action_rejects_malformed(self):
        for bad in (
            None,
            "Keeper",
            {},
            {"id": "K", "startNodeId": "greet", "nodes": {}},
            {
                "id": "  ",
                "startNodeId": "greet",
                "nodes": {"greet": {"id": "greet", "type": "end"}},
            },
            {
                "id": "K",
                "startNodeId": "greet",
                "nodes": {"greet": {"id": "greet", "type": "monologue"}},
            },
            {
                "id": "K",
                "startNodeId": "greet",
                "nodes": {"greet": {"id": "greet", "type": "choice", "choices": []}},
            },
        ):
            _, result = apply_actions(base_scene(), [{"type": "dialogue", "tree": bad}])
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")

    def test_dialogue_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(), [{"type": "dialogue", "tree": keeper_tree()}]
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected dialogue scene: {violations}")

    def test_dialogue_action_payload_validates_emit_shape(self):
        # The classic miss: flag set, event never fired (bare event/fireEvent keys).
        bad = keeper_tree()
        bad["nodes"]["blessed"]["action"] = {
            "setVariables": {"hydroBlessing": True},
            "event": "hydro_blessing",
            "fireEvent": "hydro_blessing",
        }
        _, result = apply_actions(base_scene(), [{"type": "dialogue", "tree": bad}])
        self.assertEqual(result.invalid, 1)
        self.assertIn("fireEvent", result.outcomes[0]["detail"])

        good = keeper_tree()
        good["nodes"]["blessed"]["action"] = {
            "setVariables": {"hydroBlessing": True},
            "emitEvent": {"eventName": "hydro_blessing"},
        }
        scene, result = apply_actions(
            base_scene(), [{"type": "dialogue", "tree": good}]
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["dialogues"]["DungeonKeeper"]["nodes"]["blessed"]["action"],
            {
                "setVariables": {"hydroBlessing": True},
                "emitEvent": {"eventName": "hydro_blessing"},
            },
        )


class LocaleActionTests(unittest.TestCase):
    def test_locale_config_registers_tables(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "locale",
                    "config": {
                        "locale": "es",
                        "tables": {
                            "es": {"dialogue.keeper.greet": "Hola, héroe."},
                            "en": {"dialogue.keeper.greet": "Hello, hero."},
                        },
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["localization"]["locale"], "es")
        self.assertEqual(
            scene["localization"]["tables"]["es"]["dialogue.keeper.greet"],
            "Hola, héroe.",
        )

    def test_locale_config_rejects_malformed(self):
        for bad, hint in (
            ({"locale": "es"}, "tables"),
            ({"locale": "", "tables": {"en": {}}}, "locale"),
            ({"locale": "es", "tables": {}}, "tables"),
            ({"locale": "es", "tables": {"en": {"k": 5}}}, "strings"),
            ({"locale": "es", "tables": {"en": {"k": "v"}}, "x": 1}, "x"),
        ):
            _, result = apply_actions(base_scene(), [{"type": "locale", "config": bad}])
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class InputActionTests(unittest.TestCase):
    def test_input_action_registers_map_and_script(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "input",
                    "map": {
                        "actions": {
                            "jump": {
                                "type": "button",
                                "bindings": [{"source": "key", "code": "Space"}],
                            },
                            "move": {
                                "type": "axis2",
                                "bindings": [
                                    {
                                        "source": "key",
                                        "code": "KeyW",
                                        "output2": [0, 1],
                                    },
                                    {
                                        "source": "key",
                                        "code": "KeyS",
                                        "output2": [0, -1],
                                    },
                                ],
                            },
                        }
                    },
                    "script": [
                        {"action": "jump", "value": True, "start": 10, "frames": 5},
                        {
                            "action": "move",
                            "value": {"x": 0, "y": 1},
                            "start": 0,
                            "frames": 30,
                        },
                    ],
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["inputmap"]["actions"]["jump"]["bindings"],
            [{"source": "key", "code": "Space"}],
        )
        self.assertEqual(len(scene["inputScript"]), 2)
        self.assertEqual(scene["inputScript"][0]["frames"], 5)

    def test_input_action_rejects_malformed(self):
        good_map = {
            "actions": {
                "jump": {
                    "type": "button",
                    "bindings": [{"source": "key", "code": "Space"}],
                }
            }
        }
        for kwargs, hint in (
            ({"map": {"actions": {}}}, "actions"),
            (
                {"map": {"actions": {"jump": {"type": "trigger", "bindings": []}}}},
                "button",
            ),
            (
                {"map": {"actions": {"jump": {"type": "button", "bindings": []}}}},
                "bindings",
            ),
            (
                {
                    "map": {
                        "actions": {
                            "jump": {
                                "type": "button",
                                "bindings": [{"source": "mouse", "code": "L"}],
                            }
                        }
                    }
                },
                "source",
            ),
            (
                {
                    "map": {
                        "actions": {
                            "jump": {
                                "type": "button",
                                "bindings": [{"source": "stick", "code": "middle"}],
                            }
                        }
                    }
                },
                "left|right",
            ),
            (
                {
                    "map": {
                        "actions": {
                            "jump": {
                                "type": "button",
                                "bindings": [{"source": "gamepad-button", "code": "z"}],
                            }
                        }
                    }
                },
                "gamepad button",
            ),
            (
                {
                    "map": {
                        "actions": {
                            "move": {
                                "type": "axis2",
                                "bindings": [{"source": "key", "code": "KeyW"}],
                            }
                        }
                    }
                },
                "output2",
            ),
            ({"map": good_map, "script": [{"action": "fly", "value": True}]}, "fly"),
            (
                {"map": good_map, "script": [{"action": "jump", "value": "hard"}]},
                "value",
            ),
            (
                {
                    "map": good_map,
                    "script": [{"action": "jump", "value": True, "frames": 0}],
                },
                "frames",
            ),
        ):
            _, result = apply_actions(base_scene(), [{"type": "input", **kwargs}])
            self.assertEqual(result.invalid, 1, f"should reject {kwargs!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class MixerActionTests(unittest.TestCase):
    def test_mixer_action_registers_buses_ducks_snapshots(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "mixer",
                    "config": {
                        "buses": {"music": {"gainDb": -6}, "dialogue": {}},
                        "duckRules": [
                            {"trigger": "dialogue", "target": "music", "depthDb": -12}
                        ],
                        "snapshots": {"quiet": {"music": -24}},
                    },
                },
                {
                    "type": "spawn",
                    "name": "Jukebox",
                    "physics": "none",
                    "audio": {
                        "clipId": "song",
                        "bus": "music",
                        "volume": 0.8,
                        "loop": True,
                    },
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(scene["mixer"]["buses"]["music"]["gainDb"], -6)
        self.assertEqual(scene["gameObjects"][1]["audio"]["clipId"], "song")

    def test_mixer_and_audio_reject_malformed(self):
        for action, hint in (
            ({"type": "mixer", "config": {}}, "at least one"),
            (
                {"type": "mixer", "config": {"buses": {"a": {"send": "b"}}}},
                "unknown bus",
            ),
            (
                {
                    "type": "mixer",
                    "config": {"buses": {"a": {"send": "b"}, "b": {"send": "a"}}},
                },
                "cycle",
            ),
            (
                {
                    "type": "mixer",
                    "config": {
                        "buses": {"m": {}},
                        "duckRules": [{"trigger": "x", "target": "m"}],
                    },
                },
                "defined bus",
            ),
            (
                {"type": "mixer", "config": {"snapshots": {"q": {"m": -3}}}},
                "defined buses",
            ),
            ({"type": "spawn", "name": "W", "audio": {}}, "clipId"),
            (
                {"type": "spawn", "name": "W", "audio": {"clipId": "c", "volume": 2}},
                "volume",
            ),
            (
                {"type": "spawn", "name": "W", "audio": {"clipId": "c", "nope": 1}},
                "nope",
            ),
        ):
            _, result = apply_actions(base_scene(), [action])
            self.assertEqual(result.invalid, 1, f"should reject {action!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class NavGridActionTests(unittest.TestCase):
    def test_navgrid_and_nav_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "navgrid",
                    "config": {
                        "width": 16,
                        "height": 16,
                        "obstacles": [{"x": 7.5, "z": 7.5, "hx": 4, "hz": 0.5}],
                    },
                },
                {
                    "type": "spawn",
                    "name": "Scout",
                    "physics": "none",
                    "nav": {
                        "target": [14, 14],
                        "speed": 4,
                        "links": [{"ax": 3.5, "az": 2.5, "bx": 8.5, "bz": 2.5}],
                    },
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        self.assertEqual(scene["navgrid"]["width"], 16)
        self.assertEqual(scene["gameObjects"][1]["nav"]["target"], [14.0, 14.0])

    def test_navgrid_and_nav_reject_malformed(self):
        scene, result = apply_actions(base_scene(), [{"type": "navgrid", "config": {}}])
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["navgrid"]["width"], 32)
        for action, hint in (
            ({"type": "navgrid", "config": {"width": 1}}, "2..256"),
            ({"type": "navgrid", "config": {"width": 300}}, "2..256"),
            ({"type": "navgrid", "config": {"obstacles": [{"x": 1}]}}, "finite"),
            ({"type": "spawn", "name": "W", "nav": {}}, "target"),
            ({"type": "spawn", "name": "W", "nav": {"target": [1]}}, "pair"),
            (
                {"type": "spawn", "name": "W", "nav": {"target": [1, 2], "speed": -1}},
                "speed",
            ),
            (
                {
                    "type": "spawn",
                    "name": "W",
                    "nav": {"target": [1, 2], "links": [{"ax": 0}]},
                },
                "finite",
            ),
        ):
            _, result = apply_actions(base_scene(), [action])
            self.assertEqual(result.invalid, 1, f"should reject {action!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class LightRigActionTests(unittest.TestCase):
    def test_lightrig_action_registers_probes_and_lut(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "lightrig",
                    "config": {
                        "probes": [
                            {"position": [0, 3, 0], "radius": 10},
                            {"position": [8, 3, 8]},
                        ],
                        "lut": {"preset": "sunset", "amount": 0.6},
                        "bakeAmbient": True,
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(len(scene["lightrig"]["probes"]), 2)
        self.assertEqual(scene["lightrig"]["lut"]["preset"], "sunset")

    def test_lightrig_rejects_malformed(self):
        for action, hint in (
            (
                {"type": "lightrig", "config": {"probes": [{"position": [0, 1]}]}},
                "3 finite",
            ),
            (
                {
                    "type": "lightrig",
                    "config": {"probes": [{"position": [0, 1, 2], "radius": 0}]},
                },
                "positive",
            ),
            (
                {"type": "lightrig", "config": {"lut": {"preset": "film"}}},
                "neutral|sunset",
            ),
            (
                {"type": "lightrig", "config": {"lut": {"size": 4, "data": [0]}}},
                "size^3",
            ),
            ({"type": "lightrig", "config": {"lut": {"amount": 2}}}, "0..1"),
            ({"type": "lightrig", "config": {"nope": 1}}, "nope"),
        ):
            _, result = apply_actions(base_scene(), [action])
            self.assertEqual(result.invalid, 1, f"should reject {action!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class CineActionTests(unittest.TestCase):
    def test_cine_options_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Cam",
                    "physics": "none",
                    "cine": {"traumaDecay": 1.5, "baseFov": 55},
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(
            scene["gameObjects"][1]["cine"], {"traumaDecay": 1.5, "baseFov": 55.0}
        )

    def test_cine_options_reject_malformed(self):
        for bad, hint in (
            ({"traumaDecay": -1}, "traumaDecay"),
            ({"baseFov": 0}, "baseFov"),
            ({"fovKick": "high"}, "fovKick"),
            ({"dolly": {}}, "dolly"),
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "W", "cine": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class DestructActionTests(unittest.TestCase):
    def test_destruct_options_validate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "spawn",
                    "name": "Crate",
                    "physics": "dynamic",
                    "mass": 2.0,
                    "destruct": {
                        "shardGrid": [2, 2, 2],
                        "impulseThreshold": 60,
                        "dustBurst": 12,
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        destruct = scene["gameObjects"][1]["destruct"]
        self.assertEqual(destruct["shardGrid"], [2, 2, 2])
        self.assertEqual(destruct["impulseThreshold"], 60.0)

    def test_destruct_rejects_malformed_and_physics_none(self):
        for action, hint in (
            (
                {"type": "spawn", "name": "W", "destruct": {"impulseThreshold": 5}},
                "physics",
            ),
            (
                {
                    "type": "spawn",
                    "name": "W",
                    "physics": "dynamic",
                    "destruct": {"shardGrid": [0, 2, 2]},
                },
                "shardGrid",
            ),
            (
                {
                    "type": "spawn",
                    "name": "W",
                    "physics": "dynamic",
                    "destruct": {"dustColor": "brown"},
                },
                "dustColor",
            ),
            (
                {
                    "type": "spawn",
                    "name": "W",
                    "physics": "dynamic",
                    "destruct": {"fuse": 3},
                },
                "fuse",
            ),
        ):
            _, result = apply_actions(base_scene(), [action])
            self.assertEqual(result.invalid, 1, f"should reject {action!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class OperateActionTests(unittest.TestCase):
    def test_operate_action_registers_telemetry_and_config(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "operate",
                    "config": {
                        "telemetry": {"enabled": True, "build": "1.0"},
                        "remoteConfig": {
                            "defaults": {"doubleXp": False, "enemySpeed": 1.0},
                            "values": {"doubleXp": True},
                        },
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(scene["operate"]["telemetry"]["build"], "1.0")
        self.assertEqual(scene["operate"]["remoteConfig"]["values"]["doubleXp"], True)

    def test_operate_rejects_malformed(self):
        for action, hint in (
            ({"type": "operate", "config": {}}, "at least one"),
            (
                {"type": "operate", "config": {"telemetry": {"enabled": "yes"}}},
                "true/false",
            ),
            (
                {"type": "operate", "config": {"remoteConfig": {"defaults": {}}}},
                "non-empty",
            ),
            (
                {
                    "type": "operate",
                    "config": {"remoteConfig": {"defaults": {"a": [1]}}},
                },
                "bool, finite number, or string",
            ),
            (
                {
                    "type": "operate",
                    "config": {"sentry": {}, "telemetry": {"enabled": True}},
                },
                "sentry",
            ),
        ):
            _, result = apply_actions(base_scene(), [action])
            self.assertEqual(result.invalid, 1, f"should reject {action!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])


class PrefabActionTests(unittest.TestCase):
    def test_prefab_define_registers_template(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "prefab",
                    "prefab": {
                        "id": "goblin",
                        "template": {
                            "shape": "capsule",
                            "physics": "none",
                            "health": {"maxHealth": 50},
                            "ai": {"targetName": "Player Hero"},
                        },
                    },
                }
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertIn("goblin", scene["prefabs"])

    def test_prefab_define_rejects_malformed(self):
        _, result = apply_actions(
            base_scene(), [{"type": "prefab", "prefab": {"id": "g"}}]
        )
        # Missing template is fine (defaults to {}); unknown keys are not.
        self.assertEqual(result.applied, 1)
        _, result = apply_actions(
            base_scene(),
            [{"type": "prefab", "prefab": {"id": "g", "mystery": 1}}],
        )
        self.assertEqual(result.invalid, 1)
        self.assertIn("mystery", result.outcomes[0]["detail"])

    def test_spawn_from_prefab_fills_and_overrides(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "prefab",
                    "prefab": {
                        "id": "goblin",
                        "template": {
                            "shape": "capsule",
                            "physics": "none",
                            "color": "#4d7c0f",
                            "health": {"maxHealth": 50},
                            "ai": {"targetName": "Player Hero"},
                        },
                    },
                },
                {
                    "type": "spawn",
                    "name": "Goblin A",
                    "prefab": "goblin",
                    "position": [5, 1.5, 0],
                    "color": "#ff0000",
                },
            ],
        )
        self.assertEqual(result.applied, 2)
        goblin = scene["gameObjects"][1]
        self.assertEqual(goblin["shape"], "capsule")
        self.assertEqual(goblin["position"], [5.0, 1.5, 0.0])
        self.assertEqual(goblin["color"], "#ff0000")  # explicit wins
        self.assertEqual(goblin["health"], {"maxHealth": 50})  # template fills
        self.assertEqual(goblin["ai"], {"targetName": "Player Hero"})

    def test_spawn_unknown_prefab_names_registry(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "prefab",
                    "prefab": {"id": "goblin", "template": {"shape": "box"}},
                },
                {"type": "spawn", "name": "Orc", "prefab": "orc"},
            ],
        )
        self.assertEqual(result.applied, 1)
        self.assertEqual(result.invalid, 1)
        self.assertIn("goblin", result.outcomes[1]["detail"])

    def test_prefab_scene_passes_the_invariant_gate(self):
        scene, result = apply_actions(
            base_scene(),
            [
                {
                    "type": "prefab",
                    "prefab": {
                        "id": "goblin",
                        "template": {"shape": "capsule", "physics": "none"},
                    },
                },
                {
                    "type": "spawn",
                    "name": "Goblin A",
                    "prefab": "goblin",
                    "position": [5, 1.5, 0],
                },
            ],
        )
        self.assertEqual(result.failures, 0)
        valid, violations = validate_scene_invariants(scene)
        self.assertTrue(valid, f"gate rejected prefab scene: {violations}")


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
