"""Scalability tiers S/A/X with automatic fallback (Track 0).

Replaces the single-device performance contract with potency tiers spanning
low mobile / integrated GPUs (S) through the Snapdragon 8 Elite baseline (A)
to discrete desktop GPUs (X). Briefs name a tier; budgets are validated
against that tier's ceilings. When a run misses its frame budget, the
fallback ladder sheds load in order without touching gameplay.

Tier A encodes the original house profile exactly, so existing briefs
validate unchanged.
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple

TIER_IDS = ("S", "A", "X")


@dataclass(frozen=True)
class TierSpec:
    """Per-tier hardware budgets (the contract a brief in this tier must fit)."""

    label: str
    target_fps: int
    max_draw_calls: int
    max_tris_per_chunk: int
    max_tris_per_scene: int
    max_texture_mb: int
    max_physics_bodies: int
    max_apk_mb: int


TIERS: Dict[str, TierSpec] = {
    "S": TierSpec(
        label="low mobile / integrated GPU",
        target_fps=30,
        max_draw_calls=60,
        max_tris_per_chunk=60000,
        max_tris_per_scene=500000,
        max_texture_mb=128,
        max_physics_bodies=128,
        max_apk_mb=150,
    ),
    "A": TierSpec(
        label="Snapdragon 8 Elite baseline",
        target_fps=60,
        max_draw_calls=100,
        max_tris_per_chunk=150000,
        max_tris_per_scene=1200000,
        max_texture_mb=256,
        max_physics_bodies=256,
        max_apk_mb=200,
    ),
    "X": TierSpec(
        label="discrete desktop GPU",
        target_fps=60,
        max_draw_calls=200,
        max_tris_per_chunk=400000,
        max_tris_per_scene=4000000,
        max_texture_mb=1024,
        max_physics_bodies=1024,
        max_apk_mb=500,
    ),
}

#: Ordered load-shedding steps applied when a tier misses its frame budget.
#: Gameplay is never touched — only resolution, LOD bias, and effects.
FALLBACK_LADDER: Tuple[str, ...] = (
    "render-scale 0.8",
    "lod-bias +1",
    "post off",
    "shadows off",
    "render-scale 0.6",
)


def resolve_tier(tier_id: str) -> TierSpec:
    """Return the TierSpec for a tier id (case-insensitive, whitespace-tolerant)."""
    key = (tier_id or "").strip().upper()
    if key not in TIERS:
        raise ValueError(
            f"unknown scalability tier '{tier_id}' (allowed: {list(TIER_IDS)})"
        )
    return TIERS[key]


def fallback_plan(failures: int) -> List[str]:
    """Load-shedding steps for N consecutive missed-budget frames (capped)."""
    if failures <= 0:
        return []
    return list(FALLBACK_LADDER[: min(failures, len(FALLBACK_LADDER))])
