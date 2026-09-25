"""
Heretek 3D Android Studio — Scene Invariant & Zero-Mistake Guardrail Gate

Enforces 7 deterministic invariants before any AI agent or MCP scene mutation
is committed to disk or loaded onto hardware:

1. Finite Transforms        — no NaN/Infinity in position, rotation, scale
2. Mobile Draw Budget       — unbatched mesh/model/terrain draws <= 100
3. Collision Non-Penetration— dynamic colliders must not spawn inside fixed ones
4. Entity Identity          — unique, non-empty entity names
5. Component Contract       — shapes/physics/light types/sizes/masses are valid
6. Event Integrity          — events are well-formed, typed, and target existing entities
7. Physics Caps             — linear velocity <= 200 m/s, angular <= 100 rad/s

The canonical schema is the flat scene-store format used by
`harness/scenes/active_scene.json`. Engine-exported scenes (`Scene.toJSON()`
with nested `transform`/`components`) are normalized before validation so the
same gate protects both formats.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

MAX_MOBILE_DRAW_CALLS = 100
MAX_PHYSICS_SPEED = 200.0
MAX_ANGULAR_SPEED = 100.0

SUPPORTED_SHAPES = {"box", "sphere", "cylinder", "capsule", "plane", "torus"}
SUPPORTED_PHYSICS = {"dynamic", "fixed", "none"}
SUPPORTED_LIGHT_TYPES = {"directional", "point", "ambient"}
SUPPORTED_CONDITIONS = {
    "OnStart",
    "EveryFrame",
    "OnTouchTap",
    "OnButtonPress",
    "Timer",
    "TagNear",
}
SUPPORTED_ACTIONS = {
    "Translate",
    "RotateY",
    "ApplyImpulse",
    "SetColor",
    "Destroy",
    "SetScale",
}
MESH_KINDS = {"mesh", "model", "terrain"}


class InvariantViolation:
    def __init__(self, code: str, message: str, entity_name: Optional[str] = None):
        self.code = code
        self.message = message
        self.entity_name = entity_name

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "entity": self.entity_name}


def is_finite_num(v: Any) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return not (math.isnan(v) or math.isinf(v))


def is_vec3(v: Any) -> bool:
    return (
        isinstance(v, (list, tuple))
        and len(v) >= 3
        and all(is_finite_num(x) for x in v[:3])
    )


def _normalize_object(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Accepts both the flat store schema and engine-exported nested schemas."""
    obj: Dict[str, Any] = dict(raw)

    # Engine dump: {"transform": {"position": [...], "rotation": [...], "scale": [...]}}
    transform = obj.get("transform")
    if isinstance(transform, dict):
        if "position" not in obj and isinstance(
            transform.get("position"), (list, tuple)
        ):
            obj["position"] = list(transform["position"])
        if "rotation" not in obj and isinstance(
            transform.get("rotation"), (list, tuple)
        ):
            obj["rotation"] = list(transform["rotation"])[:3]
        if "scale" not in obj and isinstance(transform.get("scale"), (list, tuple)):
            obj["scale"] = list(transform["scale"])

    # Engine dump: components array -> flat fields
    comps = obj.get("components")
    if isinstance(comps, list):
        for comp in comps:
            if not isinstance(comp, dict):
                continue
            ctype = comp.get("type")
            if ctype == "MeshRenderer":
                obj.setdefault("shape", comp.get("shape", "box"))
                obj.setdefault("size", comp.get("size"))
                obj.setdefault("color", comp.get("color"))
            elif ctype == "ModelRenderer":
                obj.setdefault("kind", "model")
                obj.setdefault("modelUrl", comp.get("modelUrl"))
            elif ctype == "RigidBody3D":
                obj.setdefault("physics", comp.get("bodyType", "dynamic"))
                if comp.get("mass") is not None:
                    obj.setdefault("mass", comp.get("mass"))
                if comp.get("linearVelocity") is not None:
                    obj.setdefault("linearVelocity", comp.get("linearVelocity"))
            elif ctype == "Collider3D":
                obj.setdefault("size", comp.get("size"))
            elif ctype == "LightComponent":
                obj.setdefault("kind", "light")
                obj.setdefault("lightType", comp.get("lightType", "directional"))
                obj.setdefault("intensity", comp.get("intensity"))
            elif ctype == "EventSheet":
                obj.setdefault("events", comp.get("events", []))

    return obj


