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
        ):
            _, result = apply_actions(
                base_scene(), [{"type": "spawn", "name": "Hero", "cel": bad}]
            )
            self.assertEqual(result.invalid, 1, f"should reject {bad!r}")
            self.assertIn(hint, result.outcomes[0]["detail"])

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
