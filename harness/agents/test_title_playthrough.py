"""Scripted playthrough: the full tide victory in stage order (Phase 1, Node P3).

Promotes the tide victory path from a final-verdict gate (`test_title_core.py`)
to a first-class playthrough: one 600-frame headless run of
`harness/config/scenarios/tide_cinder.json` asserted stage by stage IN QUEST
ORDER, each with per-stage evidence taken from the runner's existing rules
array + metrics. The runner's melee driver auto-plays (soft lock-on swings,
boss ticks, quest polling), so the test scripts the *expectations*, not inputs.

Stage order asserted:
  1. blessing   — dialogue visits `blessed`, event `hydro_blessing` fires
  2. wave-1 clear — melee kills reach 2, quest sees `clear_hall`
  3. tyrant fights back — boss telegraph strikes >= 1
  4. tyrant slain — melee kills reach 3
  5. quest      — 5/5 stages complete, seen in order
  6. victory    — phase `won`

Negative control: the same spec minus the tyrant loses ONLY the telegraph
signature (strikes=0) while the kill-counted chain still completes — proving
the encounter resolves its boss, not the clock.

Time-series ordering: `report["questTimeline"]` (transition-only stage/wave
event list from the runner) pins the quest order to wall-clock frames, so
`test_victory_timeline_ordered_in_frame_order` asserts the true series
(audience <= blessing <= clear_hall <= slay_tyrant <= victory) instead of
end-state consistency alone. The pre-existing `seen=[...]` order assertion is
kept as a cheap cross-check.

Run from the repository root:
    python3 -m unittest harness.agents.test_title_playthrough
"""

import copy
import json
import re
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/tide_cinder.json"
FRAMES = ("--frames", "600", "--traverse")

EXPECTED_STAGE_ORDER = [
    "audience",
    "blessing",
    "clear_hall",
    "slay_tyrant",
    "victory",
]


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


def load_playthrough_spec():
    """tide spec plus same-run checkpoint rules for the intermediate stages.

    The base spec only gates the final thresholds (kills 3, strikes 1); the
    checkpoints pin the wave-1 kill floor (2) and boss-wave arrival (wave 2)
    so the playthrough asserts every stage, not just the finale.
    """
    spec = load_spec()
    spec["rules"] = list(spec.get("rules", [])) + [
        {"id": "wave1_cleared", "type": "game_melee_kills_min", "min": 2},
        {"id": "boss_wave_reached", "type": "game_wave_reached", "wave": 2},
    ]
    return spec


def run_spec(spec):
    proc = run_scenario(spec, extra_args=FRAMES)
    assert proc.returncode in (0, 1), proc.stderr[:500]
    return json.loads(proc.stdout)


def by_id(report):
    return {r["id"]: r for r in report.get("rules", [])}


def first_int(detail, pattern):
    match = re.search(pattern, detail)
    assert match is not None, detail
    return int(match.group(1))


