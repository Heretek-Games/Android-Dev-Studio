"""Sandboxed agent-logic tests (Track C.5): bare-import WASM capability wall.

Drives harness/scripting/sandbox.mjs via subprocess: the seek brain moves
toward its target deterministically, arrival short-circuits, and the
malicious fixture (fs import) is rejected pre-instantiation.

Run from the repository root:
    python3 -m unittest harness.scripting.test_sandbox
"""

import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SANDBOX = os.path.join("harness", "scripting", "sandbox.mjs")
SEEK = os.path.join("harness", "scripting", "seek.wasm")
MALICIOUS = os.path.join("harness", "scripting", "malicious.wasm")


def run_sandbox(wasm, queries):
    proc = subprocess.run(
        ["node", SANDBOX, wasm, json.dumps(queries)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=120,
    )
    return proc


class SandboxTests(unittest.TestCase):
    def test_seek_moves_toward_target(self):
        proc = run_sandbox(SEEK, {"0": 0, "1": 0, "2": 5, "3": 1})
        self.assertEqual(proc.returncode, 0, proc.stderr[:200])
        result = json.loads(proc.stdout)
        self.assertEqual(result["returned"], 1)
        self.assertEqual(len(result["emitted"]), 1)
        move = result["emitted"][0]
        self.assertEqual(move["action"], 1)
        # Dominant axis is +x: one unit step, z unchanged.
        self.assertAlmostEqual(move["x"], 1.0)
        self.assertAlmostEqual(move["z"], 0.0)

    def test_arrival_short_circuits(self):
        proc = run_sandbox(SEEK, {"0": 5, "1": 1, "2": 5, "3": 1})
        self.assertEqual(proc.returncode, 0, proc.stderr[:200])
        result = json.loads(proc.stdout)
        self.assertEqual(result["returned"], 0)
        self.assertEqual(result["emitted"], [])

    def test_deterministic_across_runs(self):
        queries = {"0": -3, "1": 7, "2": 4, "3": -2}
        first = run_sandbox(SEEK, queries).stdout
        second = run_sandbox(SEEK, queries).stdout
        self.assertEqual(json.loads(first), json.loads(second))

    def test_malicious_import_rejected(self):
        proc = run_sandbox(MALICIOUS, {})
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("fs", proc.stderr)

    def test_capability_surface_is_bare(self):
        # The fixture sources are the audit trail: seek imports heretek
        # only, malicious imports fs. The .wat files stay checked in.
        with open(os.path.join(REPO_ROOT, "harness", "scripting", "seek.wat")) as fh:
            source = fh.read()
        self.assertIn('(import "heretek" "query"', source)
        self.assertIn('(import "heretek" "emit"', source)
        self.assertNotIn("wasi", source.lower())
        self.assertNotIn('"fs"', source)


if __name__ == "__main__":
    unittest.main()
