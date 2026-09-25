"""
Applies harness action objects to the flat studio scene schema.

Action vocabulary mirrors the studio's `applyActionsToScene`
(`app/src/services/AiHarnessService.ts`) and the MCP tools:
    - spawn   {name, shape, size, position, color, physics, mass}
    - light   {name, lightType, color, intensity, position}
    - modify  {target, position?, color?, size?, physics?, mass?, lightType?, intensity?}
    - delete  {target}
    - event   {target, event_name, condition, condition_params, action, params}

`apply_actions` is pure: it deep-copies the scene and returns
`(new_scene, ApplyResult)`. Malformed actions become explicit outcomes
(`invalid` / `target-missing` / `error`) instead of raising, so the loop can
feed them straight back to the model as repair input.
"""

import copy
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from harness.validation.scene_invariants import (
    SUPPORTED_ACTIONS,
    SUPPORTED_CONDITIONS,
    SUPPORTED_LIGHT_TYPES,
    SUPPORTED_PHYSICS,
    SUPPORTED_SHAPES,
)

DEFAULT_SPAWN_SIZE = [1.5, 1.5, 1.5]
DEFAULT_SPAWN_POSITION = [0.0, 2.0, 0.0]
DEFAULT_SPAWN_COLOR = "#3b82f6"
DEFAULT_LIGHT_POSITION = [5.0, 10.0, 5.0]
DEFAULT_LIGHT_INTENSITY = 2.0

MODIFY_FIELDS = (
    "position",
    "color",
    "size",
    "physics",
    "mass",
    "lightType",
    "intensity",
)


@dataclass
class ApplyResult:
    """Per-action outcomes plus aggregate counters (studio-compatible shape)."""

    applied: int = 0
    target_missing: int = 0
    invalid: int = 0
    failed: int = 0
    outcomes: List[Dict[str, Any]] = field(default_factory=list)
    applied_descriptions: List[str] = field(default_factory=list)

    @property
    def failures(self) -> int:
        return self.target_missing + self.invalid + self.failed

    def as_dict(self) -> Dict[str, Any]:
        return {
            "applied": self.applied,
            "targetMissing": self.target_missing,
            "invalid": self.invalid,
            "failed": self.failed,
            "outcomes": self.outcomes,
            "appliedDescriptions": self.applied_descriptions,
        }


def _is_finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _vec3(value: Any) -> Optional[List[float]]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    if not all(_is_finite_number(v) for v in value):
        return None
    return [float(v) for v in value]


