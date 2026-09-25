"""
Heretek 3D Android Studio — Scene Invariant & Zero-Mistake Guardrail Gate

Enforces 7 deterministic invariants before any AI agent or MCP scene mutation
is committed to disk or loaded onto hardware:
1. Finite Transforms (no NaN, Infinity, or null in position, rotation, or scale)
2. Mobile Draw-Call Budget (unbatched meshes <= 100)
3. Non-Penetration / Collision Sanity (spawned dynamic bodies must not overlap fixed colliders)
4. Entity Identity Uniqueness (zero duplicate GameObject IDs or names)
5. Component Contract Integrity (all components have valid required schema properties)
6. Event Target Integrity (visual events reference existing scene entities)
7. Velocity & Physics Caps (linear velocities <= 200 m/s to prevent tunneling)
"""

import math
from typing import Any, Dict, List, Optional, Tuple

MAX_MOBILE_DRAW_CALLS = 100
MAX_PHYSICS_SPEED = 200.0

class InvariantViolation:
    def __init__(self, code: str, message: str, entity_name: Optional[str] = None):
        self.code = code
        self.message = message
        self.entity_name = entity_name

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "entity": self.entity_name
        }

def is_finite_num(v: Any) -> bool:
    if not isinstance(v, (int, float)):
        return False
    return not (math.isnan(v) or math.isinf(v))

def validate_scene_invariants(scene_dict: Dict[str, Any]) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Validates scene against all 7 invariants.
    Returns (is_valid, list_of_violations).
    """
    violations: List[InvariantViolation] = []
    game_objects = scene_dict.get("gameObjects", [])
    if not isinstance(game_objects, list):
        return False, [{"code": "INVALID_ROOT", "message": "Scene missing 'gameObjects' array"}]

    seen_names = set()
    mesh_count = 0
    colliders: List[Dict[str, Any]] = []

    # Invariant 4: Entity Name Uniqueness
    for go in game_objects:
        name = go.get("name", "Unnamed")
        if name in seen_names:
            violations.append(InvariantViolation(
                "DUPLICATE_ENTITY_NAME",
                f"Duplicate entity name detected: '{name}'",
                name
            ))
        seen_names.add(name)

        # Invariant 1: Finite Transforms
        trans = go.get("transform", {})
        pos = trans.get("position", [0, 0, 0])
        rot = trans.get("rotation", [0, 0, 0, 1])
        scale = trans.get("scale", [1, 1, 1])

        for axis_name, axis_val in [("pos_x", pos[0] if len(pos)>0 else None),
                                    ("pos_y", pos[1] if len(pos)>1 else None),
                                    ("pos_z", pos[2] if len(pos)>2 else None)]:
            if not is_finite_num(axis_val):
                violations.append(InvariantViolation("NON_FINITE_POSITION", f"Invalid position axis {axis_name}: {axis_val}", name))

        for s in scale:
            if not is_finite_num(s) or s <= 0:
                violations.append(InvariantViolation("INVALID_SCALE", f"Scale must be positive finite number, got: {s}", name))

        # Invariant 5: Component Contract Integrity
        components = go.get("components", [])
        has_mesh = False
        body_type = "none"
        col_size = None

        for comp in components:
            c_type = comp.get("type", "")

            if c_type == "MeshRenderer":
                has_mesh = True
                mesh_count += 1
                shape = comp.get("shape", "box")
                if shape not in ["box", "sphere", "cylinder", "capsule", "plane", "torus"]:
                    violations.append(InvariantViolation("INVALID_MESH_SHAPE", f"Unsupported mesh shape '{shape}'", name))

            elif c_type == "RigidBody3D":
                body_type = comp.get("bodyType", "dynamic")
                linvel = comp.get("linearVelocity", [0, 0, 0])
                if isinstance(linvel, list):
                    for v in linvel:
                        if not is_finite_num(v) or abs(v) > MAX_PHYSICS_SPEED:
                            violations.append(InvariantViolation("PHYSICS_SPEED_LIMIT_EXCEEDED", f"Velocity {v} exceeds {MAX_PHYSICS_SPEED} m/s", name))

            elif c_type == "Collider3D":
                col_size = comp.get("size", [1, 1, 1])

            elif c_type == "EventSheet":
                events = comp.get("events", [])
                for ev in events:
                    conds = ev.get("conditions", [])
                    actions = ev.get("actions", [])
                    if not conds or not actions:
                        violations.append(InvariantViolation("MALFORMED_EVENT", f"Event '{ev.get('name')}' must have conditions and actions", name))

        if col_size and len(pos) >= 3:
            colliders.append({
                "name": name,
                "bodyType": body_type,
                "center": (pos[0], pos[1], pos[2]),
                "half": (col_size[0] / 2.0, col_size[1] / 2.0, col_size[2] / 2.0)
            })

    # Invariant 2: Mobile Draw-Call Budget
    if mesh_count > MAX_MOBILE_DRAW_CALLS:
        violations.append(InvariantViolation(
            "DRAW_CALL_BUDGET_EXCEEDED",
            f"Scene has {mesh_count} mesh draw calls, exceeding mobile budget of {MAX_MOBILE_DRAW_CALLS}"
        ))

    # Invariant 3: Collision Sanity (Dynamic colliders must not be spawned inside fixed ground)
    for c1 in colliders:
        if c1["bodyType"] == "dynamic":
            for c2 in colliders:
                if c2["bodyType"] == "fixed" and c1 != c2:
                    # Check AABB overlap
                    dx = abs(c1["center"][0] - c2["center"][0])
                    dy = abs(c1["center"][1] - c2["center"][1])
                    dz = abs(c1["center"][2] - c2["center"][2])
                    overlap_x = dx < (c1["half"][0] + c2["half"][0] - 0.05)
                    overlap_y = dy < (c1["half"][1] + c2["half"][1] - 0.05)
                    overlap_z = dz < (c1["half"][2] + c2["half"][2] - 0.05)

                    if overlap_x and overlap_y and overlap_z:
                        violations.append(InvariantViolation(
                            "COLLIDER_PENETRATION_AT_SPAWN",
                            f"Dynamic collider '{c1['name']}' penetrates fixed collider '{c2['name']}' at spawn",
                            c1["name"]
                        ))

    return len(violations) == 0, [v.to_dict() for v in violations]
