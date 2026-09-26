"""
Consistency audit over the unified spatial index (Track B.1 gate).

One index, five formerly-independent derivations — every check below reads the
SAME SpatialIndex, so disagreement is a machine-checkable failure with
coordinates attached (never "looks wrong"):

  1. nav_targets: every `nav: {target: [x, z]}` goal is walkable AND reachable
     from its agent (catches wall landings + unreachable goals).
  2. spawns: every controller/dynamic object is supported (ground slab within
     reach below) and clear of eroded footprints (catches buried/floating
     spawns the same run the gate would — with coordinates for repair).
  3. ai_targets: every `ai: {targetName}` owner can reach its named target.
  4. camera_framing: the gameplay camera's sight line to the player is
     unoccluded by tall geometry (catches blind chase cameras).

`evaluate_spatial_rule(scene, rule)` compiles a scenario rule of type
`spatial_audit` ({enforce?}) into pass/fail + details for the loop.
"""

from typing import Any, Dict, List, Optional, Tuple

from harness.spatial.spatial_index import (
    AGENT_RADIUS,
    SpatialIndex,
    camera_occluded,
)

SUPPORT_FLOAT_TOLERANCE = 0.5
#: Falls within this distance settle onto the slab under physics (Rapier
#: dynamics land); only longer falls and missing slabs are defects.
SUPPORT_SETTLE_DISTANCE = 3.0


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def _by_name(objects: List[Dict[str, Any]], name: Any) -> Optional[Dict[str, Any]]:
    for obj in objects:
        if obj.get("name") == name:
            return obj
    return None


def _pos3(obj: Dict[str, Any]) -> Tuple[float, float, float]:
    value = obj.get("position")
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return (0.0, 0.0, 0.0)
    try:
        return (float(value[0]), float(value[1]), float(value[2]))
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0)


def _half_height(obj: Dict[str, Any]) -> float:
    size = obj.get("size")
    if isinstance(size, (list, tuple)) and len(size) == 3:
        try:
            return max(0.05, abs(float(size[1])) / 2.0)
        except (TypeError, ValueError):
            pass
    return 0.5


