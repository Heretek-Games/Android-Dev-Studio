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
    count: int = 0,
    name: str = "Stress Arena",
    spacing: float = 2.0,
    foliage: int = 0,
    foliage_radius: float = 10.0,
) -> Dict[str, Any]:
    """Grid of `count` batched boxes + ground + light + optional foliage ring.

    Foliage instances use the `foliage` batch key, which the Tier 2 renderer treats
    as the wind-animated category (its own pipeline + compaction range).
    """
    if count < 0 or foliage < 0:
        raise ValueError("count and foliage must be >= 0")
    if count == 0 and foliage == 0:
        raise ValueError("scene needs at least one instance (count or foliage)")
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
    # Foliage ring: windswept blades around the arena (category 1 in the renderer).
    for index in range(foliage):
        ring = 1.0 + (index % 7) * 0.35
        angle = index * 0.61803398875 * 2.0 * math.pi
        radius = (foliage_radius * ring) / 7.0 + (index % 5) * 0.8
        objects.append(
            {
                "name": f"Blade {index}",
                "shape": "box",
                "size": [0.6, 3.0, 0.6],
                "position": [
                    round(math.cos(angle) * radius, 3),
                    1.5,  # base at ground level for the 3-unit blade
                    round(math.sin(angle) * radius, 3),
                ],
                "color": "#4d8b3a",
                "physics": "none",
                "batched": True,
                "batch": "foliage",
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
    parser.add_argument("--foliage", type=int, default=0, help="Wind-animated foliage blades to add")
    parser.add_argument("--foliage-radius", type=float, default=10.0)
    parser.add_argument(
        "--out", default=str(REPO_ROOT / "harness" / "scenes" / "stress_scene.json")
    )
    args = parser.parse_args()

    scene = build_stress_scene(args.count, spacing=args.spacing, foliage=args.foliage,
                               foliage_radius=args.foliage_radius)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print(
        f"wrote {out_path} ({args.count} batched instances, {len(scene['gameObjects'])} game objects)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
