"""
Applies harness action objects to the flat studio scene schema.

Action vocabulary mirrors the studio's `applyActionsToScene`
(`app/src/services/AiHarnessService.ts`) and the MCP tools:
    - spawn   {name, shape, size, position, color, physics, mass}
    - light   {name, lightType, color, intensity, position}
    - modify  {target, position?, color?, size?, physics?, mass?, lightType?, intensity?}
    - delete  {target}
    - event   {target, event_name, condition, condition_params, action, params}
    - game    {config} — scene-level GameRuntime quest/combat config (waves/build)
    - dialogue {tree} — scene-level DialogueTree graph (id/startNodeId/nodes)
    - prefab  {prefab} — registers a reusable template (id/name/base/template/overrides);
      spawn with "prefab": "<id>" instantiates it (explicit spawn fields win)

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
from harness.prefabs.prefabs import resolve_prefab, validate_prefab

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
    "controller",
    "vehicle",
    "streamer",
    "biome",
    "weapon",
    "health",
    "ai",
    "elemental",
    "cel",
    "behaviors",
)


def _validate_wheel(value: Any) -> Optional[Dict[str, Any]]:
    """One wheel spec: offset is required, everything else has engine defaults."""
    if not isinstance(value, dict):
        return None
    offset = _vec3(value.get("offset"))
    if offset is None:
        return None
    wheel: Dict[str, Any] = {"offset": offset}
    if "radius" in value:
        if not _is_finite_number(value["radius"]) or value["radius"] <= 0:
            return None
        wheel["radius"] = float(value["radius"])
    for flag in ("driven", "steered"):
        if flag in value:
            if not isinstance(value[flag], bool):
                return None
            wheel[flag] = value[flag]
    for nested in ("suspension", "friction"):
        if nested in value:
            if not isinstance(value[nested], dict):
                return None
            wheel[nested] = dict(value[nested])
    return wheel


def _validate_vehicle(value: Any) -> Optional[Dict[str, Any]]:
    """Vehicle configs pass straight to the QA runner's VehicleController.

    Returns the normalized config, or None when malformed. The engine requires
    a non-empty wheels array (each wheel needs an offset); numeric drive
    inputs are validated when present. Unknown keys are rejected so typos
    surface as repair input instead of silent no-ops.
    """
    if not isinstance(value, dict):
        return None
    wheels = value.get("wheels")
    if not isinstance(wheels, list) or not wheels:
        return None
    normalized_wheels = []
    for wheel in wheels:
        validated = _validate_wheel(wheel)
        if validated is None:
            return None
        normalized_wheels.append(validated)
    normalized: Dict[str, Any] = {"wheels": normalized_wheels}
    allowed = {"throttle", "steering", "brake", "engineForce", "maxSteerAngle"}
    for key, item in value.items():
        if key == "wheels":
            continue
        if key not in allowed or not _is_finite_number(item):
            return None
        normalized[key] = float(item)
    return normalized


def _validate_streamer(value: Any) -> Optional[Dict[str, Any]]:
    """WorldStreamer configs pass straight to the QA runner (objSpec.streamer).

    Returns the normalized config, or None when malformed. All fields are
    optional (the engine supplies defaults); present fields must be positive
    finite numbers, and unknown keys are rejected so typos surface as repair
    input instead of silent no-ops.
    """
    if not isinstance(value, dict):
        return None
    allowed = {"chunkSize", "renderDistance", "resolution", "maxHeight", "seed"}
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key not in allowed or not _is_finite_number(item) or item <= 0:
            return None
        normalized[key] = float(item) if key != "seed" else int(item)
    return normalized


def _validate_biome(value: Any) -> Optional[str]:
    """Biome tags label composition regions (free-form, sanitized).

    Returns the stripped tag, or None when malformed. Tags are intentionally
    open-vocabulary — briefs define their own biomes ("sand rim", "grass
    infield") — but restricted to a safe charset so scene JSON stays clean.
    """
    if not isinstance(value, str):
        return None
    tag = value.strip()
    if not tag or len(tag) > 40:
        return None
    if not all(ch.isalnum() or ch in " _-" for ch in tag):
        return None
    return tag


WEAPON_NUMERICS = {
    "damage",
    "fireRate",
    "range",
    "maxAmmo",
    "reloadTime",
    "spreadBloom",
    "recoilKick",
}


def _validate_weapon(value: Any) -> Optional[Dict[str, Any]]:
    """WeaponController options pass straight to the QA runner (objSpec.weapon).

    Returns the normalized options, or None when malformed. All fields are
    optional (the engine supplies FPS-arena defaults); present numeric fields
    must be finite and non-negative, `weaponName` a non-empty string, and
    unknown keys are rejected so typos surface as repair input.
    """
    if not isinstance(value, dict):
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "weaponName":
            if not isinstance(item, str) or not item.strip():
                return None
            normalized[key] = item.strip()
        elif key in WEAPON_NUMERICS:
            if not _is_finite_number(item) or item < 0:
                return None
            normalized[key] = float(item)
        else:
            return None
    return normalized


def _validate_health(value: Any) -> Optional[Dict[str, Any]]:
    """HealthComponent options pass straight to the QA runner (objSpec.health).

    Returns the normalized options, or None when malformed. `maxHealth` must
    be a positive finite number when present, `destroyOnDeath` a bool, and
    unknown keys are rejected so typos surface as repair input.
    """
    if not isinstance(value, dict):
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "maxHealth":
            if not _is_finite_number(item) or item <= 0:
                return None
            normalized[key] = float(item)
        elif key == "destroyOnDeath":
            if not isinstance(item, bool):
                return None
            normalized[key] = item
        else:
            return None
    return normalized


AI_NUMERICS = {
    "moveSpeed",
    "stopDistance",
    "aggroRange",
    "attackRange",
    "attackDamage",
    "attackIntervalSeconds",
}


def _validate_ai(value: Any) -> Optional[Dict[str, Any]]:
    """EnemyAI NPC-routine options pass straight to the QA runner (objSpec.ai).

    Returns the normalized options, or None when malformed. `targetName` must
    be a non-empty string naming the object to chase; numeric behavior-tree
    tunables must be finite and non-negative; unknown keys are rejected so
    typos surface as repair input instead of silent no-ops.
    """
    if not isinstance(value, dict):
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "targetName":
            if not isinstance(item, str) or not item.strip():
                return None
            normalized[key] = item.strip()
        elif key in AI_NUMERICS:
            if not _is_finite_number(item) or item < 0:
                return None
            normalized[key] = float(item)
        else:
            return None
    return normalized


CEL_COLORS = {"baseColor", "shadowColor", "rimColor", "outlineColor"}
CEL_NUMERICS = {"outlineThickness", "rimPower"}

#: Behaviors the loop may attach via the `behaviors` array (mirrors the engine
#: BuiltinComponents registry; Tween options pass through unvalidated since
#: every key is a valid tween spec field trio).
BEHAVIOR_TYPES = {
    "Tween",
    "TopDownMovement",
    "Draggable",
    "DestroyOutsideScreen",
    "PlatformerCharacter",
    "Platform",
    "Pathfollow",
    "Timer",
}


def _validate_cel(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """AnimeCelShader calibration passes straight to the QA runner (objSpec.cel).

    Returns the normalized options, or None when malformed. Color stops must
    be #rgb/#rrggbb; outlineThickness/rimPower finite and non-negative;
    unknown keys (incl. lightDirection — the engine default stands headless)
    are rejected so typos surface as repair input instead of silent no-ops.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("cel-shading options must be an object")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key in CEL_COLORS:
            if not _is_color(item):
                fail(f"cel '{key}' must be #rgb or #rrggbb (got {item!r})")
                return None
            normalized[key] = item
        elif key in CEL_NUMERICS:
            if not _is_finite_number(item) or item < 0:
                fail(f"cel '{key}' must be a non-negative finite number (got {item!r})")
                return None
            normalized[key] = float(item)
        else:
            fail(
                f"unknown cel key '{key}' (allowed: {sorted(CEL_COLORS | CEL_NUMERICS)})"
            )
            return None
    return normalized


TOPDOWN_NUMERICS = {"moveSpeed"}
TOPDOWN_FLAGS = {"allowDiagonals", "rotateToHeading"}


def _validate_behaviors(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[List[Dict[str, Any]]]:
    """Behavior attachments pass straight to the QA runner (objSpec.behaviors).

    Returns the normalized [{type, options}] list, or None when malformed.
    Each entry needs a registered type; Tween options pass through (every
    play() field is optional with engine defaults); TopDownMovement options
    are validated (moveSpeed non-negative finite, flags boolean, simulate an
    {x, y} finite pair). Unknown types/keys are rejected with indexed reasons.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, list) or not value:
        fail("behaviors must be a non-empty array of {type, options} entries")
        return None
    normalized: List[Dict[str, Any]] = []
    for i, entry in enumerate(value):
        if not isinstance(entry, dict):
            fail(f"behaviors[{i}] must be an object")
            return None
        btype = entry.get("type")
        if btype not in BEHAVIOR_TYPES:
            fail(
                f"behaviors[{i}].type must be one of {sorted(BEHAVIOR_TYPES)} "
                f"(got {btype!r})"
            )
            return None
        options = entry.get("options", {})
        if not isinstance(options, dict):
            fail(f"behaviors[{i}].options must be an object")
            return None
        if btype == "TopDownMovement":
            checked = _validate_topdown_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "Draggable":
            checked = _validate_draggable_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "DestroyOutsideScreen":
            checked = _validate_destroy_outside_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "PlatformerCharacter":
            checked = _validate_platformer_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "Platform":
            checked = _validate_platform_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "Pathfollow":
            checked = _validate_pathfollow_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "Timer":
            checked = _validate_timer_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        else:
            normalized.append({"type": btype, "options": dict(options)})
    return normalized


def _validate_topdown_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key in TOPDOWN_NUMERICS:
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] TopDownMovement '{key}' must be a "
                    f"non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key in TOPDOWN_FLAGS:
            if not isinstance(item, bool):
                fail(
                    f"behaviors[{index}] TopDownMovement '{key}' must be "
                    f"true/false (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "simulate":
            if (
                not isinstance(item, dict)
                or not _is_finite_number(item.get("x"))
                or not _is_finite_number(item.get("y"))
            ):
                fail(
                    f"behaviors[{index}] TopDownMovement 'simulate' must be "
                    f"an {{x, y}} finite pair (got {item!r})"
                )
                return None
            normalized[key] = {"x": float(item["x"]), "y": float(item["y"])}
        else:
            fail(
                f"behaviors[{index}] unknown TopDownMovement option '{key}' "
                "(allowed: moveSpeed, allowDiagonals, rotateToHeading, simulate)"
            )
            return None
    return normalized


def _validate_draggable_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "axisLock":
            if item not in ("x", "z", None):
                fail(
                    f"behaviors[{index}] Draggable 'axisLock' must be "
                    f"'x', 'z', or null (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "dragTarget":
            if (
                not isinstance(item, dict)
                or not _is_finite_number(item.get("x"))
                or not _is_finite_number(item.get("z"))
            ):
                fail(
                    f"behaviors[{index}] Draggable 'dragTarget' must be "
                    f"an {{x, z}} finite pair (got {item!r})"
                )
                return None
            normalized[key] = {"x": float(item["x"]), "z": float(item["z"])}
        elif key == "snapBack":
            if not isinstance(item, bool):
                fail(
                    f"behaviors[{index}] Draggable 'snapBack' must be "
                    f"true/false (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Draggable option '{key}' "
                "(allowed: axisLock, dragTarget, snapBack)"
            )
            return None
    return normalized


def _validate_destroy_outside_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "margin":
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] DestroyOutsideScreen 'margin' must be "
                    f"a non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        else:
            fail(
                f"behaviors[{index}] unknown DestroyOutsideScreen option '{key}' "
                "(allowed: margin)"
            )
            return None
    return normalized


PLATFORMER_NUMERICS = {"moveSpeed", "jumpForce", "gravity", "coyoteTime"}


def _validate_platformer_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key in PLATFORMER_NUMERICS:
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] PlatformerCharacter '{key}' must be a "
                    f"non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key == "maxJumps":
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or int(item) != item
                or item < 1
            ):
                fail(
                    f"behaviors[{index}] PlatformerCharacter 'maxJumps' must be "
                    f"an integer >= 1 (got {item!r})"
                )
                return None
            normalized[key] = int(item)
        elif key == "simulate":
            if (
                not isinstance(item, dict)
                or not _is_finite_number(item.get("x"))
                or not isinstance(item.get("jump"), bool)
            ):
                fail(
                    f"behaviors[{index}] PlatformerCharacter 'simulate' must be "
                    f"{{x, jump:bool}} (got {item!r})"
                )
                return None
            normalized[key] = {"x": float(item["x"]), "jump": item["jump"]}
        else:
            fail(
                f"behaviors[{index}] unknown PlatformerCharacter option '{key}' "
                "(allowed: moveSpeed, jumpForce, gravity, coyoteTime, maxJumps, simulate)"
            )
            return None
    return normalized


def _validate_platform_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "platformType":
            if item not in ("solid", "jumpthru", "ladder"):
                fail(
                    f"behaviors[{index}] Platform 'platformType' must be "
                    f"solid|jumpthru|ladder (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Platform option '{key}' "
                "(allowed: platformType)"
            )
            return None
    return normalized


def _validate_pathfollow_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "waypoints":
            if (
                not isinstance(item, list)
                or not item
                or not all(
                    isinstance(w, dict)
                    and _is_finite_number(w.get("x"))
                    and _is_finite_number(w.get("z"))
                    for w in item
                )
            ):
                fail(
                    f"behaviors[{index}] Pathfollow 'waypoints' must be a "
                    f"non-empty [{'{'}x, z{'}'}] array (got {item!r})"
                )
                return None
            normalized[key] = [{"x": float(w["x"]), "z": float(w["z"])} for w in item]
        elif key in ("moveSpeed", "arrivalRadius", "groundOffset"):
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] Pathfollow '{key}' must be a "
                    f"non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key == "mode":
            if item not in ("loop", "pingpong", "once"):
                fail(
                    f"behaviors[{index}] Pathfollow 'mode' must be "
                    f"loop|pingpong|once (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Pathfollow option '{key}' "
                "(allowed: waypoints, moveSpeed, mode, arrivalRadius, groundOffset)"
            )
            return None
    return normalized


def _validate_timer_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "duration":
            if not _is_finite_number(item) or item <= 0:
                fail(
                    f"behaviors[{index}] Timer 'duration' must be a "
                    f"positive finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key in ("repeat", "autostart"):
            if not isinstance(item, bool):
                fail(
                    f"behaviors[{index}] Timer '{key}' must be "
                    f"true/false (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Timer option '{key}' "
                "(allowed: duration, repeat, autostart)"
            )
            return None
    return normalized


DIALOGUE_NODE_TYPES = {"text", "choice", "condition", "action", "end"}
DIALOGUE_CONDITION_OPERATORS = {"==", "!=", ">", "<", ">=", "<="}


def _validate_dialogue(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """DialogueTree graphs pass straight to the QA runner (spec.dialogues).

    Returns the normalized tree, or None when malformed. `id` and
    `startNodeId` must be non-empty; `nodes` a non-empty id→node map. Every
    node needs a valid type, and every node reference (choice nextNodeId,
    text/action nextNodeId, condition onTrue/onFalse) must resolve to a node
    in the same tree — dangling refs are rejected with indexed reasons so the
    headless auto-play can never walk off the graph. When `errors` is given,
    the specific offense is appended for repair prompts.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("dialogue 'tree' must be an object")
        return None
    tree_id = value.get("id")
    if not isinstance(tree_id, str) or not tree_id.strip():
        fail("dialogue tree 'id' must be a non-empty string")
        return None
    start = value.get("startNodeId")
    if not isinstance(start, str) or not start.strip():
        fail("dialogue tree 'startNodeId' must be a non-empty string")
        return None
    nodes = value.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        fail("dialogue tree 'nodes' must be a non-empty id→node map")
        return None
    if start not in nodes:
        fail(f"dialogue startNodeId '{start}' does not match any node id")
        return None
    normalized_nodes: Dict[str, Any] = {}
    for node_id, node in nodes.items():
        validated = _validate_dialogue_node(node_id, node, set(nodes.keys()), errors)
        if validated is None:
            return None
        normalized_nodes[node_id] = validated
    normalized: Dict[str, Any] = {
        "id": tree_id.strip(),
        "startNodeId": start,
        "nodes": normalized_nodes,
    }
    title = value.get("title")
    if title is not None:
        if not isinstance(title, str):
            fail("dialogue tree 'title' must be a string")
            return None
        normalized["title"] = title
    return normalized


def _validate_dialogue_node(
    node_id: Any, node: Any, node_ids: set, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(node, dict):
        fail(f"dialogue node '{node_id}' must be an object")
        return None
    ntype = node.get("type")
    if ntype not in DIALOGUE_NODE_TYPES:
        fail(
            f"dialogue node '{node_id}' type must be one of "
            f"{sorted(DIALOGUE_NODE_TYPES)} (got {ntype!r})"
        )
        return None

    def check_ref(ref: Any, field: str) -> bool:
        if not isinstance(ref, str) or ref not in node_ids:
            fail(
                f"dialogue node '{node_id}' {field} must name an existing node "
                f"(got {ref!r})"
            )
            return False
        return True

    if ntype == "choice":
        choices = node.get("choices")
        if not isinstance(choices, list) or not choices:
            fail(f"dialogue choice node '{node_id}' needs a non-empty 'choices' array")
            return None
        for i, choice in enumerate(choices):
            if not isinstance(choice, dict):
                fail(f"dialogue node '{node_id}' choices[{i}] must be an object")
                return None
            if not check_ref(choice.get("nextNodeId"), f"choices[{i}].nextNodeId"):
                return None
    elif ntype in ("text", "action"):
        if node.get("nextNodeId") is not None and not check_ref(
            node.get("nextNodeId"), "nextNodeId"
        ):
            return None
        if ntype == "action":
            action = node.get("action")
            if action is not None:
                if not isinstance(action, dict):
                    fail(f"dialogue action node '{node_id}' 'action' must be an object")
                    return None
                for akey in action:
                    if akey not in ("setVariables", "emitEvent", "nextNodeId"):
                        fail(
                            f"dialogue action node '{node_id}' unknown action key "
                            f"'{akey}' (allowed: setVariables, emitEvent, nextNodeId) — "
                            'bare "event"/"fireEvent" keys never fire'
                        )
                        return None
                variables = action.get("setVariables")
                if variables is not None and not isinstance(variables, dict):
                    fail(
                        f"dialogue action node '{node_id}' 'action.setVariables' "
                        "must be an object"
                    )
                    return None
                if action.get("nextNodeId") is not None and not check_ref(
                    action.get("nextNodeId"), "action.nextNodeId"
                ):
                    return None
                emit = action.get("emitEvent")
                if emit is not None:
                    # The engine only fires emitEvent:{eventName}; bare "event"
                    # or "fireEvent" keys are silently ignored, so a blessing
                    # that sets its flag but never fires is the classic miss.
                    if (
                        not isinstance(emit, dict)
                        or not isinstance(emit.get("eventName"), str)
                        or not emit.get("eventName").strip()
                    ):
                        fail(
                            f"dialogue action node '{node_id}' 'action.emitEvent' "
                            "must be an object with a non-empty 'eventName' "
                            f"(got {emit!r})"
                        )
                        return None
    elif ntype == "condition":
        condition = node.get("condition")
        if not isinstance(condition, dict):
            fail(f"dialogue condition node '{node_id}' needs a 'condition' object")
            return None
        if not check_ref(condition.get("onTrueNodeId"), "condition.onTrueNodeId"):
            return None
        if condition.get("onFalseNodeId") is not None and not check_ref(
            condition.get("onFalseNodeId"), "condition.onFalseNodeId"
        ):
            return None
    return dict(node)


GAME_MODES = {"waves", "build"}
GAME_NUMERICS = {
    "targetScore",
    "timeLimitSeconds",
    "totalWaves",
    "enemiesPerWave",
    "spawnRadius",
    "scorePerKill",
    "interWaveDelaySeconds",
    "hitEveryFrames",
    "hitDamage",
    "hitGauge",
}
GAME_ELEMENTS = {"Pyro", "Hydro", "Cryo", "Electro", "Anemo", "Geo", "Dendro"}


def _validate_game(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """GameRuntime quest/combat configs pass straight to the QA runner (spec.game).

    Returns the normalized config, or None when malformed. `mode` must be
    "waves" (arena defense) or "build" (settlement); `playerName` a non-empty
    string naming the spawned player object; numeric pacing fields must be
    finite and positive; the optional `enemy`/`settlement` blocks are validated
    lightly (shape allow-list, positive health/population numbers) with the
    engine supplying defaults for everything omitted. Unknown keys are rejected
    so typos surface as repair input instead of silent no-ops. When `errors`
    is given, the specific offense is appended so repair prompts can quote it.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("game 'config' must be an object")
        return None
    if not value:
        fail("game 'config' must not be empty (need at least mode/playerName/numerics)")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "mode":
            if item not in GAME_MODES:
                fail(f"game 'mode' must be one of {sorted(GAME_MODES)} (got {item!r})")
                return None
            normalized[key] = item
        elif key == "playerName":
            if not isinstance(item, str) or not item.strip():
                fail(f"game 'playerName' must be a non-empty string (got {item!r})")
                return None
            normalized[key] = item.strip()
        elif key in GAME_NUMERICS:
            if not _is_finite_number(item) or item <= 0:
                fail(f"game '{key}' must be a positive finite number (got {item!r})")
                return None
            normalized[key] = float(item)
        elif key == "hitElement":
            if item not in GAME_ELEMENTS:
                fail(
                    f"game 'hitElement' must be one of {sorted(GAME_ELEMENTS)} (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "enemy":
            enemy = _validate_game_enemy(item, errors)
            if enemy is None:
                if errors is not None and not any("enemy" in e for e in errors):
                    errors.append("game 'enemy' block is malformed")
                return None
            normalized[key] = enemy
        elif key == "settlement":
            settlement = _validate_game_settlement(item, errors)
            if settlement is None:
                if errors is not None and not any("settlement" in e for e in errors):
                    errors.append("game 'settlement' block is malformed")
                return None
            normalized[key] = settlement
        else:
            fail(
                f"unknown game key '{key}' (allowed: mode, playerName, "
                f"{sorted(GAME_NUMERICS)}, hitElement, enemy, settlement)"
            )
            return None
    return normalized


def _validate_game_enemy(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("game 'enemy' must be an object")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "shape":
            if item not in SUPPORTED_SHAPES:
                fail(
                    f"game enemy 'shape' must be one of {sorted(SUPPORTED_SHAPES)} (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "color":
            if not _is_color(item):
                fail(f"game enemy 'color' must be #rgb or #rrggbb (got {item!r})")
                return None
            normalized[key] = item
        elif key == "size":
            vec = _vec3(item)
            if vec is None:
                fail(f"game enemy 'size' must be 3 finite numbers (got {item!r})")
                return None
            normalized[key] = vec
        elif key == "y":
            if not _is_finite_number(item):
                fail(f"game enemy 'y' must be a finite number (got {item!r})")
                return None
            normalized[key] = float(item)
        elif key == "health":
            if not isinstance(item, dict):
                fail("game enemy 'health' must be an object")
                return None
            health: Dict[str, Any] = {}
            for hkey, hitem in item.items():
                if hkey == "maxHealth":
                    if not _is_finite_number(hitem) or hitem <= 0:
                        fail(
                            f"game enemy health 'maxHealth' must be positive (got {hitem!r})"
                        )
                        return None
                    health[hkey] = float(hitem)
                elif hkey == "destroyOnDeath":
                    if not isinstance(hitem, bool):
                        fail(
                            f"game enemy health 'destroyOnDeath' must be true/false (got {hitem!r})"
                        )
                        return None
                    health[hkey] = hitem
                else:
                    fail(
                        f"unknown game enemy health key '{hkey}' (allowed: maxHealth, destroyOnDeath)"
                    )
                    return None
            normalized[key] = health
        elif key == "ai":
            if not isinstance(item, dict):
                fail("game 'enemy.ai' must be an object")
                return None
            normalized[key] = dict(item)
        elif key == "elemental":
            elemental = _validate_elemental(item, errors, "game enemy elemental")
            if elemental is None:
                return None
            normalized[key] = elemental
        else:
            fail(
                f"unknown game enemy key '{key}' "
                "(allowed: shape, color, size, y, health, ai, elemental)"
            )
            return None
    return normalized


def _validate_elemental(
    value: Any, errors: Optional[List[str]], where: str
) -> Optional[Dict[str, Any]]:
    """Elemental aura configs pass to the QA runner's ElementalReactionComponent.

    `aura` must be a Genshin-style element type; `maxHealth` a positive finite
    number. Unknown keys are rejected so typos surface as repair input.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail(f"{where} must be an object")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "aura":
            if item not in GAME_ELEMENTS:
                fail(
                    f"{where} 'aura' must be one of {sorted(GAME_ELEMENTS)} (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "maxHealth":
            if not _is_finite_number(item) or item <= 0:
                fail(f"{where} 'maxHealth' must be positive (got {item!r})")
                return None
            normalized[key] = float(item)
        else:
            fail(f"unknown {where} key '{key}' (allowed: aura, maxHealth)")
            return None
    return normalized


def _validate_game_settlement(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("game 'settlement' must be an object")
        return None
    grid_raw = value.get("gridSize", 8)
    grid_size = grid_raw if _is_finite_number(grid_raw) and grid_raw > 0 else 8
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key in {
            "gridSize",
            "targetPopulation",
            "startingGold",
            "startingFood",
        }:
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"game settlement '{key}' must be a non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key == "placements":
            plots = _validate_settlement_plots(item, grid_size, errors)
            if plots is None:
                return None
            normalized[key] = plots
        else:
            fail(
                f"unknown game settlement key '{key}' (allowed: gridSize, "
                "targetPopulation, startingGold, startingFood, placements)"
            )
            return None
    return normalized


SETTLEMENT_BUILDINGS = {"house", "farm", "market"}


def _validate_settlement_plots(
    value: Any, grid_size: float, errors: Optional[List[str]]
) -> Optional[List[Dict[str, Any]]]:
    """Placement plots pass to Settlement.place(type, x, z) in the QA runner.

    Invalid plots are skipped SILENTLY by the engine (place() returns a reason
    the runner never surfaces), so a bad plot shows up downstream as a
    population shortfall, not an error. Validate strictly here instead: type
    must be house/farm/market and x/z integer plots inside the grid.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, list):
        fail("game settlement 'placements' must be an array of {type, x, z} plots")
        return None
    grid = int(grid_size) if _is_finite_number(grid_size) and grid_size > 0 else 8
    plots: List[Dict[str, Any]] = []
    for i, plot in enumerate(value):
        if not isinstance(plot, dict):
            fail(f"settlement placements[{i}] must be an object (got {plot!r})")
            return None
        ptype = plot.get("type")
        if ptype not in SETTLEMENT_BUILDINGS:
            fail(
                f"settlement placements[{i}].type must be one of "
                f"{sorted(SETTLEMENT_BUILDINGS)} (got {ptype!r})"
            )
            return None
        for axis in ("x", "z"):
            coord = plot.get(axis)
            if (
                not isinstance(coord, int)
                or isinstance(coord, bool)
                or coord < 0
                or coord >= grid
            ):
                fail(
                    f"settlement placements[{i}].{axis} must be an integer plot "
                    f"inside the {grid}x{grid} grid (got {coord!r})"
                )
                return None
        plots.append({"type": ptype, "x": plot["x"], "z": plot["z"]})
    return plots


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
    action = dict(action)
    prefab_ref = action.pop("prefab", None)
    if prefab_ref is not None:
        # Instantiate from the scene prefab registry: resolved template fields
        # become defaults; explicit action fields win (instance overrides).
        if not isinstance(prefab_ref, str) or not prefab_ref.strip():
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'prefab' must be a defined prefab id",
            )
        registry = scene.get("prefabs", {})
        if not isinstance(registry, dict) or prefab_ref not in registry:
            defined = sorted(registry.keys()) if isinstance(registry, dict) else []
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"unknown prefab '{prefab_ref}' — define it first with a "
                f"prefab action (defined: {defined})",
            )
        reasons: List[str] = []
        base = resolve_prefab(registry, prefab_ref, None, reasons)
        if base is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"prefab '{prefab_ref}' unresolvable — {reasons[0] if reasons else 'malformed'}",
            )
        for key, value in base.items():
            if key in ("name", "uid"):
                continue  # identity always comes from the spawn action
            action.setdefault(key, value)
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
    if action.get("controller") is True:
        # Maps to a MobileController component in the engine scene adapter.
        obj["controller"] = True
    if action.get("vehicle") is not None:
        # Maps to a VehicleController in the QA runner (objSpec.vehicle).
        vehicle = _validate_vehicle(action.get("vehicle"))
        if vehicle is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'vehicle' must be an object with a non-empty 'wheels' array "
                "(each wheel needs an 'offset' [x,y,z]; optional numerics: throttle, "
                "steering, brake, engineForce, maxSteerAngle)",
            )
        obj["vehicle"] = vehicle
    if action.get("streamer") is not None:
        # Maps to a WorldStreamer in the QA runner (objSpec.streamer).
        streamer = _validate_streamer(action.get("streamer"))
        if streamer is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'streamer' must be an object of positive numbers "
                "(allowed: chunkSize, renderDistance, resolution, maxHeight, seed)",
            )
        obj["streamer"] = streamer
    if action.get("biome") is not None:
        # Composition tag audited by the biome_coverage_min QA rule.
        biome = _validate_biome(action.get("biome"))
        if biome is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'biome' must be a 1-40 character tag "
                "(letters, digits, spaces, _ and - only)",
            )
        obj["biome"] = biome
    if action.get("weapon") is not None:
        # Maps to a WeaponController in the QA runner (objSpec.weapon).
        weapon = _validate_weapon(action.get("weapon"))
        if weapon is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'weapon' must be an object of engine WeaponController options "
                "(numerics: damage, fireRate, range, maxAmmo, reloadTime, spreadBloom, "
                "recoilKick; string: weaponName)",
            )
        obj["weapon"] = weapon
    if action.get("health") is not None:
        # Maps to a HealthComponent in the QA runner (objSpec.health).
        health = _validate_health(action.get("health"))
        if health is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'health' must be an object with positive maxHealth "
                "and optional destroyOnDeath bool",
            )
        obj["health"] = health
    if action.get("ai") is not None:
        # Maps to an EnemyAI NPC routine in the QA runner (objSpec.ai).
        ai = _validate_ai(action.get("ai"))
        if ai is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                "spawn 'ai' must be an object with a non-empty targetName "
                "and optional non-negative behavior tunables "
                "(moveSpeed, stopDistance, aggroRange, attackRange, "
                "attackDamage, attackIntervalSeconds)",
            )
        obj["ai"] = ai
    if action.get("elemental") is not None:
        # Maps to an ElementalReactionComponent in the QA runner (objSpec.elemental).
        elemental_reasons: List[str] = []
        elemental = _validate_elemental(
            action.get("elemental"), elemental_reasons, "spawn 'elemental'"
        )
        if elemental is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn elemental rejected — {elemental_reasons[0] if elemental_reasons else 'malformed'}",
            )
        obj["elemental"] = elemental
    if action.get("cel") is not None:
        # Maps to an AnimeCelShader in the QA runner (objSpec.cel).
        cel_reasons: List[str] = []
        cel = _validate_cel(action.get("cel"), cel_reasons)
        if cel is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn cel-shading rejected — {cel_reasons[0] if cel_reasons else 'malformed'}",
            )
        obj["cel"] = cel
    if action.get("behaviors") is not None:
        # Maps to behavior components in the QA runner (objSpec.behaviors).
        behavior_reasons: List[str] = []
        behaviors = _validate_behaviors(action.get("behaviors"), behavior_reasons)
        if behaviors is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn behaviors rejected — {behavior_reasons[0] if behavior_reasons else 'malformed'}",
            )
        obj["behaviors"] = behaviors

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
        elif field_name == "controller":
            if not isinstance(value, bool):
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"controller must be true/false (got {value!r})",
                )
            obj["controller"] = value
        elif field_name == "vehicle":
            vehicle = _validate_vehicle(value)
            if vehicle is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'vehicle' must be an object with a non-empty 'wheels' array "
                    "(each wheel needs an 'offset' [x,y,z])",
                )
            obj["vehicle"] = vehicle
        elif field_name == "streamer":
            streamer = _validate_streamer(value)
            if streamer is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'streamer' must be an object of positive numbers "
                    "(allowed: chunkSize, renderDistance, resolution, maxHeight, seed)",
                )
            obj["streamer"] = streamer
        elif field_name == "biome":
            biome = _validate_biome(value)
            if biome is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'biome' must be a 1-40 character tag "
                    "(letters, digits, spaces, _ and - only)",
                )
            obj["biome"] = biome
        elif field_name == "weapon":
            weapon = _validate_weapon(value)
            if weapon is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'weapon' must be an object of engine WeaponController options "
                    "(numerics: damage, fireRate, range, maxAmmo, reloadTime, spreadBloom, "
                    "recoilKick; string: weaponName)",
                )
            obj["weapon"] = weapon
        elif field_name == "health":
            health = _validate_health(value)
            if health is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'health' must be an object with positive maxHealth "
                    "and optional destroyOnDeath bool",
                )
            obj["health"] = health
        elif field_name == "ai":
            ai = _validate_ai(value)
            if ai is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    "modify 'ai' must be an object with a non-empty targetName "
                    "and optional non-negative behavior tunables",
                )
            obj["ai"] = ai
        elif field_name == "elemental":
            elemental_reasons: List[str] = []
            elemental = _validate_elemental(
                value, elemental_reasons, "modify 'elemental'"
            )
            if elemental is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"modify elemental rejected — {elemental_reasons[0] if elemental_reasons else 'malformed'}",
                )
            obj["elemental"] = elemental
        elif field_name == "cel":
            cel_reasons: List[str] = []
            cel = _validate_cel(value, cel_reasons)
            if cel is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"modify cel-shading rejected — {cel_reasons[0] if cel_reasons else 'malformed'}",
                )
            obj["cel"] = cel
        elif field_name == "behaviors":
            behavior_reasons: List[str] = []
            behaviors = _validate_behaviors(value, behavior_reasons)
            if behaviors is None:
                return _outcome(
                    result,
                    index,
                    "modify",
                    "invalid",
                    f"modify behaviors rejected — {behavior_reasons[0] if behavior_reasons else 'malformed'}",
                )
            obj["behaviors"] = behaviors
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


def _apply_game(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    config = _validate_game(action.get("config"))
    if config is None:
        reasons: List[str] = []
        _validate_game(action.get("config"), reasons)
        detail = reasons[0] if reasons else "malformed config"
        return _outcome(
            result,
            index,
            "game",
            "invalid",
            f"game config rejected — {detail}",
        )
    scene["game"] = config
    mode = config.get("mode", "waves")
    _outcome(
        result,
        index,
        "game",
        "applied",
        f"Set {mode}-mode quest config for player "
        f"'{config.get('playerName', 'Player Hero')}'",
    )


def _apply_prefab(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    prefab = validate_prefab(action.get("prefab"), reasons)
    if prefab is None:
        detail = reasons[0] if reasons else "malformed prefab"
        return _outcome(
            result,
            index,
            "prefab",
            "invalid",
            f"prefab definition rejected — {detail}",
        )
    registry = scene.setdefault("prefabs", {})
    if not isinstance(registry, dict):
        return _outcome(
            result, index, "prefab", "invalid", "scene 'prefabs' registry is corrupt"
        )
    registry[prefab["id"]] = prefab
    _outcome(
        result,
        index,
        "prefab",
        "applied",
        f"Registered prefab '{prefab['id']}'"
        + (f" (variant of '{prefab['base']}')" if prefab["base"] else ""),
    )


def _apply_dialogue(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    tree = _validate_dialogue(action.get("tree"), reasons)
    if tree is None:
        detail = reasons[0] if reasons else "malformed tree"
        return _outcome(
            result,
            index,
            "dialogue",
            "invalid",
            f"dialogue tree rejected — {detail}",
        )
    scene.setdefault("dialogues", {})[tree["id"]] = tree
    _outcome(
        result,
        index,
        "dialogue",
        "applied",
        f"Registered dialogue tree '{tree['id']}' "
        f"({len(tree['nodes'])} nodes from '{tree['startNodeId']}')",
    )


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
    "game": _apply_game,
    "dialogue": _apply_dialogue,
    "prefab": _apply_prefab,
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
