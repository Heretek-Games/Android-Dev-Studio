"""
Native nav-bake parity tests (Track C.6 first strangler module).

Verifies the C++ bakeWalkabilityNative produces exactly the same blocked
grid as the TypeScript engine's bakeWalkability across randomized scenes:
scene dict -> scene_exporter -> scene.native -> nav_bake_probe vs
navbake_cli on the same grid. Any divergence fails here — the TS engine
stays the source of truth.

Run from the repository root:
    python3 -m unittest harness.validation.test_native_nav_parity
"""

import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.build.scene_exporter import export_scene  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CPP_DIR = REPO_ROOT / "templates" / "vulkan-container" / "app" / "src" / "main" / "cpp"
NODE_CLI = REPO_ROOT / "harness" / "agents" / "navbake_cli.mjs"


def build_probe(tmp):
    binary = Path(tmp) / "nav_bake_probe"
    proc = subprocess.run(
        [
            "g++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            str(CPP_DIR / "scene_loader.cpp"),
            str(CPP_DIR / "nav_bake.cpp"),
            str(CPP_DIR / "tests" / "nav_bake_probe.cpp"),
            "-I",
            str(CPP_DIR),
            "-o",
            str(binary),
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if proc.returncode != 0:
        raise AssertionError(f"probe build failed: {proc.stderr[:500]}")
    return binary


def random_scene(seed, n_obstacles):
    rng = random.Random(seed)
    objects = [
        {
            "name": "Ground",
            "shape": "box",
            "size": [40, 1, 40],
            "position": [0, -0.5, 0],
            "color": "#27272a",
            "physics": "fixed",
        }
    ]
    for i in range(n_obstacles):
        size = [
            round(rng.uniform(1, 4), 1),
            round(rng.uniform(2, 8), 1),
            round(rng.uniform(1, 4), 1),
        ]
        objects.append(
            {
                "name": f"Wall{i}",
                "shape": "box",
                "size": size,
                "position": [
                    round(rng.uniform(-14, 14), 1),
                    round(size[1] / 2, 1),
                    round(rng.uniform(-14, 14), 1),
                ],
                "color": "#78716c",
                "physics": "fixed",
            }
        )
    return {"name": "ParityNav", "gameObjects": objects}


def footprints_for_node(native_text):
    """Footprints parsed from the export TEXT (4-decimal rounded) — the exact
    bytes the native probe reads. Algorithm parity needs identical inputs;
    the rounding policy itself is documented, not smuggled into this test."""
    out = []
    for raw in native_text.splitlines():
        parts = raw.strip().split()
        if not parts or parts[0] != "mesh":
            continue
        size = [float(parts[5]), float(parts[6]), float(parts[7])]
        if parts[11] != "fixed" or size[1] < 2:
            continue
        out.append(
            {
                "x": float(parts[2]),
                "z": float(parts[4]),
                "hx": size[0] / 2,
                "hz": size[2] / 2,
            }
        )
    return out


class NativeNavParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.probe = build_probe(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def assert_parity(self, seed, n_obstacles):
        scene = random_scene(seed, n_obstacles)
        text, _ = export_scene(scene)
        scene_path = Path(self.tmp.name) / f"parity_{seed}.native"
        scene_path.write_text(text, encoding="utf-8")
        grid = [32, 32, -16, -16, 1.0, 0.4]

        cpp = subprocess.run(
            [str(self.probe), str(scene_path), *[str(v) for v in grid]],
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(cpp.returncode, 0, cpp.stderr[:200])
        cpp_result = json.loads(cpp.stdout)

        node = subprocess.run(
            [
                "node",
                str(NODE_CLI),
                "--grid",
                *[str(v) for v in grid],
                "--footprints",
                json.dumps(footprints_for_node(text)),
            ],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            timeout=120,
        )
        self.assertEqual(node.returncode, 0, node.stderr[:200])
        node_result = json.loads(node.stdout)

        self.assertEqual(
            cpp_result["blocked"],
            node_result["blocked"],
            f"nav bake drift (seed {seed})",
        )

    def test_parity_sparse(self):
        self.assert_parity(seed=7, n_obstacles=3)

    def test_parity_dense(self):
        self.assert_parity(seed=99, n_obstacles=10)

    def test_parity_towers(self):
        self.assert_parity(seed=1234, n_obstacles=6)


if __name__ == "__main__":
    unittest.main()
