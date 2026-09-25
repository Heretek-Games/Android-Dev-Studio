"""Unit tests for the stress-scene generator (pure, deterministic).

Run from the repository root:
    python3 -m unittest harness.agents.test_stress_scene_gen
"""

import math
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.agents.stress_scene_gen import build_stress_scene  # noqa: E402


class StressSceneTests(unittest.TestCase):
    def test_emits_requested_instance_count(self):
        scene = build_stress_scene(100)
        batched = [o for o in scene["gameObjects"] if o.get("batched")]
        self.assertEqual(len(batched), 100)
        self.assertTrue(all(o["batch"] == "stress_unit" for o in batched))

    def test_grid_is_deterministic_and_centered(self):
        scene = build_stress_scene(9, spacing=2.0)
        units = [o for o in scene["gameObjects"] if o.get("batched")]
        self.assertEqual(units[0]["position"], [-2.0, 0.6, -2.0])
        self.assertEqual(units[4]["position"], [0.0, 0.6, 0.0])
        self.assertEqual(units[8]["position"], [2.0, 0.6, 2.0])
        self.assertEqual(
            scene, build_stress_scene(9, spacing=2.0), "deterministic output"
        )

    def test_ground_sized_to_the_grid(self):
        scene = build_stress_scene(100, spacing=2.0)
        ground = next(o for o in scene["gameObjects"] if o["name"] == "Ground Arena")
        self.assertEqual(ground["size"][0], 10 * 2.0 + 20)
        self.assertEqual(ground["physics"], "fixed")

    def test_light_and_rule_present(self):
        scene = build_stress_scene(4)
        self.assertTrue(any(o.get("kind") == "light" for o in scene["gameObjects"]))
        self.assertEqual(scene["rules"][0]["type"], "draw_call_budget")

    def test_rejects_empty_scene(self):
        with self.assertRaises(ValueError):
            build_stress_scene(0)
        with self.assertRaises(ValueError):
            build_stress_scene(0, foliage=0)

    def test_foliage_ring_uses_the_wind_category(self):
        scene = build_stress_scene(0, foliage=12)
        blades = [o for o in scene["gameObjects"] if o.get("batch") == "foliage"]
        self.assertEqual(len(blades), 12)
        for blade in blades:
            self.assertTrue(blade["batched"])
            self.assertEqual(blade["physics"], "none")
            self.assertGreater(blade["position"][1], 0, "blades sit above the ground")

    def test_foliage_ring_is_radially_distributed(self):
        scene = build_stress_scene(0, foliage=40)
        blades = [o for o in scene["gameObjects"] if o.get("batch") == "foliage"]
        radii = {
            round(math.hypot(b["position"][0], b["position"][2]), 3) for b in blades
        }
        self.assertGreater(len(radii), 5, "blades spread over varied radii (not a single ring)")

    def test_grid_and_foliage_combine(self):
        scene = build_stress_scene(9, foliage=6)
        self.assertEqual(len([o for o in scene["gameObjects"] if o.get("batch") == "stress_unit"]), 9)
        self.assertEqual(len([o for o in scene["gameObjects"] if o.get("batch") == "foliage"]), 6)


if __name__ == "__main__":
    unittest.main()