class TidePlaythroughTests(unittest.TestCase):
    def test_full_quest_victory_in_stage_order(self):
        report = run_spec(load_playthrough_spec())
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        rules = by_id(report)

        with self.subTest(stage="1-blessing-dialogue"):
            reached = rules["blessing_reached"]
            fired = rules["blessing_fired"]
            self.assertTrue(reached["pass"], reached)
            self.assertTrue(fired["pass"], fired)
            self.assertIn("greet -> blessed -> farewell", reached["detail"])
            self.assertIn("hydro_blessing", fired["detail"])

        with self.subTest(stage="2-wave1-cleared"):
            wave1 = rules["wave1_cleared"]
            self.assertTrue(wave1["pass"], wave1)
            kills = first_int(wave1["detail"], r"melee kills=(\d+)")
            self.assertGreaterEqual(kills, 2, wave1["detail"])
            stages = rules["quest_stages"]
            self.assertIn("clear_hall", stages["detail"], stages)

        with self.subTest(stage="3-tyrant-fights-back"):
            boss_wave = rules["boss_wave_reached"]
            self.assertTrue(boss_wave["pass"], boss_wave)
            live = rules["boss_telegraphs_live"]
            self.assertTrue(live["pass"], live)
            strikes = first_int(live["detail"], r"strikes=(\d+)")
            self.assertGreaterEqual(strikes, 1, live["detail"])

        with self.subTest(stage="4-tyrant-slain"):
            slain = rules["tyrant_slain"]
            self.assertTrue(slain["pass"], slain)
            kills = first_int(slain["detail"], r"melee kills=(\d+)")
            self.assertGreaterEqual(kills, 3, slain["detail"])

        with self.subTest(stage="5-quest-complete-5-of-5"):
            self.assertTrue(rules["quest_done"]["pass"], rules["quest_done"])
            stages = rules["quest_stages"]
            self.assertTrue(stages["pass"], stages)
            count = first_int(stages["detail"], r"quest stages=(\d+)")
            self.assertEqual(count, 5, stages["detail"])
            seen = re.search(r"seen=\[(.*?)\]", stages["detail"])
            self.assertIsNotNone(seen, stages["detail"])
            seen_order = [s.strip() for s in seen.group(1).split(",")]
            self.assertEqual(seen_order, EXPECTED_STAGE_ORDER, stages["detail"])

        with self.subTest(stage="6-victory-phase-won"):
            won = rules["run_won"]
            self.assertTrue(won["pass"], won)
            self.assertIn("phase=won", won["detail"], won)

    def test_victory_timeline_ordered_in_frame_order(self):
        """True time-series ordering from the runner's questTimeline.

        Uses ONLY report["questTimeline"] (transition-only event list, not
        per-frame spam): every expected stage appears exactly once with
        audience <= blessing <= clear_hall <= slay_tyrant <= victory in
        wall-clock frame order, and spawner waves never decrease.
        """
        report = run_spec(load_playthrough_spec())
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        timeline = report.get("questTimeline")
        self.assertIsNotNone(timeline, "runner must expose report.questTimeline")
        stages = timeline.get("stages", [])
        waves = timeline.get("waves", [])

        with self.subTest(check="timeline-stays-small"):
            total_entries = len(stages) + len(waves)
            self.assertLess(
                total_entries,
                64,
                f"transition-only timeline must stay small, got {total_entries}: {timeline}",
            )

        with self.subTest(check="stages-monotonic-frames"):
            frames = [entry["frame"] for entry in stages]
            self.assertEqual(
                frames,
                sorted(frames),
                f"stage frames must be non-decreasing: {stages}",
            )

        with self.subTest(check="quest-order-in-frame-order"):
            first_frame = {}
            for entry in stages:
                first_frame.setdefault(entry["stage"], entry["frame"])
            for stage in EXPECTED_STAGE_ORDER:
                self.assertIn(stage, first_frame, f"stage {stage!r} missing: {stages}")
            ordered = [first_frame[s] for s in EXPECTED_STAGE_ORDER]
            self.assertEqual(
                ordered,
                sorted(ordered),
                f"audience <= blessing <= clear_hall <= slay_tyrant <= victory "
                f"in frame order, got {dict(zip(EXPECTED_STAGE_ORDER, ordered))}",
            )

        with self.subTest(check="waves-non-decreasing"):
            self.assertGreaterEqual(len(waves), 1, "wave timeline must seed frame 0")
            self.assertEqual(waves[0]["frame"], 0)
            wave_frames = [entry["frame"] for entry in waves]
            self.assertEqual(wave_frames, sorted(wave_frames), waves)
            wave_ids = [entry["wave"] for entry in waves]
            self.assertEqual(wave_ids, sorted(wave_ids), waves)
            self.assertGreaterEqual(max(wave_ids), 2, waves)

    def test_no_tyrant_timeline_missing_boss_stages(self):
        """Negative probe: without the tyrant the timeline stays sensible.

        Single-enemy waves can never reach the 3-kill `slay_tyrant` gate, so
        the boss-dependent stages (`slay_tyrant`, `victory`) are absent while
        the reachable chain still records in frame order and waves still
        advance monotonically.
        """
        spec = copy.deepcopy(load_spec())
        spec["game"].pop("boss", None)
        spec["game"]["enemiesPerWave"] = 1
        report = run_spec(spec)
        timeline = report.get("questTimeline")
        self.assertIsNotNone(timeline, "runner must expose report.questTimeline")
        stages = timeline.get("stages", [])
        waves = timeline.get("waves", [])

        total_entries = len(stages) + len(waves)
        self.assertLess(total_entries, 64, timeline)

        seen = [entry["stage"] for entry in stages]
        for stage in ("audience", "blessing", "clear_hall"):
            self.assertIn(stage, seen, stages)
        for stage in ("slay_tyrant", "victory"):
            self.assertNotIn(stage, seen, stages)
        frames = [entry["frame"] for entry in stages]
        self.assertEqual(frames, sorted(frames), stages)

        self.assertGreaterEqual(len(waves), 1)
        wave_ids = [entry["wave"] for entry in waves]
        self.assertEqual(wave_ids, sorted(wave_ids), waves)

    def test_no_tyrant_control_loses_telegraph_signature(self):
        spec = copy.deepcopy(load_spec())
        spec["game"].pop("boss", None)
        spec["game"]["enemiesPerWave"] = 2
        report = run_spec(spec)
        rules = by_id(report)

        # The encounter no longer fights back: zero telegraph strikes, and the
        # run fails SOLELY on the boss-signature rule.
        live = rules["boss_telegraphs_live"]
        self.assertFalse(live["pass"], live)
        self.assertIn("strikes=0", live["detail"], live)
        self.assertEqual(report.get("verdict"), "FAILED", report)
        failed = [r["id"] for r in report.get("rules", []) if not r["pass"]]
        self.assertEqual(failed, ["boss_telegraphs_live"], failed)

        # The kill-counted chain still completes without the tyrant, so the
        # control isolates the boss signature rather than a general stall.
        for rid in ("blessing_reached", "blessing_fired", "quest_done", "run_won"):
            self.assertTrue(rules[rid]["pass"], rules[rid])


if __name__ == "__main__":
    unittest.main()
