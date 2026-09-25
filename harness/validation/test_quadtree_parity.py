"""
Cross-tier quadtree parity tests.

Verifies that the Python scene exporter's `quadtree_leaves()` produces exactly
the same subdivision as the TypeScript engine's `QuadtreeTerrain` (invoked via
`harness/agents/quadtree_cli.mjs`). This catches drift between the web engine
and the native Tier 2 export — the two must agree or terrain would visibly
differ between tiers.

Run from the repository root:
    python3 -m unittest harness.validation.test_quadtree_parity
"""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.build.scene_exporter import quadtree_leaves  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLI = os.path.join("harness", "agents", "quadtree_cli.mjs")


def node_leaves(focus, depth, bounds=(-512.0, -512.0, 512.0, 512.0)):
    result = subprocess.run(
        [
            "node",
            CLI,
            "--focus",
            str(focus[0]),
            str(focus[1]),
            "--depth",
            str(depth),
            "--bounds",
            *[str(b) for b in bounds],
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=120,
    )
    if result.returncode != 0:
        raise AssertionError(f"quadtree_cli failed: {result.stderr[:400]}")
    return json.loads(result.stdout)["leaves"]


def python_leaves(focus, depth, bounds=(-512.0, -512.0, 512.0, 512.0)):
    leaves = quadtree_leaves(
        bounds[0], bounds[1], bounds[2], bounds[3], focus[0], focus[1], max_depth=depth
    )
    return sorted(leaves, key=lambda leaf: leaf["id"])


class QuadtreeParityTests(unittest.TestCase):
    def assert_parity(self, focus, depth):
        node = node_leaves(focus, depth)
        python = python_leaves(focus, depth)

        self.assertEqual(
            len(node),
            len(python),
            f"leaf counts differ for focus={focus} depth={depth}",
        )
        for n, p in zip(node, python):
            self.assertEqual(n["id"], p["id"], "leaf ids must match")
            self.assertEqual(n["depth"], p["depth"], f"depth mismatch on {n['id']}")
            self.assertEqual(n["lod"], p["lod"], f"lod mismatch on {n['id']}")
            for key in ("minX", "minZ", "maxX", "maxZ"):
                self.assertAlmostEqual(
                    n[key], p[key], places=4, msg=f"{key} mismatch on {n['id']}"
                )
            self.assertAlmostEqual(
                n["blend"], p["blend"], places=3, msg=f"blend mismatch on {n['id']}"
            )

    def test_center_focus_parity(self):
        self.assert_parity((0, 0), 3)

    def test_offset_focus_parity(self):
        self.assert_parity((100, -50), 3)

    def test_transition_band_parity(self):
        self.assert_parity((600, 600), 2)

    def test_out_of_bounds_focus_parity(self):
        self.assert_parity((4000, 4000), 3)

    def test_deep_subdivision_parity(self):
        self.assert_parity((0, 0), 5)


if __name__ == "__main__":
    unittest.main()
