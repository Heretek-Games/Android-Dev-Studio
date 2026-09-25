"""
Prompt builders for the autonomous iterate-until-green loop.

The generation prompt teaches the model the exact action vocabulary (shared with
the studio's AI Harness) and the flat scene schema; the repair prompt hands back
the precise QA failures, the current scene, and the telemetry so the model can
apply minimal corrective actions.
"""

from typing import Any, Dict, List

# Rule type -> human-readable line used in prompts and run logs.
RULE_DESCRIPTIONS = {
    "entity_exists": lambda r: f"an object named '{r.get('target')}' must exist",
    "entity_component": lambda r: (
        f"'{r.get('target')}' must have component {r.get('component')}"
    ),
    "event_attached": lambda r: f"'{r.get('target')}' must have an EventSheet event",
    "object_count": lambda r: (
        f"the scene must contain exactly {r.get('count')} objects"
    ),
    "transform_changes": lambda r: (
        f"'{r.get('target')}' must move/rotate during the run"
    ),
    "transform_bounds": lambda r: (
        f"'{r.get('target')}' must stay within bounds {r.get('bounds')}"
    ),
    "distance_traveled": lambda r: (
        f"'{r.get('target')}' must travel at least {r.get('minDistance')} units"
    ),
    "speed_min": lambda r: (
        f"'{r.get('target')}' must reach speed >= {r.get('minSpeed')}"
    ),
    "no_nan_transforms": lambda r: "no transform may become NaN/Infinity",
    "draw_call_budget": lambda r: (
        f"draw calls must stay <= {r.get('maxDrawCalls', 100)}"
    ),
    "fps_min": lambda r: f"simulated FPS must stay >= {r.get('minFps', 30)}",
}


def format_rule(rule: Dict[str, Any]) -> str:
    formatter = RULE_DESCRIPTIONS.get(str(rule.get("type")))
    described = formatter(rule) if formatter else f"custom rule {rule}"
    return f"- [{rule.get('id', rule.get('type'))}] {described}"


def format_rules(rules: List[Dict[str, Any]]) -> str:
    if not rules:
        return "(no acceptance rules supplied)"
    return "\n".join(format_rule(rule) for rule in rules)


ACTION_SCHEMA = """Action vocabulary (a JSON array named "actions"):
  - {"type": "spawn", "name": "...", "shape": "box"|"sphere"|"cylinder"|"capsule"|"plane"|"torus",
     "size": [x,y,z], "position": [x,y,z], "color": "#rrggbb", "physics": "dynamic"|"fixed"|"none", "mass": 1.0,
     "vehicle": {"throttle": 1.0, "steering": 0.0} (optional: adds a VehicleController)}
  - {"type": "light", "name": "...", "lightType": "directional"|"point"|"ambient",
     "color": "#rrggbb", "intensity": 2.0, "position": [x,y,z]}
  - {"type": "modify", "target": "...", "position": [x,y,z], "color": "#rrggbb",
     "size": [x,y,z], "physics": "...", "mass": 1.0, "lightType": "...", "intensity": 1.0,
     "vehicle": {"throttle": 1.0} (optional: adds/replaces the VehicleController)}
  - {"type": "delete", "target": "..."}
  - {"type": "event", "target": "...", "event_name": "...",
     "condition": "OnStart"|"EveryFrame"|"OnTouchTap"|"OnButtonPress"|"Timer"|"TagNear",
     "condition_params": {"name": "...", "interval": 0.5},
     "action": "Translate"|"RotateY"|"ApplyImpulse"|"SetColor"|"Destroy"|"SetScale",
     "params": {"speed": 1.0} or {"degrees": 20} or {"x":0,"y":0,"z":0} or {"color": "#rrggbb"}}

How acceptance rules map onto the schema (the QA runner checks these exact components):
  - "RigidBody3D"/"Collider3D" component -> the spawn has "physics": "dynamic" (or "fixed")
  - "MobileController" component -> the spawn has "controller": true
  - "VehicleController" component -> the spawn (or a "modify") has "vehicle": {"throttle": 1.0}
  - "EventSheet" / event_attached rules -> emit an "event" action targeting that object
  - "LightComponent" -> emit a "light" action
  - object_count rules count every entry in gameObjects (lights included)

Constraints enforced by the scene invariant gate (violations are rejected):
  - unique, non-empty object names; finite transforms; positive mass on dynamic bodies
  - <= 100 unbatched draw calls per scene (prefer few objects; instanced foliage is not available here)
  - dynamic bodies must not spawn intersecting fixed geometry
"""

