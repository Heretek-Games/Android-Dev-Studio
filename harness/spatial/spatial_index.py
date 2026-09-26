"""
Unified spatial index for the loop (Track B.1): ONE canonical footprint source
feeding nav bake, traversal, spawn clearance, and camera occlusion.

Canonical semantics (shared with engine collectStaticFootprints, studio
obstacleFootprints, and the invariant gate): a TALL fixed-physics box
(height >= MIN_HEIGHT) blocks movement; thin slabs are walkable ground.
Raster + agent-radius erosion mirrors engine bakeWalkability exactly
(Recast pattern at grid scale — see ADR-1790389400001); reachability uses
4-directional BFS, matching flatAStar connectivity.

All queries are pure functions over the flat scene dict. Sizes/positions that
are missing or non-finite degrade to documented defaults, never exceptions.
"""

import math
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

#: Thin slabs below this height are walkable ground, not obstacles.
MIN_HEIGHT = 2.0
#: Raster cell size in world units (Recast cell ~ r/2.5 at agent radius 0.4).
CELL_SIZE = 1.0
#: Walkability erosion margin (agent radius, mirrors engine default).
AGENT_RADIUS = 0.4


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def _pos(obj: Dict[str, Any]) -> Tuple[float, float, float]:
    value = obj.get("position")
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return (0.0, 0.0, 0.0)
    return (_num(value[0]), _num(value[1]), _num(value[2]))


def _size(obj: Dict[str, Any]) -> Tuple[float, float, float]:
    value = obj.get("size")
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return (1.0, 1.0, 1.0)
    return (
        abs(_num(value[0], 1.0)),
        abs(_num(value[1], 1.0)),
        abs(_num(value[2], 1.0)),
    )


def collect_footprints(
    scene: Dict[str, Any], min_height: float = MIN_HEIGHT
) -> List[Dict[str, Any]]:
    """Canonical obstacle footprints: {name, x, z, hx, hz, top}.

    Twin of engine collectStaticFootprints + studio obstacleFootprints —
    any semantic change here must land in all three (parity test guards it).
    """
    out: List[Dict[str, Any]] = []
    for obj in _objects(scene):
        if obj.get("kind") in ("camera", "light"):
            continue
        if obj.get("physics") != "fixed":
            continue
        x, y, z = _pos(obj)
        sx, sy, sz = _size(obj)
        if sy < min_height:
            continue
        out.append(
            {
                "name": str(obj.get("name", "?")),
                "x": x,
                "z": z,
                "hx": sx / 2.0,
                "hz": sz / 2.0,
                "top": y + sy / 2.0,
            }
        )
    return out