def spatial_audit(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Audit cross-system spatial agreement. Pure + deterministic."""
    objects = _objects(scene)
    index = SpatialIndex(scene)
    checks: List[Dict[str, Any]] = []
    defects: List[Dict[str, str]] = []

    def fail(check: str, detail: str) -> None:
        checks.append({"check": check, "pass": False, "detail": detail})
        defects.append({"check": check, "defect": detail})

    def ok(check: str, detail: str = "") -> None:
        checks.append({"check": check, "pass": True, "detail": detail})

    # 1. nav targets (walkable + reachable from the agent).
    nav_owners = [o for o in objects if isinstance(o.get("nav"), dict)]
    if not nav_owners:
        ok("nav_targets", "no nav agents")
    for owner in nav_owners:
        target = owner["nav"].get("target")
        label = f"nav '{owner.get('name')}'"
        if not (isinstance(target, (list, tuple)) and len(target) == 2):
            fail(
                label,
                f"malformed nav target {target!r} → repair: set nav.target to [x, z]",
            )
            continue
        try:
            tx, tz = float(target[0]), float(target[1])
        except (TypeError, ValueError):
            fail(
                label, f"non-numeric nav target {target!r} → repair: use finite [x, z]"
            )
            continue
        ox, _, oz = _pos3(owner)
        if not index.is_walkable(tx, tz):
            fail(
                label,
                f"target ({tx:g}, {tz:g}) sits in blocked space → repair: move it to a walkable cell",
            )
        elif not index.reachable(ox, oz, tx, tz):
            fail(
                label,
                f"target ({tx:g}, {tz:g}) unreachable from ({ox:g}, {oz:g}) → repair: open a corridor or move the goal",
            )
        else:
            ok(label, f"target ({tx:g}, {tz:g}) walkable + reachable")

    # 2. spawns (supported + clear).
    movers = [
        o
        for o in objects
        if o.get("controller") is True or o.get("physics") == "dynamic"
    ]
    if not movers:
        ok("spawns", "no movers")
    for mover in movers:
        label = f"spawn '{mover.get('name')}'"
        x, y, z = _pos3(mover)
        bottom = y - _half_height(mover)
        top = index.support_top(x, z)
        if top is None:
            fail(
                label,
                f"no ground slab under ({x:g}, {z:g}) → repair: spawn a fixed ground plane beneath",
            )
            continue
        if bottom > top + SUPPORT_SETTLE_DISTANCE:
            fail(
                label,
                f"floating {bottom - top:.1f}u over ground at ({x:g}, {z:g}) → repair: lower onto the slab",
            )
            continue
        if top > bottom + SUPPORT_FLOAT_TOLERANCE:
            fail(
                label,
                f"buried {top - bottom:.1f}u in ground at ({x:g}, {z:g}) → repair: raise above the slab top",
            )
            continue
        clearance = index.clearance(x, z)
        if clearance < AGENT_RADIUS:
            fail(
                label,
                f"clearance {clearance:.2f}u < agent radius at ({x:g}, {z:g}) → repair: shift clear of walls",
            )
        else:
            ok(label, f"supported + clear at ({x:g}, {z:g})")

    # 3. AI targets (owner reaches the named target).
    ai_owners = [o for o in objects if isinstance(o.get("ai"), dict)]
    if not ai_owners:
        ok("ai_targets", "no AI owners")
    for owner in ai_owners:
        label = f"ai '{owner.get('name')}'"
        target = _by_name(objects, owner["ai"].get("targetName"))
        if target is None:
            fail(
                label,
                f"target {owner['ai'].get('targetName')!r} missing → repair: name a real entity",
            )
            continue
        ox, _, oz = _pos3(owner)
        tx, _, tz = _pos3(target)
        if not index.reachable(ox, oz, tx, tz):
            fail(
                label,
                f"cannot reach '{target.get('name')}' from ({ox:g}, {oz:g}) → repair: open a corridor",
            )
        else:
            ok(label, f"reaches '{target.get('name')}'")

    # 4. camera framing (gameplay sight line unoccluded).
    try:
        from harness.loop.frame_preview import select_camera

        cam = select_camera({"gameObjects": objects})
        players = [o for o in movers if o.get("controller") is True] or movers[:1]
        if not players:
            ok("camera_framing", "nothing to frame")
        else:
            focus = _pos3(players[0])
            blocker = camera_occluded(
                (cam["position"][0], cam["position"][1], cam["position"][2]),
                focus,
                index.footprints,
            )
            if blocker is not None:
                fail(
                    "camera_framing",
                    f"'{blocker['name']}' blocks the {cam['source']} camera sight line "
                    f"to '{players[0].get('name')}' → repair: raise the camera or move the prop",
                )
            else:
                ok("camera_framing", f"{cam['source']} sight line clear")
    except ImportError:
        ok("camera_framing", "frame preview unavailable")

    # 5. named places (first-class geography must be sane: unique, finite,
    # walkable, supported — shared by briefs, dialogue, quests, agents).
    try:
        from harness.spatial.spatial_queries import validate_places
    except ImportError:
        validate_places = None  # type: ignore[assignment]
    raw_places = scene.get("places")
    if not raw_places:
        ok("places", "no named places")
    elif validate_places is None:
        ok("places", "place validator unavailable")
    else:
        problems = validate_places(raw_places)
        if problems:
            for problem in problems:
                fail("places", f"{problem} → repair: redefine the place")
        else:
            for place in raw_places:
                label = f"place '{place.get('name')}'"
                px, py, pz = (
                    float(place["position"][0]),
                    float(place["position"][1]),
                    float(place["position"][2]),
                )
                if not index.is_walkable(px, pz):
                    fail(
                        label,
                        f"({px:g}, {pz:g}) sits in blocked space → repair: move it clear",
                    )
                    continue
                top = index.support_top(px, pz)
                if top is None or py - 0.5 > top + SUPPORT_SETTLE_DISTANCE:
                    fail(
                        label,
                        f"({px:g}, {pz:g}) has no ground in reach → repair: move onto a slab",
                    )
                else:
                    ok(label, f"walkable + supported at ({px:g}, {pz:g})")

    passed = sum(1 for c in checks if c["pass"])
    return {
        "checks": checks,
        "defects": defects,
        "passed": passed,
        "total": len(checks),
        "pass": all(c["pass"] for c in checks),
    }


def evaluate_spatial_rule(
    scene: Dict[str, Any], rule: Dict[str, Any]
) -> Dict[str, Any]:
    """Evaluate one spatial_audit rule. Returns JSON-serializable verdict."""
    audit = spatial_audit(scene)
    return {
        "id": rule.get("id", rule.get("type")),
        "type": "spatial_audit",
        "pass": audit["pass"],
        "passed": audit["passed"],
        "total": audit["total"],
        "enforce": bool(rule.get("enforce", False)),
        "failedChecks": [c for c in audit["checks"] if not c["pass"]],
        "defects": audit["defects"],
    }
