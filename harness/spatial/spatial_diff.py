"""
Mutation spatial diffs (Track B.3, headless half).

Every loop iteration mutates the scene; the diff names WHAT moved where, so
agents and humans see "the wall shifted 2m north and now blocks the nav
corridor" BEFORE QA rediscovers it. Name-keyed, pure, deterministic:

  diff_scenes(before, after) -> {
      added: [names], removed: [names],
      moved: [{name, from, to, dist}],
      resized: [{name, from, to}],
      physics_changed: [{name, from, to}],
      ui_changed: bool, places_changed: [names], theme_changed: bool,
      empty: bool,
  }

Summaries compile to one repair-prompt line via summarize_diff().
"""

import math
from typing import Any, Dict, List


def _objects(scene: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return {}
    out = {}
    for obj in raw:
        if isinstance(obj, dict) and isinstance(obj.get("name"), str):
            out[obj["name"]] = obj
    return out


def _vec(value: Any) -> List[float]:
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return [0.0, 0.0, 0.0]
    try:
        return [float(value[0]), float(value[1]), float(value[2])]
    except (TypeError, ValueError):
        return [0.0, 0.0, 0.0]


def _dist(a: List[float], b: List[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def diff_scenes(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Any]:
    """Name-keyed spatial diff between two flat scenes."""
    old, new = _objects(before or {}), _objects(after or {})
    added = sorted(n for n in new if n not in old)
    removed = sorted(n for n in old if n not in new)
    moved, resized, physics_changed = [], [], []
    for name in old:
        if name not in new:
            continue
        before_pos, after_pos = (
            _vec(old[name].get("position")),
            _vec(new[name].get("position")),
        )
        dist = _dist(before_pos, after_pos)
        if dist > 1e-9:
            moved.append(
                {
                    "name": name,
                    "from": before_pos,
                    "to": after_pos,
                    "dist": round(dist, 3),
                }
            )
        before_size, after_size = (
            _vec(old[name].get("size")),
            _vec(new[name].get("size")),
        )
        if _dist(before_size, after_size) > 1e-9:
            resized.append({"name": name, "from": before_size, "to": after_size})
        if old[name].get("physics") != new[name].get("physics"):
            physics_changed.append(
                {
                    "name": name,
                    "from": old[name].get("physics"),
                    "to": new[name].get("physics"),
                }
            )
    moved.sort(key=lambda m: -m["dist"])

    old_places = {
        p["name"]
        for p in (before or {}).get("places", [])
        if isinstance(p, dict) and isinstance(p.get("name"), str)
    }
    new_places = {
        p["name"]
        for p in (after or {}).get("places", [])
        if isinstance(p, dict) and isinstance(p.get("name"), str)
    }
    places_changed = sorted((old_places ^ new_places))
    old_ui = (before or {}).get("ui") or {}
    new_ui = (after or {}).get("ui") or {}
    theme_changed = old_ui.get("theme") != new_ui.get("theme")
    old_ids = sorted(
        e.get("id") for e in old_ui.get("elements", []) if isinstance(e, dict)
    )
    new_ids = sorted(
        e.get("id") for e in new_ui.get("elements", []) if isinstance(e, dict)
    )
    ui_changed = theme_changed or old_ids != new_ids

    empty = not (
        added
        or removed
        or moved
        or resized
        or physics_changed
        or places_changed
        or ui_changed
    )
    return {
        "added": added,
        "removed": removed,
        "moved": moved,
        "resized": resized,
        "physics_changed": physics_changed,
        "ui_changed": ui_changed,
        "places_changed": places_changed,
        "theme_changed": theme_changed,
        "empty": empty,
    }


def summarize_diff(diff: Dict[str, Any], limit: int = 4) -> str:
    """One repair-prompt line naming the mutation (empty string when none)."""
    if diff.get("empty"):
        return ""
    parts = []
    for name in diff.get("added", [])[:limit]:
        parts.append(f"+{name}")
    for name in diff.get("removed", [])[:limit]:
        parts.append(f"-{name}")
    for move in diff.get("moved", [])[:limit]:
        frm, to = move["from"], move["to"]
        parts.append(
            f"{move['name']} [{frm[0]:g},{frm[1]:g},{frm[2]:g}]"
            f"→[{to[0]:g},{to[1]:g},{to[2]:g}]"
        )
    if diff.get("places_changed"):
        parts.append("places:" + ",".join(diff["places_changed"][:limit]))
    if diff.get("ui_changed"):
        parts.append("ui-shell changed")
    extra = ""
    total = (
        len(diff.get("added", []))
        + len(diff.get("removed", []))
        + len(diff.get("moved", []))
    )
    if total > limit:
        extra = f" (+{total - limit} more)"
    return "Last patch moved: " + "; ".join(parts) + extra + "."
