"""Unit tests for the emulator smoke-test assertion logic (pure, no device).

Run from the repository root:
    python3 -m unittest harness.agents.test_emulator_smoke
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.agents.emulator_smoke import (  # noqa: E402
    check_frame_pixels,
    check_tier1_logcat,
    check_tier2_logcat,
    frame_stats,
    parse_ppm,
)

GOOD_TIER2 = [
    "I HeretekTier2: Scene ready — draws=67 instances=0 terrainLeaves=64 terrainVertices=69696",
    "I HeretekTier2: swapchain created: 0x7f001234",
    "I HeretekTier2: Surface ready (2400x1080) — swapchain + pipelines created",
    "I HeretekTier2: surfaceCreated 2400x1080 — frame loop: true",
    "I HeretekTier2: frame 0 presented",
    "I HeretekTier2: renderFrame status: acquire=0 submit=0 present=0 capture=0",
    "I HeretekTier2: frame 300 presented",
]


def ppm(width=640, height=480, colors=None):
    if colors is None:
        # A gradient with many distinct colors (a realistic rendered frame).
        colors = tuple((i * 13 % 256, i * 7 % 256, i * 3 % 256) for i in range(32))
    header = f"P6\n{width} {height}\n255\n".encode()
    payload = bytearray()
    for index in range(width * height):
        payload.extend(colors[index % len(colors)])
    return header + bytes(payload)


class Tier2LogcatTests(unittest.TestCase):
    def test_good_logcat_passes(self):
        self.assertEqual(check_tier2_logcat(GOOD_TIER2), [])

    def test_missing_scene_line(self):
        lines = [line for line in GOOD_TIER2 if "Scene ready" not in line]
        failures = check_tier2_logcat(lines)
        self.assertTrue(any("Scene ready" in f for f in failures))

    def test_zero_terrain_leaves(self):
        lines = [
            "I HeretekTier2: Scene ready — draws=67 instances=0 terrainLeaves=0 terrainVertices=0",
            *GOOD_TIER2[1:],
        ]
        failures = check_tier2_logcat(lines)
        self.assertTrue(any("zero leaves" in f for f in failures))

    def test_missing_surface_ready(self):
        lines = [line for line in GOOD_TIER2 if "Surface ready" not in line]
        failures = check_tier2_logcat(lines)
        self.assertTrue(any("Surface ready" in f for f in failures))

    def test_unclean_present_status(self):
        lines = [
            *GOOD_TIER2[:-2],
            "I HeretekTier2: renderFrame status: acquire=0 submit=0 present=-1 capture=0",
            GOOD_TIER2[-1],
        ]
        failures = check_tier2_logcat(lines)
        self.assertTrue(any("acquire=0 submit=0 present=-1" in f for f in failures))

    def test_stalled_frame_counter(self):
        lines = [
            *GOOD_TIER2[:-1],
            "I HeretekTier2: frame 300 presented",
            "I HeretekTier2: frame 0 presented",
        ]
        # Reorder so the last frame is lower than the first observed.
        failures = check_tier2_logcat(
            [
                "I HeretekTier2: frame 300 presented",
                "I HeretekTier2: frame 300 presented",
            ]
        )
        self.assertTrue(any("stalled" in f for f in failures))
        self.assertEqual(failures, [f for f in failures])  # sanity: list is well-formed

    def test_single_frame_line_flags_missing_progress(self):
        failures = check_tier2_logcat(["I HeretekTier2: frame 0 presented"])
        self.assertTrue(any("did not advance" in f for f in failures))

    def test_vk_failure_line(self):
        lines = [*GOOD_TIER2, "E HeretekTier2: vkQueuePresentKHR failed: -1"]
        failures = check_tier2_logcat(lines)
        self.assertTrue(any("Vulkan failure" in f for f in failures))


class Tier1LogcatTests(unittest.TestCase):
    def test_good(self):
        self.assertEqual(
            check_tier1_logcat(
                ["I Heretek3DGame: Loading 3D Android Game from: https://appassets..."]
            ),
            [],
        )

    def test_missing_load_line(self):
        failures = check_tier1_logcat(["I ActivityManager: Start proc"])
        self.assertTrue(any("bundle load" in f for f in failures))

    def test_fatal_exception(self):
        failures = check_tier1_logcat(
            [
                "I Heretek3DGame: Loading 3D Android Game from: https://appassets...",
                "E AndroidRuntime: FATAL EXCEPTION: main",
            ]
        )
        self.assertTrue(any("fatal exception" in f for f in failures))


class FrameTests(unittest.TestCase):
    def test_parse_ppm_roundtrip(self):
        width, height, pixels = parse_ppm(ppm(8, 4))
        self.assertEqual((width, height), (8, 4))
        self.assertEqual(len(pixels), 8 * 4 * 3)

    def test_parse_ppm_rejects_bad_header(self):
        with self.assertRaises(ValueError):
            parse_ppm(b"P3\n1 1\n255\n0 0 0\n")

    def test_parse_ppm_rejects_size_mismatch(self):
        with self.assertRaises(ValueError):
            parse_ppm(b"P6\n2 2\n255\n" + b"\x00" * 3)

    def test_uniform_frame_fails(self):
        failures = check_frame_pixels(ppm(colors=((5, 5, 10),)), min_unique=5)
        self.assertTrue(any("uniform" in f for f in failures))

    def test_varied_frame_passes(self):
        self.assertEqual(check_frame_pixels(ppm()), [])

    def test_tiny_frame_fails(self):
        failures = check_frame_pixels(ppm(64, 48))
        self.assertTrue(any("suspiciously small" in f for f in failures))

    def test_frame_stats_counts_colors(self):
        _, _, pixels = parse_ppm(ppm(colors=((1, 2, 3), (4, 5, 6), (7, 8, 9))))
        stats = frame_stats(pixels)
        self.assertGreaterEqual(stats["uniqueColors"], 2)


if __name__ == "__main__":
    unittest.main()