def _is_color(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("#") and len(value) in (4, 7)


def _find(scene: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    for obj in scene.get("gameObjects", []):
        if isinstance(obj, dict) and obj.get("name") == name:
            return obj
    return None


def _names(scene: Dict[str, Any]) -> set:
    return {
        obj.get("name") for obj in scene.get("gameObjects", []) if isinstance(obj, dict)
    }


def _apply_spawn(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    name = action.get("name")
    if not isinstance(name, str) or not name.strip():
        return _outcome(
            result, index, "spawn", "invalid", "spawn requires a non-empty 'name'"
        )
    name = name.strip()
    if name in _names(scene):
        return _outcome(
            result,
            index,
            "spawn",
            "invalid",
            f"spawn rejected — an object named '{name}' already exists",
        )

    shape = action.get("shape", "box")
    if shape not in SUPPORTED_SHAPES:
        return _outcome(
            result,
            index,
            "spawn",
            "invalid",
            f"unsupported shape '{shape}' (allowed: {sorted(SUPPORTED_SHAPES)})",
        )

    size = _vec3(action.get("size", DEFAULT_SPAWN_SIZE))
    if size is None:
        return _outcome(
            result, index, "spawn", "invalid", "spawn 'size' must be 3 finite numbers"
        )
    position = _vec3(action.get("position", DEFAULT_SPAWN_POSITION))
    if position is None:
        return _outcome(
            result,
            index,
            "spawn",
            "invalid",
            "spawn 'position' must be 3 finite numbers",
        )

    color = action.get("color", DEFAULT_SPAWN_COLOR)
    if not _is_color(color):
        return _outcome(
            result,
            index,
            "spawn",
            "invalid",
            f"invalid color '{color}' (expected #rgb or #rrggbb)",
        )

    physics = action.get("physics", "none")
    if physics not in SUPPORTED_PHYSICS:
        return _outcome(
            result,
            index,
            "spawn",
            "invalid",
            f"unsupported physics '{physics}' (allowed: {sorted(SUPPORTED_PHYSICS)})",
        )

    obj: Dict[str, Any] = {
        "name": name,
        "shape": shape,
        "size": size,
        "position": position,
        "color": color,
        "physics": physics,
    }
    if physics == "dynamic":
        mass = action.get("mass", 1.0)
        if not _is_finite_number(mass) or mass <= 0:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"dynamic spawn needs a positive mass (got {mass!r})",
            )
        obj["mass"] = float(mass)

    scene.setdefault("gameObjects", []).append(obj)
    _outcome(
        result,
        index,
        "spawn",
        "applied",
        f"Spawned {name} ({shape}) at {position}",
        name,
    )


def _apply_light(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    name = action.get("name")
    if not isinstance(name, str) or not name.strip():
        return _outcome(
            result, index, "light", "invalid", "light requires a non-empty 'name'"
        )
    name = name.strip()
    if name in _names(scene):
        return _outcome(
            result,
            index,
            "light",
            "invalid",
            f"light rejected — an object named '{name}' already exists",
        )

    light_type = action.get("lightType", "directional")
    if light_type not in SUPPORTED_LIGHT_TYPES:
        return _outcome(
            result,
            index,
            "light",
            "invalid",
            f"unsupported lightType '{light_type}' (allowed: {sorted(SUPPORTED_LIGHT_TYPES)})",
        )
    color = action.get("color", "#ffffff")
    if not _is_color(color):
        return _outcome(
            result,
            index,
            "light",
            "invalid",
            f"invalid color '{color}' (expected #rgb or #rrggbb)",
        )
    intensity = action.get("intensity", DEFAULT_LIGHT_INTENSITY)
    if not _is_finite_number(intensity) or intensity < 0:
        return _outcome(
            result,
            index,
            "light",
            "invalid",
            f"intensity must be a non-negative number (got {intensity!r})",
        )
    position = _vec3(action.get("position", DEFAULT_LIGHT_POSITION))
    if position is None:
        return _outcome(
            result,
            index,
            "light",
            "invalid",
            "light 'position' must be 3 finite numbers",
        )

    scene.setdefault("gameObjects", []).append(
        {
            "kind": "light",
            "name": name,
            "lightType": light_type,
            "color": color,
            "intensity": float(intensity),
            "position": position,
        }
    )
    _outcome(
        result,
        index,
        "light",
        "applied",
        f"Added {light_type} light '{name}' (intensity {intensity})",
        name,
    )


def _apply_modify(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    target = action.get("target")
    if not isinstance(target, str) or not target:
        return _outcome(
            result, index, "modify", "invalid", "modify requires a 'target' name"
        )
    obj = _find(scene, target)
    if obj is None:
        return _outcome(
            result,
            index,
            "modify",
            "target-missing",
            f"modify skipped — no scene object named '{target}'",
            target,
        )

    changed: List[str] = []
    for field_name in MODIFY_FIELDS:
        if field_name not in action:
            continue
        value = action[field_name]
        if field_name in ("position", "size"):
            vec = _vec3(value)
            if vec is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"modify '{field_name}' must be 3 finite numbers",
                )
            obj[field_name] = vec
        elif field_name == "color":
            if not _is_color(value):
                return _outcome(
                    result, index, "modify", "invalid", f"invalid color '{value}'"
                )
            obj["color"] = value
        elif field_name == "physics":
            if value not in SUPPORTED_PHYSICS:
                return _outcome(
                    result, index, "modify", "invalid", f"unsupported physics '{value}'"
                )
            obj["physics"] = value
        elif field_name == "mass":
            if not _is_finite_number(value) or value <= 0:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"mass must be positive (got {value!r})",
                )
            obj["mass"] = float(value)
        elif field_name == "lightType":
            if value not in SUPPORTED_LIGHT_TYPES:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"unsupported lightType '{value}'",
                )
            obj["lightType"] = value
        elif field_name == "intensity":
            if not _is_finite_number(value) or value < 0:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"intensity must be non-negative (got {value!r})",
                )
            obj["intensity"] = float(value)
        changed.append(field_name)

    if not changed:
        return _outcome(
            result,
            index,
            "modify",
            "invalid",
            f"modify on '{target}' had no supported fields (allowed: {list(MODIFY_FIELDS)})",
        )
    _outcome(
        result,
        index,
        "modify",
        "applied",
        f"Modified {target}: {', '.join(changed)}",
        target,
    )


