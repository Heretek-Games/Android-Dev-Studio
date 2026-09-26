"""
Asset provenance registry (Track D.5): SBOM-shaped answers to
"where did this come from" for every model object in a scene.

In-scene truth lives on the objects themselves (modelUrl/source/license
plus an optional provenance{addedBy, addedAt} stamp; absence means
studio/human origin). This module derives queryable rows and mirrors
them into project memory.
"""

from typing import Any, Dict, List

#: One draw per model object (mirrors the QA runner's draw estimator).
DRAW_COST_PER_MODEL = 1


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def audit_scene_provenance(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Derive one provenance row per modelUrl-bearing object.

    Returns {rows, complete}: complete is False when any model object
    lacks a uid ref, a license, or a source — the queryable gap the
    registry exists to close.
    """
    rows: List[Dict[str, str]] = []
    gaps: List[str] = []
    for obj in _objects(scene):
        model_url = obj.get("modelUrl")
        if not model_url:
            continue
        name = str(obj.get("name", "?"))
        provenance = obj.get("provenance")
        added_by = ""
        added_at = 0.0
        if isinstance(provenance, dict):
            added_by = str(provenance.get("addedBy", ""))
            try:
                added_at = float(provenance.get("addedAt", 0.0))
            except (TypeError, ValueError):
                added_at = 0.0
        if not added_by:
            added_by = "studio"  # unstamped objects predate/are human-made
        row = {
            "object": name,
            "uid": str(model_url),
            "license": str(obj.get("license", "UNSPECIFIED")),
            "source": str(obj.get("source", "unknown")),
            "addedBy": added_by,
            "addedAt": added_at,
            "drawCost": DRAW_COST_PER_MODEL,
        }
        rows.append(row)
        missing = [
            key
            for key in ("uid", "license", "source")
            if row[key] in ("", "unknown", "UNSPECIFIED")
        ]
        if missing:
            gaps.append(f"{name} lacks {', '.join(missing)}")
    return {"rows": rows, "gaps": gaps, "complete": not gaps, "count": len(rows)}
