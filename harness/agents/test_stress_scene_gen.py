"""Unit tests for the stress-scene generator (pure, deterministic).

Run from the repository root:
    python3 -m unittest harness.agents.test_stress_scene_gen
"""

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

    def test_rejects_empty_count(self):
        with self.assertRaises(ValueError):
            build_stress_scene(0)


if __name__ == "__main__":
    unittest.main()