def collect_ground_slabs(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Walkable fixed slabs (height < MIN_HEIGHT): {name, x, z, hx, hz, top}."""
    out: List[Dict[str, Any]] = []
    for obj in _objects(scene):
        if obj.get("kind") in ("camera", "light"):
            continue
        if obj.get("physics") != "fixed":
            continue
        x, y, z = _pos(obj)
        sx, sy, sz = _size(obj)
        if sy >= MIN_HEIGHT:
            continue
        out.append(
            {
                "name": str(obj.get("name", "?")),
                "x": x,
                "z": z,
                "hx": sx / 2.0,
                "hz": sz / 2.0,
                "top": y + sy / 2.0,
            }
        )
    return out


class SpatialIndex:
    """Scene-owned walkability grid + spatial queries (single source of truth)."""

    def __init__(
        self,
        scene: Dict[str, Any],
        cell_size: float = CELL_SIZE,
        agent_radius: float = AGENT_RADIUS,
        pad: float = 2.0,
    ):
        self.cell_size = cell_size
        self.agent_radius = agent_radius
        self.footprints = collect_footprints(scene)
        self.slabs = collect_ground_slabs(scene)

        xs, zs = [], []
        for obj in _objects(scene):
            if obj.get("kind") in ("camera", "light"):
                continue
            x, _, z = _pos(obj)
            xs.append(x)
            zs.append(z)
            # Nav goals live beyond their agents: bound them too, or targets
            # outside the object cloud read as out-of-bounds blocked.
            nav = obj.get("nav")
            if isinstance(nav, dict):
                target = nav.get("target")
                if isinstance(target, (list, tuple)) and len(target) == 2:
                    xs.append(_num(target[0]))
                    zs.append(_num(target[1]))
        # Named places are queried geography: bound them like nav goals.
        raw_places = scene.get("places")
        if isinstance(raw_places, list):
            for place in raw_places:
                if not isinstance(place, dict):
                    continue
                pos = place.get("position")
                if isinstance(pos, (list, tuple)) and len(pos) == 3:
                    xs.append(_num(pos[0]))
                    zs.append(_num(pos[2]))
        for fp in self.footprints:
            xs += [fp["x"] - fp["hx"], fp["x"] + fp["hx"]]
            zs += [fp["z"] - fp["hz"], fp["z"] + fp["hz"]]
        if not xs:
            xs, zs = [-10.0, 10.0], [-10.0, 10.0]
        self.origin_x = math.floor(min(xs) - pad)
        self.origin_z = math.floor(min(zs) - pad)
        self.width = max(1, int(math.ceil(max(xs) + pad - self.origin_x)))
        self.height = max(1, int(math.ceil(max(zs) + pad - self.origin_z)))
        self.blocked = bytearray(self.width * self.height)
        self._bake()

    # -- bake (mirrors engine bakeWalkability) --
    def _bake(self) -> None:
        for fp in self.footprints:
            hx = fp["hx"] + self.agent_radius
            hz = fp["hz"] + self.agent_radius
            x0 = max(0, math.floor((fp["x"] - hx - self.origin_x) / self.cell_size))
            x1 = min(
                self.width - 1,
                math.floor((fp["x"] + hx - self.origin_x) / self.cell_size),
            )
            z0 = max(0, math.floor((fp["z"] - hz - self.origin_z) / self.cell_size))
            z1 = min(
                self.height - 1,
                math.floor((fp["z"] + hz - self.origin_z) / self.cell_size),
            )
            for z in range(z0, z1 + 1):
                for x in range(x0, x1 + 1):
                    cx = self.origin_x + (x + 0.5) * self.cell_size
                    cz = self.origin_z + (z + 0.5) * self.cell_size
                    if abs(cx - fp["x"]) <= hx and abs(cz - fp["z"]) <= hz:
                        self.blocked[z * self.width + x] = 1

    # -- grid addressing --
    def to_cell(self, x: float, z: float) -> Tuple[int, int]:
        return (
            int(math.floor((x - self.origin_x) / self.cell_size)),
            int(math.floor((z - self.origin_z) / self.cell_size)),
        )

    def in_bounds(self, cx: int, cz: int) -> bool:
        return 0 <= cx < self.width and 0 <= cz < self.height

    def is_blocked_cell(self, cx: int, cz: int) -> bool:
        if not self.in_bounds(cx, cz):
            return True
        return self.blocked[cz * self.width + cx] == 1

    def is_walkable(self, x: float, z: float) -> bool:
        cx, cz = self.to_cell(x, z)
        return not self.is_blocked_cell(cx, cz)

    # -- reachability (4-dir BFS: same connectivity as engine flatAStar) --
    def reachable(self, ax: float, az: float, bx: float, bz: float) -> bool:
        start = self.to_cell(ax, az)
        goal = self.to_cell(bx, bz)
        if self.is_blocked_cell(*start) or self.is_blocked_cell(*goal):
            return False
        if start == goal:
            return True
        seen = {start}
        queue = deque([start])
        while queue:
            cx, cz = queue.popleft()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nxt = (cx + dx, cz + dz)
                if nxt == goal:
                    return True
                if nxt in seen or self.is_blocked_cell(*nxt):
                    continue
                seen.add(nxt)
                queue.append(nxt)
        return False

    # -- line of sight (supercover walk; mirrors engine hasLineOfSight) --
    def line_of_sight(self, ax: float, az: float, bx: float, bz: float) -> bool:
        a = self.to_cell(ax, az)
        b = self.to_cell(bx, bz)
        dx = b[0] - a[0]
        dz = b[1] - a[1]
        steps = math.ceil(max(abs(dx), abs(dz)) * 2) or 1
        for i in range(steps + 1):
            t = i / steps
            x = round(a[0] + dx * t)
            z = round(a[1] + dz * t)
            if self.is_blocked_cell(x, z):
                return False
        return True

    # -- support: highest walkable slab top at/under XZ --
    def support_top(self, x: float, z: float) -> Optional[float]:
        best: Optional[float] = None
        for slab in self.slabs:
            if abs(x - slab["x"]) <= slab["hx"] and abs(z - slab["z"]) <= slab["hz"]:
                if best is None or slab["top"] > best:
                    best = slab["top"]
        return best

    # -- clearance: lateral distance to the nearest tall footprint edge --
    def clearance(self, x: float, z: float) -> float:
        best = math.inf
        for fp in self.footprints:
            dx = max(0.0, abs(x - fp["x"]) - fp["hx"])
            dz = max(0.0, abs(z - fp["z"]) - fp["hz"])
            best = min(best, math.hypot(dx, dz))
        return best if best is not math.inf else 1e9


def _seg_intersects_rect(
    ax: float, az: float, bx: float, bz: float, fp: Dict[str, Any], margin: float
) -> bool:
    """XZ segment vs eroded footprint rect (slab-test intersection)."""
    min_x, max_x = fp["x"] - fp["hx"] - margin, fp["x"] + fp["hx"] + margin
    min_z, max_z = fp["z"] - fp["hz"] - margin, fp["z"] + fp["hz"] + margin
    dx, dz = bx - ax, bz - az
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, ax - min_x),
        (dx, max_x - ax),
        (-dz, az - min_z),
        (dz, max_z - az),
    ):
        if abs(p) < 1e-12:
            if q < 0:
                return False
        else:
            r = q / p
            if p < 0:
                t0 = max(t0, r)
            else:
                t1 = min(t1, r)
            if t0 > t1:
                return False
    return True


def camera_occluded(
    cam: Tuple[float, float, float],
    target: Tuple[float, float, float],
    footprints: List[Dict[str, Any]],
    margin: float = AGENT_RADIUS,
) -> Optional[Dict[str, Any]]:
    """First tall footprint whose top rises above the sight line, else None."""
    for fp in footprints:
        if not _seg_intersects_rect(cam[0], cam[2], target[0], target[2], fp, margin):
            continue
        # Sight-line height at the footprint center (parametric approx).
        dx, dz = target[0] - cam[0], target[2] - cam[2]
        length_sq = dx * dx + dz * dz
        t = (
            0.5
            if length_sq < 1e-12
            else max(
                0.0,
                min(
                    1.0, ((fp["x"] - cam[0]) * dx + (fp["z"] - cam[2]) * dz) / length_sq
                ),
            )
        )
        sight_y = cam[1] + (target[1] - cam[1]) * t
        if fp["top"] > sight_y + 0.5:
            return fp
    return None
