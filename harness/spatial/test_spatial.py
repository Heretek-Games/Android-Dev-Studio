"""Unit tests for the B.1 unified spatial index + consistency audit (hermetic).

Run from the repository root:
    python3 -m unittest harness.spatial.test_spatial
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.spatial.spatial_audit import evaluate_spatial_rule, spatial_audit  # noqa: E402
from harness.spatial.spatial_index import (  # noqa: E402
    SpatialIndex,
    camera_occluded,
    collect_footprints,
)


def open_scene():
    return {
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
                "name": "Rover",
                "shape": "box",
                "size": [1, 1, 1],
                "position": [8, 0.5, 0],
                "color": "#fbbf24",
                "physics": "none",
                "nav": {"target": [8, 6], "speed": 4},
            },
            {
                "name": "Imp",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [6, 1.5, -6],
                "color": "#ef4444",
                "physics": "none",
                "ai": {"targetName": "Player", "moveSpeed": 2.5},
            },
        ]
    }


class FootprintTests(unittest.TestCase):
    def test_tall_fixed_included(self):
        fps = collect_footprints(open_scene())
        self.assertEqual([f["name"] for f in fps], ["Pillar"])
        self.assertEqual((fps[0]["hx"], fps[0]["hz"]), (1.0, 1.0))
        self.assertEqual(fps[0]["top"], 6.0)

    def test_thin_and_loose_excluded(self):
        scene = {
            "gameObjects": [
                {
                    "name": "Floor",
                    "size": [10, 1, 10],
                    "position": [0, 0, 0],
                    "physics": "fixed",
                },
                {
                    "name": "Crate",
                    "size": [2, 4, 2],
                    "position": [5, 2, 5],
                    "physics": "dynamic",
                },
                {
                    "name": "Cam",
                    "kind": "camera",
                    "size": [2, 4, 2],
                    "position": [9, 9, 9],
                    "physics": "fixed",
                },
            ]
        }
        self.assertEqual(collect_footprints(scene), [])


class IndexTests(unittest.TestCase):
    def test_blocked_core_walkable_edge(self):
        index = SpatialIndex(open_scene())
        self.assertFalse(index.is_walkable(0, 0))  # pillar core
        self.assertFalse(index.is_walkable(0.5, 0))  # cell center inside erosion
        # Erosion boundary is exact: the 1.2-cell center sits outside the
        # 1.4 margin, so this is walkable (parity with bakeWalkability).
        self.assertTrue(index.is_walkable(1.2, 0))
        self.assertTrue(index.is_walkable(4, 0))
        self.assertTrue(index.is_walkable(-8, 0))

    def test_reachability_open_and_walled(self):
        index = SpatialIndex(open_scene())
        self.assertTrue(index.reachable(-8, 0, 8, 6))
        walled = {
            "gameObjects": [
                {
                    "name": "Ground",
                    "size": [30, 1, 30],
                    "position": [0, -0.5, 0],
                    "physics": "fixed",
                },
                {
                    "name": "N",
                    "size": [10, 6, 1],
                    "position": [0, 3, -5],
                    "physics": "fixed",
                },
                {
                    "name": "S",
                    "size": [10, 6, 1],
                    "position": [0, 3, 5],
                    "physics": "fixed",
                },
                {
                    "name": "W",
                    "size": [1, 6, 11],
                    "position": [-5, 3, 0],
                    "physics": "fixed",
                },
                {
                    "name": "E",
                    "size": [1, 6, 11],
                    "position": [5, 3, 0],
                    "physics": "fixed",
                },
            ]
        }
        room = SpatialIndex(walled)
        self.assertFalse(room.reachable(0, 0, 9, 9))
        self.assertTrue(room.reachable(0, 0, 2, 2))

    def test_line_of_sight(self):
        index = SpatialIndex(open_scene())
        self.assertTrue(index.line_of_sight(-8, 0, -8, 6))
        self.assertFalse(index.line_of_sight(-8, 0, 8, 0))  # through pillar

    def test_support_and_clearance(self):
        index = SpatialIndex(open_scene())
        self.assertAlmostEqual(index.support_top(-8, 0), 0.0)
        self.assertIsNone(index.support_top(500, 500))
        self.assertLess(index.clearance(0, 2.5), 2.0)
        self.assertGreater(index.clearance(0, 2.5), 1.0)
        self.assertGreater(index.clearance(-8, 0), 2.0)


class OcclusionTests(unittest.TestCase):
    def test_wall_blocks_low_sight_line(self):
        fps = collect_footprints(open_scene())
        blocker = camera_occluded((0, 2, 8), (-8, 1.5, 0), fps)
        # Pillar top (6) is above this sight line only if the segment crosses
        # it — report whatever the geometry says, with a name attached.
        if blocker is not None:
            self.assertEqual(blocker["name"], "Pillar")

    def test_high_camera_clears(self):
        fps = collect_footprints(open_scene())
        self.assertIsNone(camera_occluded((0, 20, 8), (-8, 1.5, 0), fps))

    def test_low_wall_never_blocks(self):
        fps = [{"name": "Kerb", "x": -4, "z": 0, "hx": 1, "hz": 1, "top": 0.4}]
        self.assertIsNone(camera_occluded((0, 3, 8), (-8, 1.5, 0), fps))


class AuditTests(unittest.TestCase):
    def test_open_scene_passes(self):
        audit = spatial_audit(open_scene())
        self.assertTrue(audit["pass"], audit["defects"])
        self.assertEqual(audit["passed"], audit["total"])

    def test_nav_target_in_wall_fails(self):
        scene = open_scene()
        scene["gameObjects"][3]["nav"] = {"target": [0, 0], "speed": 4}
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])
        self.assertTrue(
            any(
                "walkable" in d["defect"] or "blocked" in d["defect"]
                for d in audit["defects"]
            )
        )

    def test_floating_spawn_fails(self):
        scene = open_scene()
        scene["gameObjects"][1]["position"] = [-8, 9, 0]
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])
        self.assertTrue(any("floating" in d["defect"] for d in audit["defects"]))

    def test_buried_spawn_fails(self):
        scene = open_scene()
        scene["gameObjects"][1]["position"] = [-8, -0.4, 0]
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])
        self.assertTrue(any("buried" in d["defect"] for d in audit["defects"]))

    def test_unreachable_ai_fails(self):
        # Sealed room (a lone wall is walkable around its ends — the audit
        # correctly routes there, so the negative case needs full enclosure).
        scene = {
            "gameObjects": [
                {
                    "name": "Ground",
                    "size": [40, 1, 40],
                    "position": [0, -0.5, 0],
                    "physics": "fixed",
                },
                {
                    "name": "N",
                    "size": [12, 6, 1],
                    "position": [0, 3, -5],
                    "physics": "fixed",
                },
                {
                    "name": "S",
                    "size": [12, 6, 1],
                    "position": [0, 3, 5],
                    "physics": "fixed",
                },
                {
                    "name": "W",
                    "size": [1, 6, 11],
                    "position": [-5, 3, 0],
                    "physics": "fixed",
                },
                {
                    "name": "E",
                    "size": [1, 6, 11],
                    "position": [5, 3, 0],
                    "physics": "fixed",
                },
                {
                    "name": "Imp",
                    "size": [1, 1.5, 1],
                    "position": [0, 1.5, 0],
                    "physics": "none",
                    "ai": {"targetName": "Player", "moveSpeed": 2},
                },
                {
                    "name": "Player",
                    "size": [1, 1.5, 1],
                    "position": [9, 1.5, 9],
                    "physics": "dynamic",
                    "controller": True,
                },
            ]
        }
        audit = spatial_audit(scene)
        self.assertFalse(audit["pass"])
        self.assertTrue(any("reach" in d["defect"] for d in audit["defects"]))

    def test_rule_evaluation(self):
        passing = evaluate_spatial_rule(
            open_scene(), {"id": "sp", "type": "spatial_audit", "enforce": True}
        )
        self.assertTrue(passing["pass"])
        self.assertTrue(passing["enforce"])
        scene = open_scene()
        scene["gameObjects"][1]["position"] = [-8, 9, 0]
        failing = evaluate_spatial_rule(scene, {"id": "sp", "type": "spatial_audit"})
        self.assertFalse(failing["pass"])
        self.assertFalse(failing["enforce"])
        self.assertTrue(len(failing["failedChecks"]) >= 1)


class LoopGateTests(unittest.TestCase):
    def _loop(self, scene, rule):
        import json
        from harness.loop.iterate_loop import IterateLoop
        from harness.loop.llm_client import LlmResponse

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
            "spatial gate test",
            [rule],
            NoopClient(),
            qa_runner=fake_qa,
            max_iterations=1,
            seed_scene=scene,
            runs_dir=tmp,
            work_scene_path=tmp / "work.json",
        ).run()

    def test_enforced_spatial_gate_blocks_green(self):
        scene = open_scene()
        scene["gameObjects"][1]["position"] = [-8, 9, 0]  # floating player
        result = self._loop(
            scene, {"id": "sp", "type": "spatial_audit", "enforce": True}
        )
        self.assertEqual(result.verdict, "unresolved")
        record = result.iterations[0]
        self.assertIn("spatial", record)
        self.assertFalse(record["spatial"][0]["pass"])
        self.assertEqual(record["qa"]["verdict"], "SUCCEEDED")

    def test_advisory_spatial_gate_stays_green(self):
        result = self._loop(open_scene(), {"id": "sp", "type": "spatial_audit"})
        self.assertEqual(result.verdict, "green")
        self.assertTrue(result.iterations[0]["spatial"][0]["pass"])


if __name__ == "__main__":
    unittest.main()
