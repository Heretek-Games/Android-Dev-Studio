"""Unit tests for scalability tiers S/A/X (Track 0).

Run from the repository root:
    python3 -m unittest harness.perf.test_tiers
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.briefs.game_brief import (  # noqa: E402
    BriefValidationError,
    GameProductionBrief,
    PerformanceContract,
)
from harness.perf.tiers import FALLBACK_LADDER, TIERS, fallback_plan, resolve_tier  # noqa: E402


def perf_block(**overrides):
    block = {
        "deviceProfile": "test-device",
        "targetFps": 60,
        "maxDrawCalls": 100,
        "maxTrisPerChunk": 150000,
        "maxTrisPerScene": 1200000,
        "maxTextureMb": 256,
        "maxPhysicsBodies": 256,
        "maxApkMb": 200,
    }
    block.update(overrides)
    return block


class TierTests(unittest.TestCase):
    def test_tier_a_encodes_the_house_profile(self):
        tier = resolve_tier("A")
        self.assertEqual(tier.target_fps, 60)
        self.assertEqual(tier.max_draw_calls, 100)
        self.assertEqual(tier.max_texture_mb, 256)

    def test_resolve_is_case_insensitive(self):
        self.assertIs(resolve_tier("s"), TIERS["S"])
        self.assertIs(resolve_tier(" x "), TIERS["X"])

    def test_resolve_rejects_unknown(self):
        with self.assertRaises(ValueError):
            resolve_tier("Z")

    def test_fallback_ladder_caps_and_empties(self):
        self.assertEqual(fallback_plan(0), [])
        self.assertEqual(fallback_plan(2), list(FALLBACK_LADDER[:2]))
        self.assertEqual(fallback_plan(99), list(FALLBACK_LADDER))
        # Gameplay never touched: ladder is resolution/LOD/effects only.
        joined = " ".join(FALLBACK_LADDER).lower()
        for word in ("gameplay", "physics", "ai ", "spawn"):
            self.assertNotIn(word, joined)

    def test_default_contract_is_tier_a(self):
        contract = PerformanceContract.from_dict(perf_block())
        self.assertEqual(contract.tier, "A")

    def test_tier_s_rejects_house_budgets(self):
        with self.assertRaises(BriefValidationError):
            PerformanceContract.from_dict(perf_block(tier="S"))

    def test_tier_s_accepts_small_budgets(self):
        contract = PerformanceContract.from_dict(
            perf_block(
                tier="S",
                targetFps=30,
                maxDrawCalls=60,
                maxTextureMb=128,
                maxPhysicsBodies=128,
                maxApkMb=150,
                maxTrisPerChunk=60000,
                maxTrisPerScene=500000,
            )
        )
        self.assertEqual(contract.tier, "S")

    def test_tier_x_allows_bigger_budgets(self):
        contract = PerformanceContract.from_dict(
            perf_block(tier="X", maxDrawCalls=200, maxTextureMb=1024)
        )
        self.assertEqual(contract.tier, "X")
        self.assertEqual(contract.maxDrawCalls, 200)

    def test_unknown_tier_rejected(self):
        with self.assertRaises(BriefValidationError):
            PerformanceContract.from_dict(perf_block(tier="Q"))

    def test_existing_briefs_still_validate(self):
        for name in (
            "harness/briefs/examples/island_collection_quest.json",
            "harness/briefs/examples/arena_defense.json",
            "harness/briefs/examples/checkpoint_keep.json",
        ):
            brief = GameProductionBrief.load(name)
            self.assertEqual(brief.performance.tier, "A")


if __name__ == "__main__":
    unittest.main()
