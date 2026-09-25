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
    "Spawner",
    "SaveSlot",
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
        elif btype == "Spawner":
            checked = _validate_spawner_options(options, i, errors)
            if checked is None:
                return None
            normalized.append({"type": btype, "options": checked})
        elif btype == "SaveSlot":
            checked = _validate_saveslot_options(options, i, errors)
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


def _validate_spawner_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "template":
            template = _validate_spawn_template(item, index, errors)
            if template is None:
                return None
            normalized[key] = template
        elif key == "interval":
            if not _is_finite_number(item) or item <= 0:
                fail(
                    f"behaviors[{index}] Spawner 'interval' must be a "
                    f"positive finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key == "maxSpawns":
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or int(item) != item
                or item < 0
            ):
                fail(
                    f"behaviors[{index}] Spawner 'maxSpawns' must be "
                    f"an integer >= 0 (got {item!r})"
                )
                return None
            normalized[key] = int(item)
        elif key == "spawnRadius":
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] Spawner 'spawnRadius' must be a "
                    f"non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        elif key == "spawnOffset":
            vec = _vec3(item)
            if vec is None:
                fail(
                    f"behaviors[{index}] Spawner 'spawnOffset' must be "
                    f"3 finite numbers (got {item!r})"
                )
                return None
            normalized[key] = vec
        elif key == "autostart":
            if not isinstance(item, bool):
                fail(
                    f"behaviors[{index}] Spawner 'autostart' must be "
                    f"true/false (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Spawner option '{key}' "
                "(allowed: template, interval, maxSpawns, spawnRadius, "
                "spawnOffset, autostart)"
            )
            return None
    return normalized


