"""
Agent spatial queries (Track B.2): EQS-shaped questions over the unified index.

Agents ask about the world instead of editing raw coordinates. Every answer
derives from the SAME SpatialIndex the B.1 audit gates on, so query results
and gate verdicts can never disagree.

EQS mapping (Unreal pattern, adapted — see ADR-1790389500001):
  Generators -> candidate sets (ring/grid points around a context),
  Tests      -> filter (LoS, reachability, walkability) then score (distance),
  Contexts   -> the querier object or a named place.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from harness.spatial.spatial_index import SpatialIndex


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def _pos3(obj: Dict[str, Any]) -> Tuple[float, float, float]:
    value = obj.get("position")
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return (0.0, 0.0, 0.0)
    try:
        return (float(value[0]), float(value[1]), float(value[2]))
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0)


def validate_places(places: Any) -> List[str]:
    """Problems with a scene.places block (empty = valid)."""
    problems: List[str] = []
    if places is None:
        return problems
    if not isinstance(places, list):
        return ["places must be an array of {name, position[, radius]}"]
    seen = set()
    for i, place in enumerate(places):
        if not isinstance(place, dict):
            problems.append(f"places[{i}] must be an object")
            continue
        name = place.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"places[{i}].name must be a non-empty string")
        elif name in seen:
            problems.append(f"duplicate place name {name!r}")
        else:
            seen.add(name)
        pos = place.get("position")
        if (
            not isinstance(pos, (list, tuple))
            or len(pos) != 3
            or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in pos)
        ):
            problems.append(f"place {name!r}: position must be 3 finite numbers")
        radius = place.get("radius", 1.0)
        if not (
            isinstance(radius, (int, float)) and math.isfinite(radius) and radius > 0
        ):
            problems.append(f"place {name!r}: radius must be a positive number")
    return problems


class QueryRunner:
    """Answer spatial questions about a scene (index built once, reused)."""

    def __init__(self, scene: Dict[str, Any]):
        self.scene = scene
        self.objects = _objects(scene)
        self.index = SpatialIndex(scene)
        raw_places = scene.get("places")
        self.places = (
            [p for p in raw_places if isinstance(p, dict)]
            if isinstance(raw_places, list)
            else []
        )

    # -- contexts --
    def named(self, name: str) -> Optional[Dict[str, Any]]:
        for obj in self.objects:
            if obj.get("name") == name:
                return obj
        return None

    def place(self, name: str) -> Optional[Dict[str, Any]]:
        for place in self.places:
            if place.get("name") == name:
                return place
        return None

    def place_position(self, name: str) -> Optional[Tuple[float, float, float]]:
        place = self.place(name)
        if place is None:
            return None
        pos = place.get("position")
        try:
            return (float(pos[0]), float(pos[1]), float(pos[2]))
        except (TypeError, ValueError, IndexError):
            return None

    # -- proximity / topology --
    def within(
        self, x: float, z: float, radius: float, kind: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        out = []
        for obj in self.objects:
            if (
                kind is not None
                and obj.get("kind") != kind
                and kind not in (obj.get("shape"), obj.get("physics"))
            ):
                continue
            ox, _, oz = _pos3(obj)
            if math.hypot(ox - x, oz - z) <= radius:
                out.append(obj)
        out.sort(key=lambda o: math.hypot(_pos3(o)[0] - x, _pos3(o)[2] - z))
        return out

    def nearest(
        self,
        x: float,
        z: float,
        kind: Optional[str] = None,
        exclude: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        best, best_d = None, math.inf
        for obj in self.objects:
            if exclude is not None and obj.get("name") == exclude:
                continue
            if (
                kind is not None
                and obj.get("kind") != kind
                and kind not in (obj.get("shape"), obj.get("physics"))
            ):
                continue
            ox, _, oz = _pos3(obj)
            dist = math.hypot(ox - x, oz - z)
            if dist < best_d:
                best, best_d = obj, dist
        return best

    # -- affordances --
    def is_walkable(self, x: float, z: float) -> bool:
        return self.index.is_walkable(x, z)

    def has_los(self, ax: float, az: float, bx: float, bz: float) -> bool:
        return self.index.line_of_sight(ax, az, bx, bz)

    def reachable(self, ax: float, az: float, bx: float, bz: float) -> bool:
        return self.index.reachable(ax, az, bx, bz)

    def camera_visible(self, name: str) -> Optional[bool]:
        """Is the named object inside the gameplay camera's sight line?"""
        from harness.loop.frame_preview import select_camera
        from harness.spatial.spatial_index import camera_occluded

        obj = self.named(name)
        if obj is None:
            return None
        cam = select_camera(self.scene)
        blocker = camera_occluded(
            (cam["position"][0], cam["position"][1], cam["position"][2]),
            _pos3(obj),
            self.index.footprints,
        )
        return blocker is None

    def nearest_open(
        self, x: float, z: float, radius: float = 6.0, step: float = 1.0
    ) -> Optional[Tuple[float, float]]:
        """Nearest walkable + supported point (spawn finder): spiral search."""
        if self.is_walkable(x, z) and self.index.support_top(x, z) is not None:
            return (x, z)
        rings = max(1, int(radius / step))
        for ring in range(1, rings + 1):
            for k in range(8 * ring):
                angle = (k / (8 * ring)) * 2 * math.pi
                px, pz = (
                    x + math.cos(angle) * ring * step,
                    z + math.sin(angle) * ring * step,
                )
                if (
                    self.is_walkable(px, pz)
                    and self.index.support_top(px, pz) is not None
                ):
                    return (px, pz)
        return None

    def nearest_cover(
        self,
        x: float,
        z: float,
        threat_x: float,
        threat_z: float,
        radius: float = 12.0,
    ) -> Optional[Dict[str, Any]]:
        """Nearest walkable point hidden from (threat_x, threat_z)."""
        if not self.has_los(x, z, threat_x, threat_z) and self.is_walkable(x, z):
            return {"x": x, "z": z, "distance": 0.0}
        best, best_d = None, math.inf
        steps = max(1, int(radius))
        for ring in range(1, steps + 1):
            for k in range(8 * ring):
                angle = (k / (8 * ring)) * 2 * math.pi
                px, pz = x + math.cos(angle) * ring, z + math.sin(angle) * ring
                if not self.is_walkable(px, pz):
                    continue
                if self.has_los(px, pz, threat_x, threat_z):
                    continue
                dist = math.hypot(px - x, pz - z)
                if dist < best_d:
                    best, best_d = {"x": px, "z": pz, "distance": dist}, dist
            if best is not None and ring >= best_d:
                break
        return best

    def query_cover(
        self, querier: str, threat: str, radius: float = 12.0
    ) -> Dict[str, Any]:
        """EQS-style cover query: grid generator, LoS+reachability filters,
        distance score. Returns {point, score, candidates} or {point: None}."""
        me = self.named(querier)
        foe = self.named(threat)
        if me is None or foe is None:
            return {"point": None, "reason": "unknown querier or threat"}
        mx, _, mz = _pos3(me)
        fx, _, fz = _pos3(foe)
        # Generator: ring grid around the querier.
        candidates = []
        steps = max(1, int(radius))
        for ring in range(0, steps + 1):
            spokes = 1 if ring == 0 else 8 * ring
            for k in range(spokes):
                angle = (k / spokes) * 2 * math.pi if spokes else 0.0
                candidates.append(
                    (mx + math.cos(angle) * ring, mz + math.sin(angle) * ring)
                )
        # Tests: walkable filter, hidden-from-threat filter,
        # reachable filter, then distance score (closer wins).
        scored = []
        for px, pz in candidates:
            if not self.is_walkable(px, pz):
                continue
            if self.has_los(px, pz, fx, fz):
                continue
            if not self.reachable(mx, mz, px, pz):
                continue
            dist = math.hypot(px - mx, pz - mz)
            scored.append((dist, px, pz))
        if not scored:
            return {
                "point": None,
                "reason": "no reachable hidden point in radius",
                "candidates": len(candidates),
            }
        scored.sort()
        dist, px, pz = scored[0]
        return {
            "point": {"x": px, "z": pz},
            "score": round(dist, 3),
            "candidates": len(candidates),
            "passing": len(scored),
        }