def _apply_delete(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    target = action.get("target")
    if not isinstance(target, str) or not target:
        return _outcome(
            result, index, "delete", "invalid", "delete requires a 'target' name"
        )
    obj = _find(scene, target)
    if obj is None:
        return _outcome(
            result,
            index,
            "delete",
            "target-missing",
            f"delete skipped — no scene object named '{target}'",
            target,
        )
    scene["gameObjects"] = [go for go in scene.get("gameObjects", []) if go is not obj]
    _outcome(result, index, "delete", "applied", f"Removed {target}", target)


def _apply_event(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    target = action.get("target")
    if not isinstance(target, str) or not target:
        return _outcome(
            result, index, "event", "invalid", "event requires a 'target' name"
        )
    obj = _find(scene, target)
    if obj is None:
        return _outcome(
            result,
            index,
            "event",
            "target-missing",
            f"event skipped — no scene object named '{target}'",
            target,
        )

    event_name = action.get("event_name") or f"{target}_event"
    condition = action.get("condition")
    if condition not in SUPPORTED_CONDITIONS:
        return _outcome(
            result,
            index,
            "event",
            "invalid",
            f"unsupported condition '{condition}' (allowed: {sorted(SUPPORTED_CONDITIONS)})",
        )
    event_action = action.get("action")
    if event_action not in SUPPORTED_ACTIONS:
        return _outcome(
            result,
            index,
            "event",
            "invalid",
            f"unsupported action '{event_action}' (allowed: {sorted(SUPPORTED_ACTIONS)})",
        )
    condition_params = action.get("condition_params") or {}
    params = action.get("params") or {}
    if not isinstance(condition_params, dict) or not isinstance(params, dict):
        return _outcome(
            result, index, "event", "invalid", "event params must be JSON objects"
        )

    event = {
        "name": str(event_name),
        "conditions": [{"type": condition, "params": condition_params}],
        "actions": [{"type": event_action, "params": params}],
    }
    obj.setdefault("events", []).append(event)
    _outcome(
        result,
        index,
        "event",
        "applied",
        f"Wired {condition} -> {event_action} on {target}",
        target,
    )


def _outcome(
    result: ApplyResult,
    index: int,
    action_type: str,
    status: str,
    detail: str,
    target: Optional[str] = None,
) -> None:
    outcome: Dict[str, Any] = {
        "index": index,
        "type": action_type,
        "status": status,
        "detail": detail,
    }
    if target is not None:
        outcome["target"] = target
    result.outcomes.append(outcome)
    if status == "applied":
        result.applied += 1
        result.applied_descriptions.append(detail)
    elif status == "target-missing":
        result.target_missing += 1
    elif status == "invalid":
        result.invalid += 1
    else:
        result.failed += 1


_HANDLERS = {
    "spawn": _apply_spawn,
    "light": _apply_light,
    "modify": _apply_modify,
    "delete": _apply_delete,
    "event": _apply_event,
}


def apply_actions(
    scene: Dict[str, Any], actions: List[Any]
) -> Tuple[Dict[str, Any], ApplyResult]:
    """Apply actions to a copy of `scene`; return (new_scene, ApplyResult)."""
    working = copy.deepcopy(scene)
    working.setdefault("gameObjects", [])
    result = ApplyResult()

    for index, action in enumerate(actions or []):
        if not isinstance(action, dict) or not action.get("type"):
            _outcome(
                result,
                index,
                "malformed",
                "invalid",
                f"Action #{index} is not a valid action object",
            )
            continue
        action_type = str(action.get("type"))
        handler = _HANDLERS.get(action_type)
        if handler is None:
            _outcome(
                result,
                index,
                action_type,
                "invalid",
                f"Unknown action type '{action_type}' (allowed: {sorted(_HANDLERS)})",
            )
            continue
        handler(working, action, result, index)

    return working, result
