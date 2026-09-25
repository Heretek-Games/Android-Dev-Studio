"""
Unit tests for the Tier 2 scene exporter.

Run from the repository root:
    python3 -m unittest harness.build.test_scene_exporter
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.build.scene_exporter import (  # noqa: E402
    MAX_DRAW_CALLS,
    export_scene,
    hex_to_rgb,
    quadtree_leaves,
)


def fixture_scene():
    return {
        "name": "ExportFixture",
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
                "name": "Player Hero",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 0],
                "color": "#3b82f6",
                "physics": "dynamic",
            },
            {
                "name": "Gold Coin 1",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [-4, 1.2, 6],
                "color": "#fbbf24",
                "physics": "none",
            },
            {
                "kind": "light",
                "name": "Sunset Sun",
                "lightType": "directional",
                "color": "#ffb347",
                "intensity": 3.5,
                "position": [8, 12, 4],
            },
            # Batched instances share one draw call per batch key
            {
                "name": "Blade 1",
                "shape": "box",
                "size": [0.2, 0.5, 0.2],
                "position": [1, 0, 1],
                "batched": True,
                "batch": "foliage_blade",
            },
            {
                "name": "Blade 2",
                "shape": "box",
                "size": [0.2, 0.5, 0.2],
                "position": [2, 0, 2],
                "batched": True,
                "batch": "foliage_blade",
            },
            {
                "name": "Blade 3",
                "shape": "box",
                "size": [0.2, 0.5, 0.2],
                "position": [3, 0, 3],
                "batched": True,
                "batch": "foliage_blade",
            },
        ],
    }


def parse_native(text: str):
    """Tiny reference parser mirroring the native C++ scene_loader semantics."""
    records = {"scene": None, "mesh": [], "instance": [], "light": []}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        kind = parts[0]
        if kind == "scene":
            records["scene"] = parts[1]
        elif kind == "mesh":
            records["mesh"].append(
                {
                    "name": parts[1],
                    "pos": [float(parts[2]), float(parts[3]), float(parts[4])],
                    "size": [float(parts[5]), float(parts[6]), float(parts[7])],
                    "rgb": [float(parts[8]), float(parts[9]), float(parts[10])],
                    "physics": parts[11],
                }
            )
        elif kind == "instance":
            records["instance"].append(
                {
                    "batch": parts[1],
                    "pos": [float(parts[2]), float(parts[3]), float(parts[4])],
                }
            )
        elif kind == "light":
            records["light"].append(
                {
                    "name": parts[1],
                    "pos": [float(parts[2]), float(parts[3]), float(parts[4])],
                    "intensity": float(parts[8]),
                    "type": parts[9],
                }
            )
    return records


class SceneExporterTests(unittest.TestCase):
    def test_hex_to_rgb_converts_short_and_long_forms(self):
        self.assertEqual(hex_to_rgb("#ffffff"), (1.0, 1.0, 1.0))
        self.assertEqual(hex_to_rgb("#000"), (0.0, 0.0, 0.0))
        r, g, b = hex_to_rgb("#ff0000")
        self.assertEqual((r, g, b), (1.0, 0.0, 0.0))
        self.assertEqual(hex_to_rgb([0.1, 0.2, 0.3]), (0.1, 0.2, 0.3))
        self.assertEqual(hex_to_rgb(None), (0.5, 0.5, 0.5))

    def test_export_produces_parseable_native_records(self):
        text, summary = export_scene(fixture_scene(), source_name="fixture.json")
        records = parse_native(text)

        self.assertEqual(records["scene"], "ExportFixture")
        self.assertEqual(len(records["mesh"]), 3)
        self.assertEqual(len(records["instance"]), 3)
        self.assertEqual(len(records["light"]), 1)

        ground = records["mesh"][0]
        self.assertEqual(ground["name"], "Ground")
        self.assertEqual(ground["physics"], "fixed")
        self.assertAlmostEqual(ground["pos"][1], -0.5)
        self.assertAlmostEqual(ground["size"][0], 24.0)

        sun = records["light"][0]
        self.assertEqual(sun["type"], "directional")
        self.assertAlmostEqual(sun["intensity"], 3.5)

    def test_summary_counts_and_draw_budget(self):
        _, summary = export_scene(fixture_scene())
        self.assertEqual(
            summary["counts"],
            {"meshes": 3, "instances": 3, "lights": 1, "terrainLodLeaves": 0},
        )
        # 3 meshes + 1 unique batch key = 4 draw calls
        self.assertEqual(summary["drawCalls"], 4)
        self.assertTrue(summary["withinBudget"])

    def test_budget_overflow_is_reported(self):
        scene = {
            "name": "OverBudget",
            "gameObjects": [
                {
                    "name": f"Prop {i}",
                    "shape": "box",
                    "size": [1, 1, 1],
                    "position": [i, 0, 0],
                }
                for i in range(MAX_DRAW_CALLS + 5)
            ],
        }
        _, summary = export_scene(scene)
        self.assertEqual(summary["drawCalls"], MAX_DRAW_CALLS + 5)
        self.assertFalse(summary["withinBudget"])

    def test_export_is_deterministic(self):
        a, _ = export_scene(fixture_scene())
        b, _ = export_scene(fixture_scene())
        # exportedAt lives in the summary only; the native text must be byte-identical
        self.assertEqual(a, b)

    def test_name_spaces_are_underscored_for_tokenization(self):
        text, _ = export_scene(
            {
                "name": "S",
                "gameObjects": [
                    {"name": "Player Hero", "shape": "capsule", "position": [0, 0, 0]}
                ],
            }
        )
        self.assertIn("mesh Player_Hero", text)
        self.assertNotIn("mesh Player Hero", text)

    # ---- Quadtree terrain LOD export ----------------------------------------

    def test_quadtree_focus_outside_bounds_keeps_root_leaf(self):
        leaves = quadtree_leaves(-512, -512, 512, 512, 4000, 4000, max_depth=4)
        self.assertEqual(len(leaves), 1)
        self.assertEqual(leaves[0]["depth"], 0)

    def test_quadtree_center_subdivision_tiles_the_bounds(self):
        leaves = quadtree_leaves(-512, -512, 512, 512, 0, 0, max_depth=2)
        self.assertEqual(len(leaves), 16, "depth 2 with center focus -> 4^2 leaves")
        area = sum(
            (leaf["maxX"] - leaf["minX"]) * (leaf["maxZ"] - leaf["minZ"])
            for leaf in leaves
        )
        self.assertAlmostEqual(
            area, 1024.0 * 1024.0, places=3, msg="leaves cover the bounds exactly once"
        )
        for leaf in leaves:
            self.assertEqual(leaf["lod"], leaf["depth"])
            self.assertEqual(leaf["blend"], 1.0, "max-depth leaves are fully blended")

    def test_quadtree_export_is_deterministic_and_budgeted(self):
        a = quadtree_leaves(-512, -512, 512, 512, 100, -50, max_depth=3)
        b = quadtree_leaves(-512, -512, 512, 512, 100, -50, max_depth=3)
        self.assertEqual(a, b, "subdivision order is deterministic")

        text, summary = export_scene(
            fixture_scene(),
            quadtree={"focusX": 100, "focusZ": -50, "maxDepth": 3},
        )
        self.assertEqual(summary["counts"]["terrainLodLeaves"], len(a))
        self.assertEqual(
            summary["drawCalls"],
            summary["counts"]["meshes"] + 1 + len(a),
            "draws include LOD leaves",
        )

        # Exactly one leaf contains the focus point, and it is at max depth
        records = [
            line.split()
            for line in text.splitlines()
            if line.startswith("terrain_lod ")
        ]
        containing = [
            r
            for r in records
            if float(r[3]) <= 100 <= float(r[5]) and float(r[4]) <= -50 <= float(r[6])
        ]
        self.assertEqual(len(containing), 1, "leaves partition the bounds")
        self.assertEqual(
            containing[0][2], "3", "the focus leaf subdivides to max depth"
        )

    def test_quadtree_blend_transition_band(self):
        # A leaf just outside its split radius blends toward the finer level
        leaves = quadtree_leaves(-512, -512, 512, 512, 600, 600, max_depth=2)
        blend_leaf = next(leaf for leaf in leaves if leaf["id"] == "0.0")
        self.assertGreater(blend_leaf["blend"], 0.5)
        self.assertLess(blend_leaf["blend"], 1.0)


if __name__ == "__main__":
    unittest.main()
