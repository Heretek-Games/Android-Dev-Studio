#!/usr/bin/env python3
"""
Scene Exporter — Tier 2 native scene pipeline.

Translates a flat studio scene JSON (canonical `active_scene.json` or a
scenario spec) into the dependency-free line format consumed by the native
Vulkan container (`templates/vulkan-container`), plus a summary JSON with
draw-call estimates for the mobile budget.

Native format (heretek-native-scene v1), one record per line:
    # comment
    scene <name>
    mesh <name> <px> <py> <pz> <sx> <sy> <sz> <r> <g> <b> <physics>
    instance <meshName> <px> <py> <pz> <rotY>
    light <name> <px> <py> <pz> <r> <g> <b> <intensity> <type>

Colors are 0..1 floats. Physics is fixed|dynamic|none. Instances reference a
mesh record by name (batched instancing: one draw call per unique mesh).

Usage:
    python3 harness/build/scene_exporter.py --scene harness/scenes/active_scene.json \
        --out templates/vulkan-container/app/src/main/assets
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

MESH_KINDS = {"mesh", "model", "terrain"}
MAX_DRAW_CALLS = 100


def hex_to_rgb(color: Any) -> Tuple[float, float, float]:
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        return (float(color[0]), float(color[1]), float(color[2]))
    if isinstance(color, str) and color.startswith("#") and len(color) in (4, 7):
        c = color[1:]
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        return (
            int(c[0:2], 16) / 255.0,
            int(c[2:4], 16) / 255.0,
            int(c[4:6], 16) / 255.0,
        )
    return (0.5, 0.5, 0.5)


def _vec(
    value: Any, fallback: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        return (float(value[0]), float(value[1]), float(value[2]))
    return fallback


def _f(v: float) -> str:
    """Fixed 4-decimal formatting keeps exports deterministic and compact."""
    return f"{v:.4f}"


def quadtree_leaves(
    min_x: float,
    min_z: float,
    max_x: float,
    max_z: float,
    focus_x: float,
    focus_z: float,
    max_depth: int = 4,
    split_factor: float = 1.6,
) -> List[Dict[str, Any]]:
    """
    Focus-driven quadtree subdivision (static export mirror of the engine's
    QuadtreeTerrain): a node splits when the focus is within
    `size × split_factor` of its bounds and depth < max_depth. Leaves carry a
    depth-derived LOD level and a continuous blend factor (1 at the split
    radius → 0 at 1.25×) for pop-free transitions.
    """
    leaves: List[Dict[str, Any]] = []

    def distance(x0: float, z0: float, x1: float, z1: float) -> float:
        dx = max(x0 - focus_x, 0.0, focus_x - x1)
        dz = max(z0 - focus_z, 0.0, focus_z - z1)
        return math.sqrt(dx * dx + dz * dz)

    def visit(
        node_id: str, depth: int, x0: float, z0: float, x1: float, z1: float
    ) -> None:
        size = x1 - x0
        d = distance(x0, z0, x1, z1)
        split_radius = size * split_factor
        if depth < max_depth and d <= split_radius:
            mx = (x0 + x1) / 2.0
            mz = (z0 + z1) / 2.0
            visit(f"{node_id}.0", depth + 1, x0, z0, mx, mz)
            visit(f"{node_id}.1", depth + 1, mx, z0, x1, mz)
            visit(f"{node_id}.2", depth + 1, x0, mz, mx, z1)
            visit(f"{node_id}.3", depth + 1, mx, mz, x1, z1)
        else:
            band = max(1e-6, split_radius * 0.25)
            blend = (
                1.0
                if depth >= max_depth
                else min(1.0, max(0.0, (split_radius * 1.25 - d) / band))
            )
            leaves.append(
                {
                    "id": node_id,
                    "depth": depth,
                    "minX": x0,
                    "minZ": z0,
                    "maxX": x1,
                    "maxZ": z1,
                    "lod": depth,
                    "blend": blend,
                }
            )

    visit("0", 0, min_x, min_z, max_x, max_z)
    return leaves


def export_scene(
    scene: Dict[str, Any],
    source_name: str = "",
    quadtree: Dict[str, Any] | None = None,
) -> Tuple[str, Dict[str, Any]]:
    """Returns (native_text, summary_dict). Pure function — no file IO."""
    name = str(scene.get("name") or scene.get("id") or "Scene")
    lines: List[str] = ["# heretek-native-scene v1", f"scene {name}"]

    meshes = 0
    instances = 0
    lights = 0
    batch_keys: set = set()

    for obj in scene.get("gameObjects", []):
        if not isinstance(obj, dict):
            continue
        obj_name = str(obj.get("name", "unnamed")).replace(" ", "_")
        pos = _vec(obj.get("position"), (0.0, 0.0, 0.0))
        size = _vec(obj.get("size"), (1.0, 1.0, 1.0))
        rgb = hex_to_rgb(obj.get("color"))

        kind = obj.get("kind", "mesh")
        if kind == "light":
            ltype = obj.get("lightType", "directional")
            intensity = float(obj.get("intensity", 1.0))
            lines.append(
                f"light {obj_name} {_f(pos[0])} {_f(pos[1])} {_f(pos[2])} "
                f"{_f(rgb[0])} {_f(rgb[1])} {_f(rgb[2])} {_f(intensity)} {ltype}"
            )
            lights += 1
        elif kind in MESH_KINDS:
            physics = obj.get("physics", "none") or "none"
            if obj.get("batched"):
                # Instanced: many objects share one draw call per batch key
                batch_key = str(
                    obj.get("batch") or obj.get("shape") or "instanced_batch"
                ).replace(" ", "_")
                lines.append(
                    f"instance {batch_key} {_f(pos[0])} {_f(pos[1])} {_f(pos[2])} 0.0000"
                )
                instances += 1
                batch_keys.add(batch_key)
            else:
                lines.append(
                    f"mesh {obj_name} {_f(pos[0])} {_f(pos[1])} {_f(pos[2])} "
                    f"{_f(size[0])} {_f(size[1])} {_f(size[2])} "
                    f"{_f(rgb[0])} {_f(rgb[1])} {_f(rgb[2])} {physics}"
                )
                meshes += 1

    # Draw-call estimate: one per mesh + one per unique instanced batch (lights are not draws)
    draw_calls = meshes + len(batch_keys)

    # Optional quadtree terrain LOD export (one draw call per visible leaf)
    terrain_leaves: List[Dict[str, Any]] = []
    if quadtree:
        terrain_leaves = quadtree_leaves(
            quadtree.get("minX", -512.0),
            quadtree.get("minZ", -512.0),
            quadtree.get("maxX", 512.0),
            quadtree.get("maxZ", 512.0),
            quadtree.get("focusX", 0.0),
            quadtree.get("focusZ", 0.0),
            int(quadtree.get("maxDepth", 4)),
            float(quadtree.get("splitFactor", 1.6)),
        )
        lines.append(
            f"terrain_meta {int(quadtree.get('maxDepth', 4))} "
            f"{_f(quadtree.get('focusX', 0.0))} {_f(quadtree.get('focusZ', 0.0))}"
        )
        for leaf in terrain_leaves:
            lines.append(
                f"terrain_lod {leaf['id']} {leaf['depth']} "
                f"{_f(leaf['minX'])} {_f(leaf['minZ'])} {_f(leaf['maxX'])} {_f(leaf['maxZ'])} "
                f"{leaf['lod']} {_f(leaf['blend'])}"
            )
        draw_calls += len(terrain_leaves)

    summary = {
        "format": "heretek-native-scene/v1",
        "scene": name,
        "source": source_name,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "meshes": meshes,
            "instances": instances,
            "lights": lights,
            "terrainLodLeaves": len(terrain_leaves),
        },
        "drawCalls": draw_calls,
        "drawBudget": MAX_DRAW_CALLS,
        "withinBudget": draw_calls <= MAX_DRAW_CALLS,
        "lines": len(lines),
    }
    return "\n".join(lines) + "\n", summary


def export_file(
    scene_path: str, out_dir: str, quadtree: Dict[str, Any] | None = None
) -> Dict[str, Any]:
    with open(scene_path, "r", encoding="utf-8") as f:
        scene = json.load(f)
    native_text, summary = export_scene(
        scene, source_name=os.path.basename(scene_path), quadtree=quadtree
    )
    os.makedirs(out_dir, exist_ok=True)
    native_path = os.path.join(out_dir, "scene.native")
    summary_path = os.path.join(out_dir, "scene.summary.json")
    with open(native_path, "w", encoding="utf-8") as f:
        f.write(native_text)
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    summary["nativePath"] = native_path
    summary["summaryPath"] = summary_path
    return summary


def main() -> int:
    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    parser = argparse.ArgumentParser(description="Heretek Tier 2 scene exporter")
    parser.add_argument(
        "--scene",
        default=os.path.join(repo_root, "harness", "scenes", "active_scene.json"),
        help="Scene JSON to export (flat studio schema)",
    )
    parser.add_argument(
        "--out",
        default=os.path.join(
            repo_root, "templates", "vulkan-container", "app", "src", "main", "assets"
        ),
        help="Output directory for scene.native + scene.summary.json",
    )
    parser.add_argument(
        "--quadtree",
        action="store_true",
        help="Emit focus-driven terrain LOD nodes (terrain_lod records)",
    )
    parser.add_argument(
        "--lod-focus",
        nargs=2,
        type=float,
        default=[0.0, 0.0],
        metavar=("X", "Z"),
        help="Focus point for quadtree subdivision",
    )
    parser.add_argument(
        "--lod-depth", type=int, default=4, help="Maximum quadtree depth"
    )
    parser.add_argument(
        "--lod-bounds",
        nargs=4,
        type=float,
        default=None,
        metavar=("MINX", "MINZ", "MAXX", "MAXZ"),
        help="World bounds for the quadtree (default ±512)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.scene):
        print(f"error: scene not found: {args.scene}", file=sys.stderr)
        return 2

    quadtree = None
    if args.quadtree:
        bounds = args.lod_bounds or [-512.0, -512.0, 512.0, 512.0]
        quadtree = {
            "minX": bounds[0],
            "minZ": bounds[1],
            "maxX": bounds[2],
            "maxZ": bounds[3],
            "focusX": args.lod_focus[0],
            "focusZ": args.lod_focus[1],
            "maxDepth": args.lod_depth,
        }

    summary = export_file(args.scene, args.out, quadtree)
    print(json.dumps(summary, indent=2))
    return 0 if summary["withinBudget"] else 1


if __name__ == "__main__":
    sys.exit(main())
