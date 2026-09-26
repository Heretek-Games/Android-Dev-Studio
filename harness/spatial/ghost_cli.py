#!/usr/bin/env python3
"""Ghost placement validity probe (Track B.3 studio half).

Evaluates a hypothetical placement against the canonical scene through the
unified spatial audit — the same verdicts the loop gates on, before anything
is written. Backs POST /api/spatial/ghost.

Usage:
    python3 harness/spatial/ghost_cli.py --scene <scene.json> \
        --placement '{"name":"Crate","position":[2,1,2],"size":[1,1,1],"physics":"dynamic"}'

Output JSON: {valid, walkable, supported, clearance, defects[], supportTop}.
"""

import argparse
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.spatial.spatial_audit import spatial_audit  # noqa: E402
from harness.spatial.spatial_index import SpatialIndex  # noqa: E402


def evaluate(scene, placement):
    candidate = copy.deepcopy(scene)
    objects = candidate.setdefault("gameObjects", [])
    ghost = {
        "name": placement.get("name", "Ghost"),
        "shape": placement.get("shape", "box"),
        "size": placement.get("size", [1, 1, 1]),
        "position": placement.get("position", [0, 1, 0]),
        "color": placement.get("color", "#22d3ee"),
        "physics": placement.get("physics", "dynamic"),
    }
    objects.append(ghost)
    index = SpatialIndex(candidate)
    x, y, z = (float(v) for v in ghost["position"])
    half_h = abs(float(ghost["size"][1])) / 2.0
    bottom = y - half_h
    top = index.support_top(x, z)
    audit = spatial_audit(candidate)
    ghost_defects = [
        d["defect"]
        for d in audit["defects"]
        if ghost["name"] in d.get("check", "") or "sight line" in d.get("check", "")
    ]
    return {
        "valid": audit["pass"],
        "walkable": index.is_walkable(x, z),
        "supported": top is not None and bottom <= top + 3.0,
        "supportTop": top,
        "clearance": index.clearance(x, z),
        "defects": [
            d
            for c in audit["checks"]
            if not c["pass"]
            for d in [c["detail"]]
            if ghost["name"] in c["check"] or c["check"] == "camera_framing"
        ],
        "ghostDefects": ghost_defects,
    }


def main():
    parser = argparse.ArgumentParser(description="Ghost placement validity probe")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--placement", required=True)
    args = parser.parse_args()
    scene = json.loads(Path(args.scene).read_text(encoding="utf-8"))
    placement = json.loads(args.placement)
    print(json.dumps(evaluate(scene, placement), indent=1))


if __name__ == "__main__":
    main()
