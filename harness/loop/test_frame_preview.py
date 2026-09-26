"""Unit tests for the gameplay-camera frame preview (Track A.1, hermetic).

Run from the repository root:
    python3 -m unittest harness.loop.test_frame_preview
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.frame_preview import (  # noqa: E402
    frame_metadata,
    render_frame_png,
    select_camera,
)


def scene():
    return {
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
                "name": "Player",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 2],
                "color": "#3b82f6",
                "physics": "dynamic",
                "controller": True,
            },
            {
                "name": "Coin",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [-4, 1.2, -2],
                "color": "#fbbf24",
            },
        ]
    }


class CameraTests(unittest.TestCase):
    def test_chase_when_no_explicit_camera(self):
        cam = select_camera(scene())
        self.assertEqual(cam["source"], "chase")
        # Chase eye sits behind (+Z) and above the player.
        self.assertGreater(cam["position"][2], 2.0)
        self.assertGreater(cam["position"][1], 1.5)

    def test_explicit_camera_wins(self):
        objects = scene()["gameObjects"] + [
            {
                "name": "MainCam",
                "kind": "camera",
                "position": [0, 3, 8],
                "rotation": [0, 0, 0],
                "cameraOptions": {"fov": 70},
            }
        ]
        cam = select_camera({"gameObjects": objects})
        self.assertEqual(cam["source"], "explicit")
        self.assertEqual(cam["fov"], 70)

    def test_default_when_empty(self):
        cam = select_camera({"gameObjects": []})
        self.assertEqual(cam["source"], "default")

    def test_bad_fov_falls_back(self):
        objects = [
            {
                "name": "Cam",
                "kind": "camera",
                "position": [0, 1, 5],
                "cameraOptions": {"fov": 999},
            }
        ]
        self.assertEqual(select_camera({"gameObjects": objects})["fov"], 60.0)


class RenderTests(unittest.TestCase):
    def test_render_produces_png(self):
        png = render_frame_png(scene())
        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertGreater(len(png), 1000)

    def test_render_is_deterministic(self):
        self.assertEqual(render_frame_png(scene()), render_frame_png(scene()))

    def test_render_survives_bad_objects(self):
        png = render_frame_png({"gameObjects": [None, 42, {"name": "NoPos"}]})
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_explicit_camera_renders(self):
        objects = scene()["gameObjects"] + [
            {
                "name": "Cam",
                "kind": "camera",
                "position": [0, 3, 10],
                "rotation": [0, 0, 0],
            }
        ]
        png = render_frame_png({"gameObjects": objects})
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_metadata_serializable(self):
        meta = frame_metadata(scene())
        self.assertEqual(meta["cameraSource"], "chase")
        self.assertEqual(meta["objectCount"], 3)


if __name__ == "__main__":
    unittest.main()
