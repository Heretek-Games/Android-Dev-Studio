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


def export_scene(
    scene: Dict[str, Any], source_name: str = ""
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

    summary = {
        "format": "heretek-native-scene/v1",
        "scene": name,
        "source": source_name,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "counts": {"meshes": meshes, "instances": instances, "lights": lights},
        "drawCalls": draw_calls,
        "drawBudget": MAX_DRAW_CALLS,
        "withinBudget": draw_calls <= MAX_DRAW_CALLS,
        "lines": len(lines),
    }
    return "\n".join(lines) + "\n", summary


def export_file(scene_path: str, out_dir: str) -> Dict[str, Any]:
    with open(scene_path, "r", encoding="utf-8") as f:
        scene = json.load(f)
    native_text, summary = export_scene(scene, source_name=os.path.basename(scene_path))
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
    args = parser.parse_args()

    if not os.path.exists(args.scene):
        print(f"error: scene not found: {args.scene}", file=sys.stderr)
        return 2

    summary = export_file(args.scene, args.out)
    print(json.dumps(summary, indent=2))
    return 0 if summary["withinBudget"] else 1


if __name__ == "__main__":
    sys.exit(main())
