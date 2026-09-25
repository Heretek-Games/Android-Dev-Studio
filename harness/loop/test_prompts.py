"""Unit tests for the loop prompt builders (pure, no network needed).

Run from the repository root:
    python3 -m unittest harness.loop.test_prompts
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.prompts import repair_messages  # noqa: E402


def user_text(messages):
    return next(m["content"] for m in messages if m["role"] == "user")


class RepairPromptTests(unittest.TestCase):
    def test_rejected_actions_are_quoted(self):
        messages = repair_messages(
            "found a hamlet",
            [],
            {"gameObjects": []},
            [
                {
                    "id": "population-grown",
                    "type": "game_settlement_pop_min",
                    "detail": "no game config in scenario",
                }
            ],
            {},
            2,
            None,
            [
                "game: game config rejected — unknown game settlement key 'name' "
                "(allowed: gridSize, targetPopulation, startingGold, startingFood, placements)"
            ],
        )
        text = user_text(messages)
        self.assertIn("REJECTED actions", text)
        self.assertIn("unknown game settlement key 'name'", text)
        self.assertIn("no game config in scenario", text)

    def test_no_rejected_section_by_default(self):
        messages = repair_messages(
            "found a hamlet",
            [],
            {"gameObjects": []},
            [
                {
                    "id": "population-grown",
                    "type": "game_settlement_pop_min",
                    "detail": "no game config in scenario",
                }
            ],
            {},
            2,
        )
        self.assertNotIn("REJECTED actions", user_text(messages))


if __name__ == "__main__":
    unittest.main()
