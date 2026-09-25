"""
Stress-scene generator for scale validation (GitHub issue #3).

Emits a flat scene spec with N batched instances in a grid plus a ground plane and
a light, so the Tier 2 exporter turns them into a single `instance` batch (one
indirect draw call) and the native renderer's compute culling path can be measured
on-device.

CLI:
    python3 harness/agents/stress_scene_gen.py --count 10000 --out harness/scenes/stress_50k.json
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def build_stress_scene(
    count: int, name: str = "Stress Arena", spacing: float = 2.0
) -> Dict[str, Any]:
    """Grid of `count` batched boxes + ground + light (deterministic layout)."""
    if count < 1:
        raise ValueError("count must be >= 1")
    side = max(1, math.ceil(math.sqrt(count)))
    objects = [
        {
            "name": "Ground Arena",
            "shape": "box",
            "size": [side * spacing + 20, 1, side * spacing + 20],
            "position": [0, -0.5, 0],
            "color": "#27272a",
            "physics": "fixed",
        }
    ]
    half = (side - 1) / 2
    for index in range(count):
        row, col = divmod(index, side)
        objects.append(
            {
                "name": f"Unit {index}",
                "shape": "box",
                "size": [0.8, 1.2, 0.8],
                "position": [
                    round((col - half) * spacing, 3),
                    0.6,
                    round((row - half) * spacing, 3),
                ],
                "color": "#60a5fa",
                "physics": "none",
                "batched": True,
                "batch": "stress_unit",
            }
        )
    objects.append(
        {
            "name": "Stress Sun",
            "kind": "light",
            "lightType": "directional",
            "color": "#ffd7a8",
            "intensity": 2.5,
            "position": [20, 40, 20],
        }
    )
    return {
        "id": "stress_scene",
        "name": name,
        "goal": f"Scale validation: {count} batched instances (single indirect draw call)",
        "gameObjects": objects,
        "rules": [{"id": "budget", "type": "draw_call_budget", "max": 100}],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a batched-instance stress scene"
    )
    parser.add_argument("--count", type=int, default=10000)
    parser.add_argument("--spacing", type=float, default=2.0)
    parser.add_argument(
        "--out", default=str(REPO_ROOT / "harness" / "scenes" / "stress_scene.json")
    )
    args = parser.parse_args()

    scene = build_stress_scene(args.count, spacing=args.spacing)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print(
        f"wrote {out_path} ({args.count} batched instances, {len(scene['gameObjects'])} game objects)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
