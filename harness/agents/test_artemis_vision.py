"""Unit tests for the Artemis vision-critique hook (hermetic: injected fakes).

Run from the repository root:
    python3 -m unittest harness.agents.test_artemis_vision
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.agents.artemis_qa_runner import build_vision_block  # noqa: E402


def scenario_with_objects():
    return {
        "gameObjects": [
            {"name": "Ground", "position": [0, 0, 0], "size": [20, 1, 20]},
            {"name": "Player", "position": [0, 1, 0], "size": [1, 1, 1]},
        ]
    }


class VisionBlockTests(unittest.TestCase):
    def test_notes_and_telemetry_recorded(self):
        calls = []

        def fake_critique(png, failed):
            calls.append((png, failed))
            return {
                "notes": ["Issue: clutter"],
                "model": "fake-vision",
                "totalTokens": 500,
                "latencySeconds": 1.25,
            }

        failed = [{"id": "player_exists", "detail": "missing"}]
        block = build_vision_block(scenario_with_objects(), failed, fake_critique)
        self.assertEqual(block["status"], "ok")
        self.assertEqual(block["notes"], ["Issue: clutter"])
        self.assertEqual(block["model"], "fake-vision")
        self.assertEqual(block["totalTokens"], 500)
        self.assertEqual(block["latencySeconds"], 1.25)
        # The critique receives the real PNG bytes and the failing rules.
        self.assertTrue(calls[0][0].startswith(b"\x89PNG"))
        self.assertEqual(calls[0][1], failed)

    def test_empty_notes_is_still_ok(self):
        block = build_vision_block(
            scenario_with_objects(),
            [],
            lambda png, failed: {
                "notes": [],
                "model": "m",
                "totalTokens": 10,
                "latencySeconds": 0.1,
            },
        )
        self.assertEqual(block["status"], "ok")
        self.assertEqual(block["notes"], [])

    def test_scenario_without_objects_is_skipped(self):
        def exploding_critique(png, failed):
            raise AssertionError("critique must not run without geometry")

        for spec in ({}, {"gameObjects": []}, {"gameObjects": [None, 42]}, None):
            block = build_vision_block(spec, [], exploding_critique)
            self.assertEqual(block["status"], "skipped")

    def test_critique_failure_is_an_error_block(self):
        def failing_critique(png, failed):
            raise RuntimeError("upstream down")

        block = build_vision_block(scenario_with_objects(), [], failing_critique)
        self.assertEqual(block["status"], "error")
        self.assertIn("upstream down", block["error"])
        self.assertEqual(block["notes"], [])


class DefaultCritiqueTests(unittest.TestCase):
    """default_vision_critique must resolve its own imports (regression test).

    The loop's vision module uses absolute harness.* imports, so the callable
    has to ensure both HARNESS_DIR and REPO_ROOT are importable — a live run
    once failed here with 'No module named harness'.
    """

    def test_wires_client_and_frame_critique_without_network(self):
        # NOTE: the runner imports the loop package as top-level `loop.*`
        # (HARNESS_DIR on sys.path), which is a different module object from
        # `harness.loop.*` — patch the former, or the fake never takes effect.
        import sys as _sys

        harness_dir = str(Path(__file__).resolve().parents[1])
        if harness_dir not in _sys.path:
            _sys.path.insert(0, harness_dir)
        import loop.llm_client as loop_llm_client
        import loop.vision as loop_vision
        from harness.agents.artemis_qa_runner import default_vision_critique

        seen = {}

        class DummyClient:
            pass

        def fake_critique_frame(
            client, frame_bytes, model=None, failed_rules=None, **kwargs
        ):
            seen["model"] = model
            seen["bytes"] = frame_bytes
            seen["failed"] = failed_rules

            class Result:
                notes = ["Issue: clutter"]
                model = "fake-vision"
                total_tokens = 11
                latency_seconds = 0.5
                error = None

            return Result()

        real_client = loop_llm_client.LlmClient
        real_frame = loop_vision.critique_frame
        loop_llm_client.LlmClient = lambda: DummyClient()
        loop_vision.critique_frame = fake_critique_frame
        try:
            critique_fn = default_vision_critique(model="fake-model")
            outcome = critique_fn(b"\x89PNG-bytes", [{"id": "x"}])
        finally:
            loop_llm_client.LlmClient = real_client
            loop_vision.critique_frame = real_frame
        self.assertEqual(outcome["notes"], ["Issue: clutter"])
        self.assertEqual(outcome["model"], "fake-vision")
        self.assertEqual(outcome["totalTokens"], 11)
        self.assertEqual(seen["model"], "fake-model")
        self.assertEqual(seen["bytes"], b"\x89PNG-bytes")
        self.assertEqual(seen["failed"], [{"id": "x"}])


if __name__ == "__main__":
    unittest.main()
