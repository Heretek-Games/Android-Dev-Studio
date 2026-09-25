"""Unit tests for the vision critique + layout preview (hermetic fake client).

Run from the repository root:
    python3 -m unittest harness.loop.test_vision
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.loop.llm_client import LlmResponse  # noqa: E402
from harness.loop.scene_preview import render_layout_png  # noqa: E402
from harness.loop.vision import critique_frame, make_layout_critique, parse_critique  # noqa: E402


def scene():
    return {
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            {
                "name": "Player Capsule",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 0],
                "color": "#3b82f6",
                "physics": "dynamic",
                "controller": True,
            },
            {
                "name": "Gold Coin 1",
                "shape": "cylinder",
                "size": [0.8, 0.2, 0.8],
                "position": [-4, 1.2, 6],
                "color": "#fbbf24",
            },
            {
                "name": "Sunset Sun",
                "kind": "light",
                "lightType": "directional",
                "color": "#ffd7a8",
                "intensity": 2.5,
                "position": [5, 12, 6],
            },
        ]
    }


class FakeClient:
    def __init__(self, response_text):
        self.response_text = response_text
        self.calls = []

    def chat_with_image(
        self, prompt, image_bytes, mime="image/png", model=None, **kwargs
    ):
        self.calls.append(
            {"prompt": prompt, "image": image_bytes, "mime": mime, "model": model}
        )
        return LlmResponse(
            text=self.response_text,
            model=model or "fake",
            prompt_tokens=10,
            completion_tokens=5,
        )


class ParseTests(unittest.TestCase):
    def test_combines_issues_and_suggestions(self):
        notes = parse_critique(
            json.dumps(
                {
                    "issues": ["player overlaps a pillar"],
                    "suggestions": ["move the player to (0, 2, 0)"],
                }
            )
        )
        self.assertEqual(
            notes,
            [
                "Issue: player overlaps a pillar",
                "Suggestion: move the player to (0, 2, 0)",
            ],
        )

    def test_tolerates_codeblock(self):
        notes = parse_critique(
            '```json\n{"issues": ["no ground"], "suggestions": []}\n```'
        )
        self.assertEqual(notes, ["Issue: no ground"])

    def test_empty_arrays(self):
        self.assertEqual(parse_critique('{"issues": [], "suggestions": []}'), [])

    def test_garbage_returns_empty(self):
        self.assertEqual(parse_critique("no json here"), [])

    def test_non_string_entries_ignored(self):
        notes = parse_critique(
            json.dumps({"issues": [1, None, "real issue"], "suggestions": "oops"})
        )
        self.assertEqual(notes, ["Issue: real issue"])


class CritiqueTests(unittest.TestCase):
    def test_layout_critique_renders_png_and_returns_notes(self):
        client = FakeClient(
            json.dumps(
                {
                    "issues": ["coin is unreachable"],
                    "suggestions": ["move the coin inside the arena"],
                }
            )
        )
        critique = make_layout_critique(client, model="auto/best-vision")
        notes = critique(scene())

        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertTrue(call["image"].startswith(b"\x89PNG"))
        self.assertEqual(call["model"], "auto/best-vision")
        self.assertIn("TOP-DOWN", call["prompt"])
        self.assertEqual(
            notes,
            [
                "Issue: coin is unreachable",
                "Suggestion: move the coin inside the arena",
            ],
        )

    def test_critique_caps_notes(self):
        client = FakeClient(
            json.dumps({"issues": [f"issue {i}" for i in range(10)], "suggestions": []})
        )
        notes = make_layout_critique(client, max_notes=3)(scene())
        self.assertEqual(len(notes), 3)

    def test_critique_frame_passes_bytes_through(self):
        client = FakeClient(
            json.dumps({"issues": ["scene is empty"], "suggestions": []})
        )
        notes = critique_frame(client, b"\x89PNG-rendered-frame")
        self.assertEqual(notes, ["Issue: scene is empty"])
        self.assertEqual(client.calls[0]["image"], b"\x89PNG-rendered-frame")


class PreviewTests(unittest.TestCase):
    def test_render_produces_png(self):
        png = render_layout_png(scene())
        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertGreater(len(png), 1000)

    def test_render_survives_bad_objects(self):
        png = render_layout_png(
            {
                "gameObjects": [
                    None,
                    42,
                    {"name": "NoPos"},
                    {"name": "BadPos", "position": ["x", 0, 0]},
                ]
            }
        )
        self.assertTrue(png.startswith(b"\x89PNG"))

    def test_render_is_deterministic(self):
        self.assertEqual(render_layout_png(scene()), render_layout_png(scene()))


if __name__ == "__main__":
    unittest.main()
