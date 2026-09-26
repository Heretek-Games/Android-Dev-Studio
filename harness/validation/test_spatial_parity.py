"""
Cross-tier spatial parity tests.

Verifies that the Python SpatialIndex bake (harness/spatial) produces exactly
the same blocked grid and line-of-sight verdicts as the TypeScript engine's
bakeWalkability/hasLineOfSight (invoked via harness/agents/spatial_cli.mjs).
This catches drift between the web engine and the loop audits — the two must
agree or nav/AI/camera checks would differ between tiers.

Run from the repository root:
    python3 -m unittest harness.validation.test_spatial_parity
"""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.spatial.spatial_index import SpatialIndex  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CLI = os.path.join("harness", "agents", "spatial_cli.mjs")


def node_bake(width, height, ox, oz, cell, agent, footprints, los_pairs):
    cmd = [
        "node",
        CLI,
        "--grid",
        str(width),
        str(height),
        str(ox),
        str(oz),
        str(cell),
        str(agent),
        "--footprints",
        json.dumps(footprints),
    ]
    for ax, az, bx, bz in los_pairs:
        cmd += ["--los", str(ax), str(az), str(bx), str(bz)]
    result = subprocess.run(
        cmd, capture_output=True, text=True, cwd=REPO_ROOT, timeout=120
    )
    if result.returncode != 0:
        raise AssertionError(f"spatial_cli failed: {result.stderr[:400]}")
    return json.loads(result.stdout)


def python_bake(width, height, ox, oz, cell, agent, footprints, los_pairs):
    scene = {
        "gameObjects": [
            {
                "name": f"fp{i}",
                "position": [fp["x"], 1, fp["z"]],
                "size": [fp["hx"] * 2, 4, fp["hz"] * 2],
                "physics": "fixed",
            }
            for i, fp in enumerate(footprints)
        ]
    }
    index = SpatialIndex(scene, cell_size=cell, agent_radius=agent, pad=0.0)
    # Re-origin the index onto the exact engine grid for comparison.
    index.origin_x, index.origin_z = ox, oz
    index.width, index.height = width, height
    index.blocked = bytearray(width * height)
    index._bake()
    blocked = list(index.blocked)

    def to_world(gx, gz):
        return (ox + (gx + 0.5) * cell, oz + (gz + 0.5) * cell)

    los = []
    for ax, az, bx, bz in los_pairs:
        wax, waz = to_world(ax, az)
        wbx, wbz = to_world(bx, bz)
        los.append(index.line_of_sight(wax, waz, wbx, wbz))
    return {"blocked": blocked, "los": los}


CASES = [
    {
        "grid": (12, 12, -6, -6, 1.0, 0.4),
        "footprints": [{"x": 0, "z": 0, "hx": 1, "hz": 1}],
        "los": [(0, 0, 11, 11), (0, 0, 0, 1), (0, 5, 11, 5)],
    },
    {
        "grid": (20, 10, -10, -5, 1.0, 0.4),
        "footprints": [
            {"x": -4, "z": 1, "hx": 2, "hz": 0.5},
            {"x": 3, "z": -2, "hx": 0.5, "hz": 2},
        ],
        "los": [(0, 0, 19, 9), (2, 2, 2, 7), (10, 5, 19, 5)],
    },
    {
        "grid": (8, 8, 0, 0, 0.5, 0.2),
        "footprints": [{"x": 2, "z": 2, "hx": 0.5, "hz": 0.5}],
        "los": [(0, 0, 7, 7), (1, 1, 6, 1)],
    },
]


class SpatialParityTests(unittest.TestCase):
    def test_bake_and_los_parity(self):
        for case in CASES:
            width, height, ox, oz, cell, agent = case["grid"]
            node = node_bake(
                width, height, ox, oz, cell, agent, case["footprints"], case["los"]
            )
            python = python_bake(
                width, height, ox, oz, cell, agent, case["footprints"], case["los"]
            )
            self.assertEqual(
                python["blocked"],
                node["blocked"],
                f"blocked drift in case {case['grid']}",
            )
            self.assertEqual(
                python["los"], node["los"], f"LoS drift in case {case['grid']}"
            )


if __name__ == "__main__":
    unittest.main()