def scene_digest(scene: Dict[str, Any], max_names: int = 12) -> str:
    """Compacted scene summary for the context window (B.2 digest).

    Zones + contents + connections in prose-ish lines; agents drill down with
    QueryRunner (within/nearest/place_position) instead of holding 500 objects.
    """
    objects = _objects(scene)
    raw_places = scene.get("places")
    places = (
        [p for p in raw_places if isinstance(p, dict)]
        if isinstance(raw_places, list)
        else []
    )
    kinds: Dict[str, int] = {}
    for obj in objects:
        key = str(obj.get("kind", obj.get("shape", "?")))
        kinds[key] = kinds.get(key, 0) + 1
    xs = [
        float(o.get("position", [0, 0, 0])[0])
        for o in objects
        if isinstance(o.get("position"), (list, tuple))
    ]
    zs = [
        float(o.get("position", [0, 0, 0])[2])
        for o in objects
        if isinstance(o.get("position"), (list, tuple))
    ]
    bounds = (
        f"X {min(xs):.0f}..{max(xs):.0f} Z {min(zs):.0f}..{max(zs):.0f}"
        if xs
        else "empty"
    )
    actors = [
        str(o.get("name"))
        for o in objects
        if o.get("controller") is True or isinstance(o.get("ai"), dict)
    ][:max_names]
    cameras = [str(o.get("name")) for o in objects if o.get("kind") == "camera"][:4]
    lines = [
        f"scene '{scene.get('name', '?')}': {len(objects)} objects [{bounds}]",
        "kinds: " + (", ".join(f"{k}x{v}" for k, v in sorted(kinds.items())) or "none"),
        "actors: " + (", ".join(actors) or "none"),
        "cameras: " + (", ".join(cameras) or "none (chase/default)"),
        "places: "
        + (
            ", ".join(
                f"{p.get('name')}@{tuple(p.get('position', '?'))}"
                for p in places[:max_names]
            )
            or "none"
        ),
    ]
    return "\n".join(lines)


def objects_in(
    scene: Dict[str, Any],
    min_x: float,
    min_z: float,
    max_x: float,
    max_z: float,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Drill-down: slim {name, kind, position} rows inside an XZ rect."""
    out = []
    for obj in _objects(scene):
        x, _, z = _pos3(obj)
        if min_x <= x <= max_x and min_z <= z <= max_z:
            out.append(
                {
                    "name": obj.get("name"),
                    "kind": obj.get("kind"),
                    "position": [x, _pos3(obj)[1], z],
                }
            )
        if len(out) >= limit:
            break
    return out
