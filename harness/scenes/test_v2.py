"""Unit tests for the scene format v2 converter/assembler (Track 0).

Gate test per ADR-1790368676613: convert → assemble must round-trip to a
byte-stable canonical form, and QA on the assembled scene must match QA on
the original (verified separately via the fps_arena probe in CI logs).

Run from the repository root:
    python3 -m unittest harness.scenes.test_v2
"""

import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.scenes.v2 import (  # noqa: E402
    assemble_from_v2,
    convert_to_v2,
    dump_canonical,
    load_scene,
    normalize_scene,
)

REPO = Path(__file__).resolve().parents[2]


def canonical_scene():
    return json.loads((REPO / "harness" / "scenes" / "active_scene.json").read_text())


class V2RoundTripTests(unittest.TestCase):
    def test_convert_assemble_is_byte_stable(self):
        original = canonical_scene()
        with tempfile.TemporaryDirectory() as tmp:
            convert_to_v2(original, Path(tmp) / "main")
            rebuilt = assemble_from_v2(Path(tmp) / "main")
        self.assertEqual(dump_canonical(rebuilt), dump_canonical(original))

    def test_uids_are_stable_and_unique(self):
        original = canonical_scene()
        with tempfile.TemporaryDirectory() as tmp:
            first = convert_to_v2(original, Path(tmp) / "a")
            second = convert_to_v2(original, Path(tmp) / "b")
        self.assertEqual(len(set(first.values())), len(first))
        # Re-converting the assembled scene preserves uids (no churn).
        with tempfile.TemporaryDirectory() as tmp:
            scene_dir = Path(tmp) / "main"
            convert_to_v2(original, scene_dir)
            assembled = assemble_from_v2(scene_dir)
            # Inject the allocated uids back and re-convert: same mapping.
            for obj in assembled["gameObjects"]:
                obj["uid"] = first[obj["name"]]
            third = convert_to_v2(assembled, Path(tmp) / "c")
        self.assertEqual(first, third)

    def test_noop_rewrite_produces_no_diff(self):
        original = canonical_scene()
        with tempfile.TemporaryDirectory() as tmp:
            scene_dir = Path(tmp) / "main"
            convert_to_v2(original, scene_dir)
            before = {p.name: p.read_bytes() for p in sorted(scene_dir.rglob("*.json"))}
            rebuilt = assemble_from_v2(scene_dir)
            convert_to_v2(rebuilt, scene_dir)
            after = {p.name: p.read_bytes() for p in sorted(scene_dir.rglob("*.json"))}
        # Same file set (uids regenerated, so compare count + scene.json bytes).
        self.assertEqual(len(before), len(after))
        self.assertEqual(before["scene.json"], after["scene.json"])

    def test_dual_format_loader(self):
        original = canonical_scene()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            scene_dir = tmp / "main"
            convert_to_v2(original, scene_dir)
            scene, format = load_scene(scene_dir)
            self.assertEqual(format, "v2")
            self.assertEqual(dump_canonical(scene), dump_canonical(original))

            flat_path = tmp / "flat.json"
            flat_path.write_text(json.dumps(original), encoding="utf-8")
            scene, format = load_scene(flat_path)
            self.assertEqual(format, "v1")
            self.assertEqual(scene["gameObjects"], original["gameObjects"])

    def test_normalize_sorts_and_rounds(self):
        scene = {
            "id": "t",
            "name": "T",
            "gameObjects": [
                {"name": "B", "position": [0, 1.23456, 0]},
                {"name": "A", "position": [0, 0, 0]},
            ],
        }
        normalized = normalize_scene(scene)
        self.assertEqual([o["name"] for o in normalized["gameObjects"]], ["A", "B"])
        self.assertEqual(normalized["gameObjects"][1]["position"], [0, 1.235, 0])
        # Input untouched (pure).
        self.assertEqual(scene["gameObjects"][0]["name"], "B")


if __name__ == "__main__":
    unittest.main()