OUTPUT_FORMAT = """Respond with a single JSON object and nothing else:
{"summary": "<one sentence>", "actions": [ ... ]}
Do not wrap it in markdown fences."""


def generation_messages(
    goal: str,
    rules: List[Dict[str, Any]],
    seed_objects: List[Dict[str, Any]] | None = None,
) -> List[Dict[str, str]]:
    """First-iteration prompt: build the whole scene from the goal + rules."""
    seed_note = ""
    if seed_objects:
        seed_note = (
            "\nA base scene already exists; keep its objects and ADD to them with spawn/event actions:\n"
            f"{seed_objects}\n"
        )
    system = (
        "You are the autonomous world builder for Heretek 3D Android Studio, a mobile game engine.\n"
        "You design complete, playable scenes and emit them as machine-applicable actions.\n\n"
        f"{ACTION_SCHEMA}\n"
        f"{OUTPUT_FORMAT}"
    )
    user = (
        f"Build a playable 3D scene for this goal:\n{goal}\n\n"
        "The scene must satisfy ALL of these acceptance rules (QA will verify each one):\n"
        f"{format_rules(rules)}\n"
        f"{seed_note}\n"
        "Entity names referenced by the rules MUST match exactly. Include a ground plane, "
        "the player/actor, and all props required by the rules. Keep the scene small enough "
        "to stay within the 100 draw-call mobile budget."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def repair_messages(
    goal: str,
    rules: List[Dict[str, Any]],
    scene: Dict[str, Any],
    failed_rules: List[Dict[str, Any]],
    metrics: Dict[str, Any],
    iteration: int,
    vision_notes: List[str] | None = None,
) -> List[Dict[str, str]]:
    """Repair prompt: minimal corrective actions for the observed failures."""
    import json

    system = (
        "You are the autonomous repair engineer for Heretek 3D Android Studio.\n"
        "A generated scene failed QA. Emit ONLY the corrective actions (a patch) that fix the "
        "failing rules without breaking passing ones.\n\n"
        f"{ACTION_SCHEMA}\n"
        f"{OUTPUT_FORMAT}"
    )

    failure_lines = []
    for rule in failed_rules:
        detail = rule.get("detail") or "(no detail)"
        failure_lines.append(
            f"- [{rule.get('id')}] {format_rule(rule)} -- observed: {detail}"
        )
    failures = (
        "\n".join(failure_lines) if failure_lines else "- (no rule details captured)"
    )

    vision_note = ""
    if vision_notes:
        vision_note = "\nVisual/layout critique of the current scene:\n" + "\n".join(
            f"- {note}" for note in vision_notes
        )

    user = (
        f"Goal:\n{goal}\n\n"
        f"Iteration {iteration} QA failures:\n{failures}\n\n"
        f"Telemetry: {json.dumps(metrics)}\n"
        f"{vision_note}\n"
        "Current scene (JSON):\n"
        f"{json.dumps(scene, separators=(',', ':'))}\n\n"
        "Acceptance rules (all must eventually pass):\n"
        f"{format_rules(rules)}\n\n"
        "Patch rules: do not delete entities required by the rules; do not duplicate names; "
        "use 'modify' to adjust existing objects instead of re-spawning them. "
        'Return the patch as {"summary": ..., "actions": [...]}.'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