def _validate_spawn_template(
    value: Any, index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail(f"behaviors[{index}] Spawner 'template' must be an object")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key == "shape":
            if item not in SUPPORTED_SHAPES:
                fail(
                    f"behaviors[{index}] Spawner template 'shape' must be one of "
                    f"{sorted(SUPPORTED_SHAPES)} (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key == "size":
            vec = _vec3(item)
            if vec is None:
                fail(
                    f"behaviors[{index}] Spawner template 'size' must be "
                    f"3 finite numbers (got {item!r})"
                )
                return None
            normalized[key] = vec
        elif key == "color":
            if not _is_color(item):
                fail(
                    f"behaviors[{index}] Spawner template 'color' must be "
                    f"#rgb or #rrggbb (got {item!r})"
                )
                return None
            normalized[key] = item
        else:
            fail(
                f"behaviors[{index}] unknown Spawner template key '{key}' "
                "(allowed: shape, size, color)"
            )
            return None
    return normalized


def _validate_saveslot_options(
    options: Dict[str, Any], index: int, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    normalized: Dict[str, Any] = {}
    for key, item in options.items():
        if key == "slotName":
            if not isinstance(item, str) or not item.strip() or len(item) > 40:
                fail(
                    f"behaviors[{index}] SaveSlot 'slotName' must be a "
                    f"non-empty string (max 40 chars) (got {item!r})"
                )
                return None
            normalized[key] = item.strip()
        elif key == "autosaveInterval":
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"behaviors[{index}] SaveSlot 'autosaveInterval' must be a "
                    f"non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        else:
            fail(
                f"behaviors[{index}] unknown SaveSlot option '{key}' "
                "(allowed: slotName, autosaveInterval)"
            )
            return None
    return normalized


PARTICLE_INTS = {"maxParticles": 1, "burst": 0}
PARTICLE_NUMERICS = {"rate", "duration", "spread", "gravity", "drag", "opacity"}
PARTICLE_RANGES = (
    ("speedMin", "speedMax"),
    ("lifetimeMin", "lifetimeMax"),
    ("sizeMin", "sizeMax"),
)


def _validate_particle(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """ParticleSystem emitter options pass straight to the QA runner (objSpec.particle).

    Returns the normalized options, or None when malformed. Range pairs
    (speed/lifetime/size min-max) must order correctly; colors must be
    #rgb/#rrggbb; unknown keys are rejected so typos surface as repair input.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("spawn 'particle' must be an object of emitter options")
        return None
    normalized: Dict[str, Any] = {}
    for key, item in value.items():
        if key in PARTICLE_INTS:
            floor = PARTICLE_INTS[key]
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or int(item) != item
                or item < floor
            ):
                fail(
                    f"spawn particle '{key}' must be an integer >= {floor} "
                    f"(got {item!r})"
                )
                return None
            normalized[key] = int(item)
        elif key in PARTICLE_NUMERICS:
            if not _is_finite_number(item):
                fail(f"spawn particle '{key}' must be a finite number (got {item!r})")
                return None
            if key in ("rate", "duration", "drag") and item < 0:
                fail(f"spawn particle '{key}' must be >= 0 (got {item!r})")
                return None
            if key == "spread" and not 0 <= item <= 3.141592653589793:
                fail(f"spawn particle 'spread' must be 0..pi radians (got {item!r})")
                return None
            if key == "opacity" and not 0 <= item <= 1:
                fail(f"spawn particle 'opacity' must be 0..1 (got {item!r})")
                return None
            normalized[key] = float(item)
        elif key == "seed":
            if (
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or int(item) != item
                or item < 0
            ):
                fail(f"spawn particle 'seed' must be an integer >= 0 (got {item!r})")
                return None
            normalized[key] = int(item)
        elif key == "shape":
            if item not in ("point", "box", "sphere"):
                fail(f"spawn particle 'shape' must be point|box|sphere (got {item!r})")
                return None
            normalized[key] = item
        elif key in ("shapeSize", "direction"):
            vec = _vec3(item)
            if vec is None:
                fail(f"spawn particle '{key}' must be 3 finite numbers (got {item!r})")
                return None
            normalized[key] = vec
        elif key in ("startColor", "endColor"):
            if not _is_color(item):
                fail(f"spawn particle '{key}' must be #rgb or #rrggbb (got {item!r})")
                return None
            normalized[key] = item
        elif key == "blending":
            if item not in ("additive", "normal"):
                fail(
                    f"spawn particle 'blending' must be additive|normal (got {item!r})"
                )
                return None
            normalized[key] = item
        elif key in ("loop", "autostart"):
            if not isinstance(item, bool):
                fail(f"spawn particle '{key}' must be true/false (got {item!r})")
                return None
            normalized[key] = item
        elif key in {lo for pair in PARTICLE_RANGES for lo in pair} | {
            hi for pair in PARTICLE_RANGES for hi in pair
        }:
            if not _is_finite_number(item) or item < 0:
                fail(
                    f"spawn particle '{key}' must be a non-negative finite number (got {item!r})"
                )
                return None
            normalized[key] = float(item)
        else:
            fail(f"unknown spawn particle key '{key}'")
            return None
    for lo, hi in PARTICLE_RANGES:
        if lo in normalized and hi in normalized and normalized[lo] > normalized[hi]:
            fail(
                f"spawn particle '{lo}' must be <= '{hi}' (got {normalized[lo]} > {normalized[hi]})"
            )
            return None
    return normalized


ANIM_CONDITION_OPS = {"==", "!=", ">", "<", ">=", "<=", "trigger"}


def _validate_anim(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """AnimFSM specs pass straight to the QA runner (objSpec.anim).

    Returns the normalized spec, or None when malformed. States map names
    to {clip, loop?, clipLength?}; transitions reference declared states
    ('*' allowed as from); initial must name a declared state.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("spawn 'anim' must be an object with states/transitions")
        return None
    raw_states = value.get("states")
    if not isinstance(raw_states, dict) or not raw_states:
        fail("spawn anim 'states' must be a non-empty name->spec map")
        return None
    states: Dict[str, Any] = {}
    for name, spec in raw_states.items():
        if not isinstance(name, str) or not name.strip() or not isinstance(spec, dict):
            fail(f"spawn anim state {name!r} must be an object")
            return None
        clip = spec.get("clip")
        if not isinstance(clip, str) or not clip.strip():
            fail(f"spawn anim state '{name}' needs a non-empty 'clip'")
            return None
        entry: Dict[str, Any] = {"clip": clip.strip()}
        if "loop" in spec:
            if not isinstance(spec["loop"], bool):
                fail(f"spawn anim state '{name}' 'loop' must be true/false")
                return None
            entry["loop"] = spec["loop"]
        if "clipLength" in spec:
            if not _is_finite_number(spec["clipLength"]) or spec["clipLength"] <= 0:
                fail(f"spawn anim state '{name}' 'clipLength' must be positive")
                return None
            entry["clipLength"] = float(spec["clipLength"])
        for key in spec:
            if key not in ("clip", "loop", "clipLength"):
                fail(f"spawn anim state '{name}' unknown key '{key}'")
                return None
        states[name] = entry
    normalized: Dict[str, Any] = {"states": states}
    initial = value.get("initial", next(iter(states)))
    if not isinstance(initial, str) or initial not in states:
        fail(f"spawn anim 'initial' must name a declared state (got {initial!r})")
        return None
    normalized["initial"] = initial
    raw_transitions = value.get("transitions", [])
    if not isinstance(raw_transitions, list):
        fail("spawn anim 'transitions' must be an array")
        return None
    transitions: List[Dict[str, Any]] = []
    for i, t in enumerate(raw_transitions):
        if not isinstance(t, dict):
            fail(f"spawn anim transitions[{i}] must be an object")
            return None
        src, dst = t.get("from"), t.get("to")
        if not isinstance(src, str) or (src != "*" and src not in states):
            fail(f"spawn anim transitions[{i}].from must be '*' or a declared state")
            return None
        if not isinstance(dst, str) or dst not in states:
            fail(f"spawn anim transitions[{i}].to must name a declared state")
            return None
        entry_t: Dict[str, Any] = {"from": src, "to": dst}
        raw_conds = t.get("conditions", [])
        if not isinstance(raw_conds, list):
            fail(f"spawn anim transitions[{i}].conditions must be an array")
            return None
        conds: List[Dict[str, Any]] = []
        for j, c in enumerate(raw_conds):
            if not isinstance(c, dict):
                fail(f"spawn anim transitions[{i}].conditions[{j}] must be an object")
                return None
            param, op = c.get("param"), c.get("op")
            if not isinstance(param, str) or not param.strip():
                fail(f"spawn anim transitions[{i}].conditions[{j}] needs a 'param'")
                return None
            if op not in ANIM_CONDITION_OPS:
                fail(
                    f"spawn anim transitions[{i}].conditions[{j}].op must be one of "
                    f"{sorted(ANIM_CONDITION_OPS)} (got {op!r})"
                )
                return None
            cond: Dict[str, Any] = {"param": param.strip(), "op": op}
            if "value" in c:
                if not _is_finite_number(c["value"]):
                    fail(
                        f"spawn anim transitions[{i}].conditions[{j}].value must be finite"
                    )
                    return None
                cond["value"] = float(c["value"])
            conds.append(cond)
        entry_t["conditions"] = conds
        for numkey in ("exitTime", "duration"):
            if numkey in t:
                if not _is_finite_number(t[numkey]) or t[numkey] < 0:
                    fail(f"spawn anim transitions[{i}].{numkey} must be >= 0")
                    return None
                entry_t[numkey] = float(t[numkey])
        transitions.append(entry_t)
    normalized["transitions"] = transitions
    if "params" in value:
        if not isinstance(value["params"], dict) or not all(
            isinstance(k, str) and _is_finite_number(v)
            for k, v in value["params"].items()
        ):
            fail("spawn anim 'params' must be a string->finite-number map")
            return None
        normalized["params"] = {k: float(v) for k, v in value["params"].items()}
    for key in value:
        if key not in ("states", "transitions", "initial", "params"):
            fail(f"unknown spawn anim key '{key}'")
            return None
    return normalized


TIMELINE_CLIP_TYPES = {"move", "rotate", "event", "anim", "camera"}


def _validate_timeline(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """TimelineLite specs pass straight to the QA runner (objSpec.timeline).

    Returns the normalized spec, or None when malformed. Tracks bind live
    object names to non-empty id/start/type clip arrays.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("spawn 'timeline' must be an object with duration/tracks")
        return None
    normalized: Dict[str, Any] = {}
    if "duration" in value:
        if not _is_finite_number(value["duration"]) or value["duration"] <= 0:
            fail("spawn timeline 'duration' must be positive")
            return None
        normalized["duration"] = float(value["duration"])
    for flag in ("loop", "autostart"):
        if flag in value:
            if not isinstance(value[flag], bool):
                fail(f"spawn timeline '{flag}' must be true/false")
                return None
            normalized[flag] = value[flag]
    raw_tracks = value.get("tracks")
    if not isinstance(raw_tracks, list) or not raw_tracks:
        fail("spawn timeline 'tracks' must be a non-empty array")
        return None
    tracks: List[Dict[str, Any]] = []
    for i, track in enumerate(raw_tracks):
        if not isinstance(track, dict):
            fail(f"spawn timeline tracks[{i}] must be an object")
            return None
        target = track.get("target")
        if not isinstance(target, str) or not target.strip():
            fail(f"spawn timeline tracks[{i}] needs a non-empty 'target'")
            return None
        raw_clips = track.get("clips")
        if not isinstance(raw_clips, list) or not raw_clips:
            fail(f"spawn timeline tracks[{i}].clips must be a non-empty array")
            return None
        clips: List[Dict[str, Any]] = []
        for j, clip in enumerate(raw_clips):
            if not isinstance(clip, dict):
                fail(f"spawn timeline tracks[{i}].clips[{j}] must be an object")
                return None
            cid = clip.get("id")
            if not isinstance(cid, str) or not cid.strip():
                fail(f"spawn timeline tracks[{i}].clips[{j}] needs a non-empty 'id'")
                return None
            start = clip.get("start")
            if not _is_finite_number(start) or start < 0:
                fail(f"spawn timeline tracks[{i}].clips[{j}].start must be >= 0")
                return None
            dur = clip.get("dur", 0)
            if not _is_finite_number(dur) or dur < 0:
                fail(f"spawn timeline tracks[{i}].clips[{j}].dur must be >= 0")
                return None
            ctype = clip.get("type")
            if ctype not in TIMELINE_CLIP_TYPES:
                fail(
                    f"spawn timeline tracks[{i}].clips[{j}].type must be one of "
                    f"{sorted(TIMELINE_CLIP_TYPES)} (got {ctype!r})"
                )
                return None
            data = clip.get("data", {})
            if not isinstance(data, dict):
                fail(f"spawn timeline tracks[{i}].clips[{j}].data must be an object")
                return None
            clips.append(
                {
                    "id": cid.strip(),
                    "start": float(start),
                    "dur": float(dur),
                    "type": ctype,
                    "data": dict(data),
                }
            )
        tracks.append({"target": target.strip(), "clips": clips})
    normalized["tracks"] = tracks
    for key in value:
        if key not in ("duration", "loop", "autostart", "tracks"):
            fail(f"unknown spawn timeline key '{key}'")
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
    if action.get("particle") is not None:
        # Maps to a ParticleSystem in the QA runner (objSpec.particle).
        particle_reasons: List[str] = []
        particle = _validate_particle(action.get("particle"), particle_reasons)
        if particle is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn particle rejected — {particle_reasons[0] if particle_reasons else 'malformed'}",
            )
        obj["particle"] = particle
    if action.get("nav") is not None:
        # Maps to a NavAgent in the QA runner (objSpec.nav).
        nav_reasons: List[str] = []
        nav = _validate_nav(action.get("nav"), nav_reasons)
        if nav is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn nav rejected — {nav_reasons[0] if nav_reasons else 'malformed'}",
            )
        obj["nav"] = nav
    if action.get("audio") is not None:
        # Maps to an AudioSource in the QA runner (objSpec.audio).
        audio_reasons: List[str] = []
        audio = _validate_audio(action.get("audio"), audio_reasons)
        if audio is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn audio rejected — {audio_reasons[0] if audio_reasons else 'malformed'}",
            )
        obj["audio"] = audio
    if action.get("anim") is not None:
        # Maps to an AnimFSM in the QA runner (objSpec.anim).
        anim_reasons: List[str] = []
        anim = _validate_anim(action.get("anim"), anim_reasons)
        if anim is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn anim rejected — {anim_reasons[0] if anim_reasons else 'malformed'}",
            )
        obj["anim"] = anim
    if action.get("timeline") is not None:
        # Maps to a TimelineLite in the QA runner (objSpec.timeline).
        timeline_reasons: List[str] = []
        timeline = _validate_timeline(action.get("timeline"), timeline_reasons)
        if timeline is None:
            return _outcome(
                result,
                index,
                "spawn",
                "invalid",
                f"spawn timeline rejected — {timeline_reasons[0] if timeline_reasons else 'malformed'}",
            )
        obj["timeline"] = timeline

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


INPUT_ACTION_TYPES = {"button", "axis1", "axis2"}
INPUT_SOURCES = {"key", "button", "stick", "gamepad-button", "gamepad-axis"}
INPUT_PAD_BUTTONS = {
    "a",
    "b",
    "x",
    "y",
    "lb",
    "rb",
    "lt",
    "rt",
    "select",
    "start",
    "l3",
    "r3",
    "up",
    "down",
    "left",
    "right",
    "home",
}


def _validate_input_binding(
    binding: Any, action_type: str, where: str, errors: Optional[List[str]]
) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(binding, dict):
        fail(f"{where} must be an object")
        return None
    source = binding.get("source")
    if source not in INPUT_SOURCES:
        fail(f"{where}.source must be one of {sorted(INPUT_SOURCES)} (got {source!r})")
        return None
    code = binding.get("code")
    if not isinstance(code, str) or not code.strip():
        fail(f"{where} needs a non-empty 'code'")
        return None
    code = code.strip()
    if source == "stick" and code not in ("left", "right"):
        fail(f"{where}.code for stick must be left|right (got {code!r})")
        return None
    if source == "gamepad-button" and (
        code.lower() not in INPUT_PAD_BUTTONS
        and not (code.lower().startswith("pad") and code[3:].isdigit())
    ):
        fail(f"{where}.code unknown gamepad button (got {code!r})")
        return None
    if source == "gamepad-axis" and code.lower() not in (
        "axis0",
        "axis1",
        "axis2",
        "axis3",
    ):
        fail(f"{where}.code must be axis0..axis3 (got {code!r})")
        return None
    normalized: Dict[str, Any] = {"source": source, "code": code}
    if "axis" in binding:
        if binding["axis"] not in ("x", "y"):
            fail(f"{where}.axis must be x|y (got {binding['axis']!r})")
            return None
        normalized["axis"] = binding["axis"]
    if "output" in binding:
        if not _is_finite_number(binding["output"]):
            fail(f"{where}.output must be a finite number")
            return None
        normalized["output"] = float(binding["output"])
    if "output2" in binding:
        pair = binding["output2"]
        if (
            not isinstance(pair, (list, tuple))
            or len(pair) != 2
            or not all(_is_finite_number(v) for v in pair)
        ):
            fail(f"{where}.output2 must be a finite [x, y] pair")
            return None
        normalized["output2"] = [float(pair[0]), float(pair[1])]
    if "scale" in binding:
        if not _is_finite_number(binding["scale"]):
            fail(f"{where}.scale must be a finite number")
            return None
        normalized["scale"] = float(binding["scale"])
    # Digital sources on axis2 actions without output2 contribute [0,0]
    # silently at runtime: reject the typo-class here instead.
    if (
        action_type == "axis2"
        and source in ("key", "button", "gamepad-button")
        and "output2" not in normalized
    ):
        fail(f"{where} needs 'output2' ([x, y]) for axis2 actions")
        return None
    for key in binding:
        if key not in ("source", "code", "axis", "output", "output2", "scale"):
            fail(f"{where} unknown key '{key}'")
            return None
    return normalized


def _validate_audio(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """AudioSource voice specs pass straight to the QA runner (objSpec.audio).

    Returns the normalized spec, or None when malformed. clipId is required
    (clips auto-register headless); volume is 0..1; unknown keys rejected.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("spawn 'audio' must be an object with at least a clipId")
        return None
    clip_id = value.get("clipId")
    if not isinstance(clip_id, str) or not clip_id.strip():
        fail("spawn audio 'clipId' must be a non-empty string")
        return None
    normalized: Dict[str, Any] = {"clipId": clip_id.strip()}
    if "bus" in value:
        if not isinstance(value["bus"], str) or not value["bus"].strip():
            fail("spawn audio 'bus' must be a non-empty string")
            return None
        normalized["bus"] = value["bus"].strip()
    if "volume" in value:
        if not _is_finite_number(value["volume"]) or not 0 <= value["volume"] <= 1:
            fail("spawn audio 'volume' must be 0..1")
            return None
        normalized["volume"] = float(value["volume"])
    for flag in ("loop", "playOnStart", "spatial"):
        if flag in value:
            if not isinstance(value[flag], bool):
                fail(f"spawn audio '{flag}' must be true/false")
                return None
            normalized[flag] = value[flag]
    for dist in ("refDistance", "maxDistance"):
        if dist in value:
            if not _is_finite_number(value[dist]) or value[dist] <= 0:
                fail(f"spawn audio '{dist}' must be positive")
                return None
            normalized[dist] = float(value[dist])
    for key in value:
        if key not in (
            "clipId",
            "bus",
            "volume",
            "loop",
            "playOnStart",
            "spatial",
            "refDistance",
            "maxDistance",
        ):
            fail(f"unknown spawn audio key '{key}'")
            return None
    return normalized


def _validate_lightrig(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Lighting rig specs pass straight to the QA runner (spec.lightrig).

    Returns the normalized spec, or None when malformed. Probes need
    positions (radius optional); LUT needs a valid size/amount with
    preset or matching data; bakeAmbient is a flag.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("lightrig 'config' must be an object")
        return None
    normalized: Dict[str, Any] = {}
    raw_probes = value.get("probes", [])
    if not isinstance(raw_probes, list):
        fail("lightrig config 'probes' must be an array")
        return None
    probes: List[Dict[str, Any]] = []
    for i, probe in enumerate(raw_probes):
        if not isinstance(probe, dict):
            fail(f"lightrig probes[{i}] must be an object")
            return None
        position = probe.get("position")
        if (
            not isinstance(position, (list, tuple))
            or len(position) != 3
            or not all(_is_finite_number(v) for v in position)
        ):
            fail(f"lightrig probes[{i}].position must be 3 finite numbers")
            return None
        entry: Dict[str, Any] = {"position": [float(v) for v in position]}
        if "radius" in probe:
            if not _is_finite_number(probe["radius"]) or probe["radius"] <= 0:
                fail(f"lightrig probes[{i}].radius must be positive")
                return None
            entry["radius"] = float(probe["radius"])
        for key in probe:
            if key not in ("position", "radius"):
                fail(f"lightrig probes[{i}] unknown key '{key}'")
                return None
        probes.append(entry)
    normalized["probes"] = probes
    if "lut" in value:
        lut = _validate_lut(value["lut"], errors)
        if lut is None:
            return None
        normalized["lut"] = lut
    if "bakeAmbient" in value:
        if not isinstance(value["bakeAmbient"], bool):
            fail("lightrig config 'bakeAmbient' must be true/false")
            return None
        normalized["bakeAmbient"] = value["bakeAmbient"]
    for key in value:
        if key not in ("probes", "lut", "bakeAmbient"):
            fail(f"unknown lightrig config key '{key}'")
            return None
    return normalized


def _validate_lut(value: Any, errors: Optional[List[str]]) -> Optional[Dict[str, Any]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("lightrig 'lut' must be an object")
        return None
    normalized: Dict[str, Any] = {}
    size = value.get("size", 32)
    if (
        isinstance(size, bool)
        or not isinstance(size, (int, float))
        or int(size) != size
        or size < 2
    ):
        fail("lightrig lut 'size' must be an integer >= 2")
        return None
    normalized["size"] = int(size)
    amount = value.get("amount", 1.0)
    if not _is_finite_number(amount) or not 0 <= amount <= 1:
        fail("lightrig lut 'amount' must be 0..1")
        return None
    normalized["amount"] = float(amount)
    if "preset" in value:
        if value["preset"] not in ("neutral", "sunset"):
            fail("lightrig lut 'preset' must be neutral|sunset")
            return None
        normalized["preset"] = value["preset"]
    if "data" in value:
        data = value["data"]
        if not isinstance(data, list) or len(data) != normalized["size"] ** 3 * 3:
            fail(
                f"lightrig lut 'data' must hold size^3*3 numbers "
                f"({normalized['size'] ** 3 * 3} for size {normalized['size']})"
            )
            return None
        normalized["data"] = [float(v) for v in data]
    for key in value:
        if key not in ("size", "amount", "preset", "data"):
            fail(f"unknown lightrig lut key '{key}'")
            return None
    return normalized


def _apply_lightrig(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    config = _validate_lightrig(action.get("config"), reasons)
    if config is None:
        detail = reasons[0] if reasons else "malformed config"
        return _outcome(
            result, index, "lightrig", "invalid", f"lightrig config rejected — {detail}"
        )
    scene["lightrig"] = config
    _outcome(
        result,
        index,
        "lightrig",
        "applied",
        f"Registered lightrig ({len(config['probes'])} probe(s)"
        + (" + LUT" if "lut" in config else "")
        + ")",
    )


def _validate_navgrid(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Walkability grid specs pass straight to the QA runner (spec.navgrid).

    Returns the normalized spec, or None when malformed. Obstacles are
    {x, z, hx, hz} world-space footprints baked with agent-radius erosion.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("navgrid 'config' must be an object")
        return None
    normalized: Dict[str, Any] = {}
    for dim in ("width", "height"):
        size = value.get(dim, 32)
        if (
            isinstance(size, bool)
            or not isinstance(size, (int, float))
            or int(size) != size
            or not 2 <= size <= 256
        ):
            fail(f"navgrid config '{dim}' must be an integer 2..256")
            return None
        normalized[dim] = int(size)
    for numkey, floor, default in (
        ("cellSize", 0, 1.0),
        ("originX", None, 0.0),
        ("originZ", None, 0.0),
        ("agentRadius", 0, 0.4),
        ("minHeight", 0, 2.0),
    ):
        raw = value.get(numkey, default)
        if (
            not _is_finite_number(raw)
            or (floor is not None and raw < floor)
            or (numkey == "cellSize" and raw <= 0)
        ):
            fail(f"navgrid config '{numkey}' must be a valid number")
            return None
        normalized[numkey] = float(raw)
    raw_obstacles = value.get("obstacles", [])
    if not isinstance(raw_obstacles, list):
        fail("navgrid config 'obstacles' must be an array")
        return None
    obstacles: List[Dict[str, Any]] = []
    for i, o in enumerate(raw_obstacles):
        if not isinstance(o, dict):
            fail(f"navgrid obstacles[{i}] must be an object")
            return None
        entry: Dict[str, Any] = {}
        for axis in ("x", "z"):
            if not _is_finite_number(o.get(axis)):
                fail(f"navgrid obstacles[{i}].{axis} must be finite")
                return None
            entry[axis] = float(o[axis])
        for half in ("hx", "hz"):
            if not _is_finite_number(o.get(half)) or o[half] < 0:
                fail(f"navgrid obstacles[{i}].{half} must be >= 0")
                return None
            entry[half] = float(o[half])
        obstacles.append(entry)
    normalized["obstacles"] = obstacles
    for key in value:
        if key not in (
            "width",
            "height",
            "cellSize",
            "originX",
            "originZ",
            "agentRadius",
            "minHeight",
            "obstacles",
        ):
            fail(f"unknown navgrid config key '{key}'")
            return None
    return normalized


def _validate_nav(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """NavAgent specs pass straight to the QA runner (objSpec.nav)."""

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("spawn 'nav' must be an object with at least a target")
        return None
    target = value.get("target")
    if (
        not isinstance(target, (list, tuple))
        or len(target) != 2
        or not all(_is_finite_number(v) for v in target)
    ):
        fail("spawn nav 'target' must be a finite [x, z] pair")
        return None
    normalized: Dict[str, Any] = {"target": [float(target[0]), float(target[1])]}
    options: Dict[str, Any] = {}
    for numkey, floor in (
        ("speed", 0),
        ("radius", 0),
        ("arriveRadius", 0),
        ("waypointRadius", 0),
        ("separationWeight", 0),
        ("separationRadius", 0),
        ("brakeRadius", 0),
    ):
        if numkey in value:
            if not _is_finite_number(value[numkey]) or value[numkey] < floor:
                fail(f"spawn nav '{numkey}' must be >= {floor}")
                return None
            options[numkey] = float(value[numkey])
    if "links" in value:
        if not isinstance(value["links"], list):
            fail("spawn nav 'links' must be an array")
            return None
        links: List[Dict[str, Any]] = []
        for i, link in enumerate(value["links"]):
            if not isinstance(link, dict):
                fail(f"spawn nav links[{i}] must be an object")
                return None
            entry_l: Dict[str, Any] = {}
            for endpoint in ("ax", "az", "bx", "bz"):
                if not _is_finite_number(link.get(endpoint)):
                    fail(f"spawn nav links[{i}].{endpoint} must be finite")
                    return None
                entry_l[endpoint] = float(link[endpoint])
            if "radius" in link:
                if not _is_finite_number(link["radius"]) or link["radius"] <= 0:
                    fail(f"spawn nav links[{i}].radius must be positive")
                    return None
                entry_l["radius"] = float(link["radius"])
            if "traverseTime" in link:
                if (
                    not _is_finite_number(link["traverseTime"])
                    or link["traverseTime"] <= 0
                ):
                    fail(f"spawn nav links[{i}].traverseTime must be positive")
                    return None
                entry_l["traverseTime"] = float(link["traverseTime"])
            links.append(entry_l)
        if links:
            options["links"] = links
    if options:
        normalized["options"] = options
    for key in value:
        if key not in (
            "target",
            "speed",
            "radius",
            "arriveRadius",
            "waypointRadius",
            "separationWeight",
            "separationRadius",
            "brakeRadius",
            "links",
        ):
            fail(f"unknown spawn nav key '{key}'")
            return None
    return normalized


def _apply_navgrid(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    config = _validate_navgrid(action.get("config"), reasons)
    if config is None:
        detail = reasons[0] if reasons else "malformed config"
        return _outcome(
            result, index, "navgrid", "invalid", f"navgrid config rejected — {detail}"
        )
    scene["navgrid"] = config
    _outcome(
        result,
        index,
        "navgrid",
        "applied",
        f"Registered navgrid {config['width']}x{config['height']} "
        f"({len(config['obstacles'])} obstacle(s))",
    )


def _validate_mixer(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Mixer specs pass straight to the QA runner (spec.mixer)."""

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("mixer 'config' must be an object with buses/duckRules/snapshots")
        return None
    normalized: Dict[str, Any] = {}
    raw_buses = value.get("buses", {})
    if not isinstance(raw_buses, dict):
        fail("mixer config 'buses' must be a name->spec map")
        return None
    buses: Dict[str, Any] = {}
    for name, spec in raw_buses.items():
        if not isinstance(name, str) or not name.strip() or not isinstance(spec, dict):
            fail(f"mixer bus {name!r} must be an object")
            return None
        entry: Dict[str, Any] = {}
        if "gainDb" in spec:
            if not _is_finite_number(spec["gainDb"]):
                fail(f"mixer bus '{name}'.gainDb must be finite")
                return None
            entry["gainDb"] = float(spec["gainDb"])
        for flag in ("mute", "solo"):
            if flag in spec:
                if not isinstance(spec[flag], bool):
                    fail(f"mixer bus '{name}'.{flag} must be true/false")
                    return None
                entry[flag] = spec[flag]
        if "send" in spec:
            if not isinstance(spec["send"], str) or not spec["send"].strip():
                fail(f"mixer bus '{name}'.send must be a non-empty bus name")
                return None
            entry["send"] = spec["send"].strip()
        for key in spec:
            if key not in ("gainDb", "mute", "solo", "send"):
                fail(f"mixer bus '{name}' unknown key '{key}'")
                return None
        buses[name.strip()] = entry
    # Send targets must exist; cycles rejected (engine throws otherwise).
    for name, entry in buses.items():
        send = entry.get("send")
        if send is not None and send != "master" and send not in buses:
            fail(f"mixer bus '{name}'.send names unknown bus '{send}'")
            return None
    seen_cycle: set = set()

    def visits(start: str, trail: set) -> bool:
        current: Optional[str] = start
        while current is not None and current != "master":
            if current in trail:
                return True
            trail.add(current)
            target = buses.get(current, {}).get("send")
            current = target
        return False

    for name in buses:
        if visits(name, set()):
            fail(f"mixer bus send cycle involving '{name}'")
            return None
        seen_cycle.add(name)
    if buses:
        normalized["buses"] = buses
    raw_ducks = value.get("duckRules", [])
    if not isinstance(raw_ducks, list):
        fail("mixer config 'duckRules' must be an array")
        return None
    ducks: List[Dict[str, Any]] = []
    known = set(buses) | {"master"}
    for i, rule in enumerate(raw_ducks):
        if not isinstance(rule, dict):
            fail(f"mixer duckRules[{i}] must be an object")
            return None
        for endpoint in ("trigger", "target"):
            ref = rule.get(endpoint)
            if not isinstance(ref, str) or ref not in known:
                fail(f"mixer duckRules[{i}].{endpoint} must name a defined bus")
                return None
        entry_r: Dict[str, Any] = {"trigger": rule["trigger"], "target": rule["target"]}
        if "depthDb" in rule:
            if not _is_finite_number(rule["depthDb"]):
                fail(f"mixer duckRules[{i}].depthDb must be finite")
                return None
            entry_r["depthDb"] = float(rule["depthDb"])
        for timing in ("attack", "release"):
            if timing in rule:
                if not _is_finite_number(rule[timing]) or rule[timing] <= 0:
                    fail(f"mixer duckRules[{i}].{timing} must be positive")
                    return None
                entry_r[timing] = float(rule[timing])
        for key in rule:
            if key not in ("trigger", "target", "depthDb", "attack", "release"):
                fail(f"mixer duckRules[{i}] unknown key '{key}'")
                return None
        ducks.append(entry_r)
    if ducks:
        normalized["duckRules"] = ducks
    raw_snaps = value.get("snapshots", {})
    if not isinstance(raw_snaps, dict):
        fail("mixer config 'snapshots' must be a name->gains map")
        return None
    snaps: Dict[str, Any] = {}
    for snap_name, gains in raw_snaps.items():
        if (
            not isinstance(snap_name, str)
            or not snap_name.strip()
            or not isinstance(gains, dict)
            or not gains
        ):
            fail(f"mixer snapshot {snap_name!r} must be a non-empty bus->dB map")
            return None
        clean: Dict[str, float] = {}
        for bus_name, db in gains.items():
            if bus_name not in known or not _is_finite_number(db):
                fail(f"mixer snapshot '{snap_name}' needs defined buses with finite dB")
                return None
            clean[bus_name] = float(db)
        snaps[snap_name.strip()] = clean
    if snaps:
        normalized["snapshots"] = snaps
    if not normalized:
        fail("mixer config must define at least one of buses/duckRules/snapshots")
        return None
    for key in value:
        if key not in ("buses", "duckRules", "snapshots"):
            fail(f"unknown mixer config key '{key}'")
            return None
    return normalized


def _apply_mixer(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    config = _validate_mixer(action.get("config"), reasons)
    if config is None:
        detail = reasons[0] if reasons else "malformed config"
        return _outcome(
            result, index, "mixer", "invalid", f"mixer config rejected — {detail}"
        )
    scene["mixer"] = config
    parts = []
    if "buses" in config:
        parts.append(f"{len(config['buses'])} bus(es)")
    if "duckRules" in config:
        parts.append(f"{len(config['duckRules'])} duck rule(s)")
    if "snapshots" in config:
        parts.append(f"{len(config['snapshots'])} snapshot(s)")
    _outcome(
        result, index, "mixer", "applied", f"Registered mixer ({', '.join(parts)})"
    )


def _validate_inputmap(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Input map specs pass straight to the QA runner (spec.inputmap)."""

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("input 'map' must be an object with an actions map")
        return None
    raw_actions = value.get("actions")
    if not isinstance(raw_actions, dict) or not raw_actions:
        fail("input map 'actions' must be a non-empty name->spec map")
        return None
    actions: Dict[str, Any] = {}
    for name, spec in raw_actions.items():
        if not isinstance(name, str) or not name.strip() or not isinstance(spec, dict):
            fail(f"input action {name!r} must be an object")
            return None
        atype = spec.get("type")
        if atype not in INPUT_ACTION_TYPES:
            fail(
                f"input action '{name}'.type must be one of {sorted(INPUT_ACTION_TYPES)}"
            )
            return None
        entry: Dict[str, Any] = {"type": atype}
        if "deadzone" in spec:
            if not _is_finite_number(spec["deadzone"]) or spec["deadzone"] < 0:
                fail(f"input action '{name}'.deadzone must be >= 0")
                return None
            entry["deadzone"] = float(spec["deadzone"])
        raw_bindings = spec.get("bindings")
        if not isinstance(raw_bindings, list) or not raw_bindings:
            fail(f"input action '{name}'.bindings must be a non-empty array")
            return None
        bindings = []
        for i, b in enumerate(raw_bindings):
            checked = _validate_input_binding(
                b, atype, f"input action '{name}'.bindings[{i}]", errors
            )
            if checked is None:
                return None
            bindings.append(checked)
        entry["bindings"] = bindings
        actions[name] = entry
    normalized: Dict[str, Any] = {"actions": actions}
    for key in value:
        if key not in ("actions",):
            fail(f"unknown input map key '{key}' (allowed: actions)")
            return None
    return normalized


def _validate_input_script(
    value: Any, action_names: set, errors: Optional[List[str]]
) -> Optional[List[Dict[str, Any]]]:
    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if value is None:
        return []
    if not isinstance(value, list):
        fail("input 'script' must be an array of {action, value, start, frames}")
        return None
    script: List[Dict[str, Any]] = []
    for i, entry in enumerate(value):
        if not isinstance(entry, dict):
            fail(f"input script[{i}] must be an object")
            return None
        action = entry.get("action")
        if action not in action_names:
            fail(f"input script[{i}].action must name a mapped action (got {action!r})")
            return None
        step: Dict[str, Any] = {"action": action}
        item = entry.get("value", True)
        if isinstance(item, bool):
            step["value"] = item
        elif _is_finite_number(item):
            step["value"] = float(item)
        elif (
            isinstance(item, dict)
            and _is_finite_number(item.get("x"))
            and _is_finite_number(item.get("y"))
        ):
            step["value"] = {"x": float(item["x"]), "y": float(item["y"])}
        else:
            fail(f"input script[{i}].value must be bool, number, or {{x, y}}")
            return None
        for numkey, floor in (("start", 0), ("frames", 1)):
            num = entry.get(numkey, floor if numkey == "frames" else 0)
            if (
                isinstance(num, bool)
                or not isinstance(num, (int, float))
                or int(num) != num
                or num < floor
            ):
                fail(f"input script[{i}].{numkey} must be an integer >= {floor}")
                return None
            step[numkey] = int(num)
        script.append(step)
    return script


def _apply_input(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    game_map = _validate_inputmap(action.get("map"), reasons)
    if game_map is None:
        detail = reasons[0] if reasons else "malformed map"
        return _outcome(
            result, index, "input", "invalid", f"input map rejected — {detail}"
        )
    script = _validate_input_script(
        action.get("script"), set(game_map["actions"]), reasons
    )
    if script is None:
        detail = reasons[0] if reasons else "malformed script"
        return _outcome(
            result, index, "input", "invalid", f"input script rejected — {detail}"
        )
    scene["inputmap"] = game_map
    if script:
        scene["inputScript"] = script
    elif "inputScript" in scene:
        del scene["inputScript"]
    _outcome(
        result,
        index,
        "input",
        "applied",
        f"Registered input map ({len(game_map['actions'])} action(s), {len(script)} script step(s))",
    )


def _validate_locale(
    value: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Localization blocks pass straight to the QA runner (spec.localization).

    Returns the normalized {locale, tables}, or None when malformed. Tables
    map locales to key->template string maps (capped at 500 keys per locale
    to keep scenes reviewable); unknown keys are rejected.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(value, dict):
        fail("locale 'config' must be an object with locale/tables")
        return None
    normalized: Dict[str, Any] = {}
    locale = value.get("locale", "en")
    if not isinstance(locale, str) or not locale.strip():
        fail("locale config 'locale' must be a non-empty string")
        return None
    normalized["locale"] = locale.strip()
    tables = value.get("tables")
    if not isinstance(tables, dict) or not tables:
        fail("locale config 'tables' must be a non-empty locale->keys map")
        return None
    normalized_tables: Dict[str, Dict[str, str]] = {}
    for lang, entries in tables.items():
        if (
            not isinstance(lang, str)
            or not lang.strip()
            or not isinstance(entries, dict)
        ):
            fail(f"locale tables[{lang!r}] must map keys to template strings")
            return None
        if len(entries) > 500:
            fail(f"locale tables[{lang!r}] exceeds 500 keys ({len(entries)})")
            return None
        clean: Dict[str, str] = {}
        for key, template in entries.items():
            if (
                not isinstance(key, str)
                or not key.strip()
                or not isinstance(template, str)
            ):
                fail(f"locale tables[{lang!r}] keys and templates must be strings")
                return None
            clean[key.strip()] = template
        normalized_tables[lang.strip()] = clean
    normalized["tables"] = normalized_tables
    for key in value:
        if key not in ("locale", "tables"):
            fail(f"unknown locale config key '{key}' (allowed: locale, tables)")
            return None
    return normalized


def _apply_locale(
    scene: Dict[str, Any], action: Dict[str, Any], result: ApplyResult, index: int
) -> None:
    reasons: List[str] = []
    config = _validate_locale(action.get("config"), reasons)
    if config is None:
        detail = reasons[0] if reasons else "malformed config"
        return _outcome(
            result,
            index,
            "locale",
            "invalid",
            f"locale config rejected — {detail}",
        )
    scene["localization"] = config
    total = sum(len(entries) for entries in config["tables"].values())
    _outcome(
        result,
        index,
        "locale",
        "applied",
        f"Registered localization '{config['locale']}' "
        f"({total} keys across {len(config['tables'])} locale(s))",
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
    "locale": _apply_locale,
    "input": _apply_input,
    "mixer": _apply_mixer,
    "navgrid": _apply_navgrid,
    "lightrig": _apply_lightrig,
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
