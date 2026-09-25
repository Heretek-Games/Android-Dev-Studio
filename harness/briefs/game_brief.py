"""
Game Production Brief (`game_brief.json`) — the machine-checkable production spec.

Every user prompt compiles into one of these before any builder work starts. The
brief pins the fantasy, the world scope, the required systems, the look-dev
contract, the Snapdragon 8 Elite / Android 16 performance contract, and — most
importantly — a binary acceptance matrix across the five axes (Functional,
Playable, Performant, Visually Coherent, Spec-Accurate).

Criteria that carry a `qaRule` in the existing headless-QA vocabulary compile
directly into runner rules; the rest are reported as unautomatable so a critic
(vision model or human) must own them explicitly. Nothing here duplicates the
scenario specs, the invariant gate, or the swarm — it sits above them as the
source of truth the loop judges against.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

VALID_AXES = (
    "Functional",
    "Playable",
    "Performant",
    "Visually Coherent",
    "Spec-Accurate",
)

#: Hard ceilings the hardware contract never permits, regardless of brief overrides.
MAX_DRAW_CALLS_CEILING = 100
MIN_TARGET_FPS = 30


class BriefValidationError(ValueError):
    """Raised when a brief dict violates the schema or the hardware contract."""


def _require_dict(data: Any, name: str) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise BriefValidationError(f"'{name}' must be a JSON object")
    return data


def _require_nonempty_str(data: Dict[str, Any], key: str, context: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise BriefValidationError(f"{context} requires a non-empty '{key}'")
    return value.strip()


def _require_nonnegative_number(data: Dict[str, Any], key: str, context: str) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BriefValidationError(f"{context} requires a numeric '{key}'")
    if value < 0:
        raise BriefValidationError(f"{context} requires '{key}' >= 0 (got {value})")
    return float(value)


@dataclass(frozen=True)
class PerformanceContract:
    """Scalability-tier budgets. Defaults encode the tier-A house profile."""

    deviceProfile: str = "android16-snapdragon8elite"
    tier: str = "A"
    targetFps: int = 60
    maxDrawCalls: int = 100
    maxTrisPerChunk: int = 150000
    maxTrisPerScene: int = 1200000
    maxTextureMb: int = 256
    maxPhysicsBodies: int = 256
    maxApkMb: int = 200
    maxLoadSeconds: float = 8.0

    @staticmethod
    def from_dict(data: Optional[Dict[str, Any]]) -> "PerformanceContract":
        from harness.perf.tiers import resolve_tier

        if data is None:
            return PerformanceContract()
        data = _require_dict(data, "performance")

        tier_id = data.get("tier", "A")
        if not isinstance(tier_id, str):
            raise BriefValidationError("performance 'tier' must be a string")
        try:
            tier = resolve_tier(tier_id)
        except ValueError:
            raise BriefValidationError(
                f"performance tier must be one of S, A, X (got {tier_id!r})"
            )

        def pick(key: str, default: Any) -> Any:
            value = data.get(key, default)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise BriefValidationError(f"performance '{key}' must be numeric")
            return value

        def within_ceiling(key: str, value: float, ceiling: float) -> None:
            if value > ceiling:
                raise BriefValidationError(
                    f"performance {key} must be <= tier {tier_id.strip().upper()} "
                    f"ceiling {ceiling:g} (got {value:g})"
                )

        target_fps = int(pick("targetFps", tier.target_fps))
        if target_fps < MIN_TARGET_FPS:
            raise BriefValidationError(
                f"performance targetFps must be >= {MIN_TARGET_FPS} (got {target_fps})"
            )
        max_draws = int(pick("maxDrawCalls", tier.max_draw_calls))
        within_ceiling("maxDrawCalls", max_draws, tier.max_draw_calls)
        max_tris_chunk = int(pick("maxTrisPerChunk", tier.max_tris_per_chunk))
        within_ceiling("maxTrisPerChunk", max_tris_chunk, tier.max_tris_per_chunk)
        max_tris_scene = int(pick("maxTrisPerScene", tier.max_tris_per_scene))
        within_ceiling("maxTrisPerScene", max_tris_scene, tier.max_tris_per_scene)
        max_tex = int(pick("maxTextureMb", tier.max_texture_mb))
        within_ceiling("maxTextureMb", max_tex, tier.max_texture_mb)
        max_bodies = int(pick("maxPhysicsBodies", tier.max_physics_bodies))
        within_ceiling("maxPhysicsBodies", max_bodies, tier.max_physics_bodies)
        max_apk = float(pick("maxApkMb", tier.max_apk_mb))
        if max_apk <= 0:
            raise BriefValidationError("performance maxApkMb must be positive")
        within_ceiling("maxApkMb", max_apk, tier.max_apk_mb)
        profile = data.get("deviceProfile", "android16-snapdragon8elite")
        if not isinstance(profile, str) or not profile.strip():
            raise BriefValidationError(
                "performance deviceProfile must be a non-empty string"
            )
        return PerformanceContract(
            deviceProfile=profile.strip(),
            tier=tier_id.strip().upper(),
            targetFps=target_fps,
            maxDrawCalls=max_draws,
            maxTrisPerChunk=max_tris_chunk,
            maxTrisPerScene=max_tris_scene,
            maxTextureMb=max_tex,
            maxPhysicsBodies=max_bodies,
            maxApkMb=max_apk,
            maxLoadSeconds=float(pick("maxLoadSeconds", 8.0)),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "deviceProfile": self.deviceProfile,
            "tier": self.tier,
            "targetFps": self.targetFps,
            "maxDrawCalls": self.maxDrawCalls,
            "maxTrisPerChunk": self.maxTrisPerChunk,
            "maxTrisPerScene": self.maxTrisPerScene,
            "maxTextureMb": self.maxTextureMb,
            "maxPhysicsBodies": self.maxPhysicsBodies,
            "maxApkMb": self.maxApkMb,
            "maxLoadSeconds": self.maxLoadSeconds,
        }


@dataclass(frozen=True)
class AcceptanceCriterion:
    id: str
    axis: str
    description: str
    qa_rule: Optional[Dict[str, Any]] = None

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "AcceptanceCriterion":
        data = _require_dict(data, "acceptance criterion")
        criterion_id = _require_nonempty_str(data, "id", "acceptance criterion")
        axis = _require_nonempty_str(data, "axis", f"criterion '{criterion_id}'")
        if axis not in VALID_AXES:
            raise BriefValidationError(
                f"criterion '{criterion_id}' has unknown axis '{axis}' (valid: {list(VALID_AXES)})"
            )
        description = _require_nonempty_str(
            data, "description", f"criterion '{criterion_id}'"
        )
        qa_rule = data.get("qaRule")
        if qa_rule is not None:
            qa_rule = _require_dict(qa_rule, f"criterion '{criterion_id}' qaRule")
            if "type" not in qa_rule:
                raise BriefValidationError(
                    f"criterion '{criterion_id}' qaRule requires a 'type'"
                )
        return AcceptanceCriterion(
            id=criterion_id, axis=axis, description=description, qa_rule=qa_rule
        )

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "id": self.id,
            "axis": self.axis,
            "description": self.description,
        }
        if self.qa_rule is not None:
            out["qaRule"] = dict(self.qa_rule)
        return out


@dataclass(frozen=True)
class GameProductionBrief:
    title: str
    fantasy: Dict[str, Any]
    experience: Dict[str, Any]
    world: Dict[str, Any]
    systems: Dict[str, Any]
    lookdev: Dict[str, Any]
    performance: PerformanceContract = field(default_factory=PerformanceContract)
    acceptance: List[AcceptanceCriterion] = field(default_factory=list)

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "GameProductionBrief":
        data = _require_dict(data, "game brief")
        title = _require_nonempty_str(data, "title", "game brief")
        fantasy = _require_dict(data.get("fantasy"), "fantasy")
        _require_nonempty_str(fantasy, "genre", "fantasy")
        experience = _require_dict(data.get("experience"), "experience")
        world = _require_dict(data.get("world"), "world")
        _require_nonnegative_number(world, "areaKm2", "world")
        streaming = world.get("streamingRadiusM", 120)
        if (
            isinstance(streaming, bool)
            or not isinstance(streaming, (int, float))
            or streaming <= 0
        ):
            raise BriefValidationError(
                "world streamingRadiusM must be a positive number"
            )
        systems = _require_dict(data.get("systems"), "systems")
        lookdev = _require_dict(data.get("lookdev"), "lookdev")

        raw_acceptance = data.get("acceptance", [])
        if not isinstance(raw_acceptance, list) or not raw_acceptance:
            raise BriefValidationError(
                "game brief requires a non-empty 'acceptance' array"
            )
        acceptance = [AcceptanceCriterion.from_dict(item) for item in raw_acceptance]
        seen = set()
        for criterion in acceptance:
            if criterion.id in seen:
                raise BriefValidationError(f"duplicate acceptance id '{criterion.id}'")
            seen.add(criterion.id)

        return GameProductionBrief(
            title=title,
            fantasy=dict(fantasy),
            experience=dict(experience),
            world=dict(world),
            systems=dict(systems),
            lookdev=dict(lookdev),
            performance=PerformanceContract.from_dict(data.get("performance")),
            acceptance=acceptance,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "fantasy": dict(self.fantasy),
            "experience": dict(self.experience),
            "world": dict(self.world),
            "systems": dict(self.systems),
            "lookdev": dict(self.lookdev),
            "performance": self.performance.to_dict(),
            "acceptance": [criterion.to_dict() for criterion in self.acceptance],
        }

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def load(path: Path) -> "GameProductionBrief":
        path = Path(path)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BriefValidationError(
                f"cannot load brief from {path}: {error}"
            ) from error
        return GameProductionBrief.from_dict(data)

    def compile_acceptance_rules(self) -> List[Dict[str, Any]]:
        """Acceptance criteria with qaRule attachments, as headless-QA runner rules."""
        rules = []
        for criterion in self.acceptance:
            if criterion.qa_rule is None:
                continue
            rule = dict(criterion.qa_rule)
            rule.setdefault("id", criterion.id)
            rules.append(rule)
        return rules

    def unautomatable_criteria(self) -> List[AcceptanceCriterion]:
        """Criteria no headless rule covers — a critic must own each one explicitly."""
        return [criterion for criterion in self.acceptance if criterion.qa_rule is None]

    def task_seeds(self) -> List[Dict[str, Any]]:
        """One pending DAG task stub per acceptance criterion for the orchestrator."""
        return [
            {
                "criterionId": criterion.id,
                "axis": criterion.axis,
                "description": criterion.description,
                "status": "pending",
            }
            for criterion in self.acceptance
        ]