def validate_scene_invariants(
    scene_dict: Dict[str, Any],
) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Validates the scene against all 7 invariants.
    Returns (is_valid, list_of_violation_dicts). Never mutates the input.
    """
    violations: List[InvariantViolation] = []

    if not isinstance(scene_dict, dict):
        return False, [
            {
                "code": "INVALID_ROOT",
                "message": "Scene must be a JSON object",
                "entity": None,
            }
        ]

    raw_objects = scene_dict.get("gameObjects", [])
    if not isinstance(raw_objects, list):
        return False, [
            {
                "code": "INVALID_ROOT",
                "message": "Scene missing 'gameObjects' array",
                "entity": None,
            }
        ]

    objects = [_normalize_object(go) for go in raw_objects if isinstance(go, dict)]
    if len(objects) != len(raw_objects):
        violations.append(
            InvariantViolation(
                "INVALID_ENTITY", "Every gameObject entry must be a JSON object"
            )
        )

    names = set()
    mesh_count = 0
    colliders: List[Dict[str, Any]] = []

    for obj in objects:
        name = obj.get("name")
        if not isinstance(name, str) or not name.strip():
            violations.append(
                InvariantViolation(
                    "MISSING_ENTITY_NAME", "Entity is missing a non-empty name", None
                )
            )
            name = "<unnamed>"
        elif name in names:
            violations.append(
                InvariantViolation(
                    "DUPLICATE_ENTITY_NAME",
                    f"Duplicate entity name detected: '{name}'",
                    name,
                )
            )
        names.add(name)

        # --- Invariant 1: finite transforms -----------------------------------
        pos = obj.get("position")
        if pos is not None and not is_vec3(pos):
            violations.append(
                InvariantViolation(
                    "NON_FINITE_POSITION", f"Invalid position: {pos!r}", name
                )
            )
        rotation = obj.get("rotation")
        if rotation is not None and not is_vec3(rotation):
            violations.append(
                InvariantViolation(
                    "NON_FINITE_ROTATION", f"Invalid rotation: {rotation!r}", name
                )
            )
        scale = obj.get("scale")
        if scale is not None:
            if not is_vec3(scale):
                violations.append(
                    InvariantViolation(
                        "INVALID_SCALE", f"Invalid scale: {scale!r}", name
                    )
                )
            elif any(s <= 0 for s in scale[:3]):
                violations.append(
                    InvariantViolation(
                        "INVALID_SCALE", f"Scale must be positive, got: {scale!r}", name
                    )
                )

        kind = obj.get("kind", "mesh")

        # --- Invariant 5: component contract integrity -------------------------
        if kind == "light":
            light_type = obj.get("lightType", "directional")
            if light_type not in SUPPORTED_LIGHT_TYPES:
                violations.append(
                    InvariantViolation(
                        "INVALID_LIGHT_TYPE",
                        f"Unsupported light type '{light_type}'",
                        name,
                    )
                )
            intensity = obj.get("intensity")
            if intensity is not None and not is_finite_num(intensity):
                violations.append(
                    InvariantViolation(
                        "INVALID_LIGHT_INTENSITY",
                        f"Light intensity must be finite, got {intensity!r}",
                        name,
                    )
                )
        else:
            shape = obj.get("shape", "box")
            if shape not in SUPPORTED_SHAPES:
                violations.append(
                    InvariantViolation(
                        "INVALID_MESH_SHAPE", f"Unsupported mesh shape '{shape}'", name
                    )
                )
            size = obj.get("size")
            if size is not None:
                if not is_vec3(size):
                    violations.append(
                        InvariantViolation(
                            "INVALID_SIZE", f"Invalid size: {size!r}", name
                        )
                    )
                elif any(s <= 0 for s in size[:3]):
                    violations.append(
                        InvariantViolation(
                            "INVALID_SIZE",
                            f"Size must be positive, got: {size!r}",
                            name,
                        )
                    )

        physics = obj.get("physics")
        if physics is not None and physics not in SUPPORTED_PHYSICS:
            violations.append(
                InvariantViolation(
                    "INVALID_PHYSICS_TYPE",
                    f"Unsupported physics type '{physics}'",
                    name,
                )
            )
        mass = obj.get("mass")
        if mass is not None and (not is_finite_num(mass) or mass <= 0):
            violations.append(
                InvariantViolation(
                    "INVALID_MASS", f"Mass must be positive finite, got {mass!r}", name
                )
            )

        # --- Invariant 7: physics velocity caps --------------------------------
        for vel_key, cap in (
            ("linearVelocity", MAX_PHYSICS_SPEED),
            ("velocity", MAX_PHYSICS_SPEED),
            ("angularVelocity", MAX_ANGULAR_SPEED),
        ):
            vel = obj.get(vel_key)
            if vel is None:
                continue
            if not is_vec3(vel):
                violations.append(
                    InvariantViolation(
                        "PHYSICS_SPEED_LIMIT_EXCEEDED",
                        f"{vel_key} must be finite numbers: {vel!r}",
                        name,
                    )
                )
                continue
            if any(abs(v) > cap for v in vel[:3]):
                violations.append(
                    InvariantViolation(
                        "PHYSICS_SPEED_LIMIT_EXCEEDED",
                        f"{vel_key} {vel!r} exceeds cap {cap} for '{name}'",
                        name,
                    )
                )

        # --- Invariant 2: draw budget accounting -------------------------------
        if kind in MESH_KINDS and not obj.get("batched", False):
            mesh_count += 1

        # --- Collider bookkeeping for invariant 3 ------------------------------
        if (
            physics in ("dynamic", "fixed")
            and is_vec3(pos)
            and is_vec3(obj.get("size"))
        ):
            colliders.append(
                {
                    "name": name,
                    "bodyType": physics,
                    "center": tuple(float(p) for p in pos[:3]),
                    "half": tuple(float(s) / 2.0 for s in obj["size"][:3]),
                }
            )

        # --- Invariant 6: event integrity --------------------------------------
        events = obj.get("events")
        if events is not None:
            if not isinstance(events, list):
                violations.append(
                    InvariantViolation(
                        "MALFORMED_EVENT", f"'events' must be a list on '{name}'", name
                    )
                )
            else:
                for ev in events:
                    if not isinstance(ev, dict):
                        violations.append(
                            InvariantViolation(
                                "MALFORMED_EVENT",
                                f"Event on '{name}' is not an object",
                                name,
                            )
                        )
                        continue
                    conds = ev.get("conditions")
                    actions = ev.get("actions")
                    if not isinstance(conds, list) or not conds:
                        violations.append(
                            InvariantViolation(
                                "MALFORMED_EVENT",
                                f"Event '{ev.get('name', '?')}' on '{name}' needs conditions",
                                name,
                            )
                        )
                    else:
                        for cond in conds:
                            ctype = cond.get("type") if isinstance(cond, dict) else None
                            if ctype not in SUPPORTED_CONDITIONS:
                                violations.append(
                                    InvariantViolation(
                                        "INVALID_EVENT_CONDITION",
                                        f"Unsupported condition '{ctype}' in event '{ev.get('name', '?')}' on '{name}'",
                                        name,
                                    )
                                )
                    if not isinstance(actions, list) or not actions:
                        violations.append(
                            InvariantViolation(
                                "MALFORMED_EVENT",
                                f"Event '{ev.get('name', '?')}' on '{name}' needs actions",
                                name,
                            )
                        )
                    else:
                        for act in actions:
                            atype = act.get("type") if isinstance(act, dict) else None
                            if atype not in SUPPORTED_ACTIONS:
                                violations.append(
                                    InvariantViolation(
                                        "INVALID_EVENT_ACTION",
                                        f"Unsupported action '{atype}' in event '{ev.get('name', '?')}' on '{name}'",
                                        name,
                                    )
                                )

    # --- Invariant 6 (cont.): event targets must reference existing entities ---
    for obj in objects:
        events = obj.get("events")
        if not isinstance(events, list):
            continue
        for ev in events:
            if not isinstance(ev, dict):
                continue
            target = ev.get("target")
            if isinstance(target, str) and target and target not in names:
                violations.append(
                    InvariantViolation(
                        "MISSING_EVENT_TARGET",
                        f"Event '{ev.get('name', '?')}' targets unknown entity '{target}'",
                        obj.get("name"),
                    )
                )
            for act in ev.get("actions", []) or []:
                if isinstance(act, dict):
                    act_target = act.get("target")
                    if (
                        isinstance(act_target, str)
                        and act_target
                        and act_target not in names
                    ):
                        violations.append(
                            InvariantViolation(
                                "MISSING_EVENT_TARGET",
                                f"Action '{act.get('type', '?')}' targets unknown entity '{act_target}'",
                                obj.get("name"),
                            )
                        )

    # --- Invariant 2: budget verdict ------------------------------------------
    if mesh_count > MAX_MOBILE_DRAW_CALLS:
        violations.append(
            InvariantViolation(
                "DRAW_CALL_BUDGET_EXCEEDED",
                f"Scene has {mesh_count} unbatched mesh draw calls, exceeding the mobile budget of {MAX_MOBILE_DRAW_CALLS}",
            )
        )

    # --- Invariant 3: spawn non-penetration ------------------------------------
    tolerance = 0.05
    for dynamic in colliders:
        if dynamic["bodyType"] != "dynamic":
            continue
        for fixed in colliders:
            if fixed["bodyType"] != "fixed" or fixed is dynamic:
                continue
            overlap = all(
                abs(dynamic["center"][i] - fixed["center"][i])
                < (dynamic["half"][i] + fixed["half"][i] - tolerance)
                for i in range(3)
            )
            if overlap:
                violations.append(
                    InvariantViolation(
                        "COLLIDER_PENETRATION_AT_SPAWN",
                        f"Dynamic collider '{dynamic['name']}' penetrates fixed collider '{fixed['name']}' at spawn",
                        dynamic["name"],
                    )
                )

    return len(violations) == 0, [v.to_dict() for v in violations]
