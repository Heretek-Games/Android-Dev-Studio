"""Unit tests for the Tier 2 parity flip rule (Track 0).

The checker itself is simple file comparison; these tests pin its two
behaviors: green on the committed parity file, and red when a runner
capability loses its parity entry (the actual flip being guarded).

Run from the repository root:
    python3 -m unittest harness.build.test_tier2_parity
"""

import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.build.check_tier2_parity import main as check_parity  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PARITY = REPO / "harness" / "tier2_parity.json"
RUNNER = REPO / "harness" / "agents" / "qa_scenario_runner.mjs"


class Tier2ParityTests(unittest.TestCase):
    def test_committed_parity_file_is_green(self):
        self.assertEqual(check_parity(str(PARITY), str(RUNNER)), 0)

    def test_missing_entry_fails_the_flip_rule(self):
        parity = json.loads(PARITY.read_text(encoding="utf-8"))
        dropped = copy.deepcopy(parity)
        victim = next(name for name in dropped["entries"] if "AnimeCelShader" in name)
        del dropped["entries"][victim]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(dropped, tmp)
            tmp_path = tmp.name
        try:
            self.assertEqual(check_parity(tmp_path, str(RUNNER)), 1)
        finally:
            os.unlink(tmp_path)

    def test_statuses_are_a_closed_vocabulary(self):
        parity = json.loads(PARITY.read_text(encoding="utf-8"))
        allowed = {"full", "partial", "missing", "web-tier", "n/a"}
        for name, entry in parity["entries"].items():
            self.assertIn(entry.get("tier2"), allowed, name)
            self.assertTrue(entry.get("notes"), name)


if __name__ == "__main__":
    unittest.main()
