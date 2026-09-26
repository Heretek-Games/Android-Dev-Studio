"""Scene revision counter tests (Track D.2): every gated write bumps rev.

Run from the repository root:
    python3 -m unittest harness.test_scene_rev
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import harness.mcp_server as mcp  # noqa: E402


class SceneRevTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.scenes = os.path.join(self.tmp.name, "scenes")
        self.patch_active = mock.patch.object(
            mcp, "ACTIVE_SCENE_PATH", os.path.join(self.scenes, "active_scene.json")
        )
        self.patch_dir = mock.patch.object(mcp, "SCENES_DIR", self.scenes)
        self.patch_active.start()
        self.patch_dir.start()
        # Memory snapshot sync is best-effort; keep tests hermetic.
        self.patch_mem = mock.patch.object(
            mcp.memory, "save_scene_snapshot", return_value=None
        )
        self.patch_mem.start()

    def tearDown(self):
        self.patch_active.stop()
        self.patch_dir.stop()
        self.patch_mem.stop()
        self.tmp.cleanup()

    def read_rev(self):
        with open(os.path.join(self.scenes, "active_scene.json")) as fh:
            return json.load(fh).get("rev")

    def test_seed_starts_at_rev_1(self):
        mcp.load_active_scene()
        self.assertEqual(self.read_rev(), 1)

    def test_every_save_bumps_rev(self):
        mcp.load_active_scene()  # seeds the file at rev 1
        mcp.save_active_scene(mcp.load_active_scene())
        self.assertEqual(self.read_rev(), 2)
        mcp.save_active_scene(mcp.load_active_scene())
        self.assertEqual(self.read_rev(), 3)

    def test_transactional_save_bumps_rev_on_accept(self):
        mcp.load_active_scene()  # seed
        scene = mcp.load_active_scene()  # rev-bearing dict
        scene.setdefault("gameObjects", []).append(
            {
                "name": "RevBox",
                "shape": "box",
                "size": [1, 1, 1],
                "position": [5, 1, 5],
                "color": "#ff0000",
                "physics": "none",
            }
        )
        ok, error = mcp.save_active_scene_transactional(scene)
        self.assertTrue(ok, error)
        self.assertEqual(self.read_rev(), 2)

    def test_rejected_save_does_not_bump_rev(self):
        mcp.load_active_scene()
        bad = {
            "gameObjects": [{"name": "Bad", "shape": "nope", "position": [0, "x", 0]}]
        }
        ok, _ = mcp.save_active_scene_transactional(bad)
        self.assertFalse(ok)
        self.assertEqual(self.read_rev(), 1)

    def test_garbage_rev_resets_forward(self):
        scene = mcp.load_active_scene()
        scene["rev"] = "nonsense"
        mcp.save_active_scene(scene)
        self.assertEqual(self.read_rev(), 1)


if __name__ == "__main__":
    unittest.main()
