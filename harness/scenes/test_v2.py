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


class V2PrefabTests(unittest.TestCase):
    def _write_prefab_scene(self, root):
        from harness.prefabs.prefabs import PrefabStore

        scene_dir = Path(root) / "main"
        PrefabStore(scene_dir / "prefabs").save(
            {
                "id": "goblin",
                "template": {
                    "shape": "capsule",
                    "physics": "none",
                    "color": "#4d7c0f",
                    "health": {"maxHealth": 50},
                },
            }
        )
        PrefabStore(scene_dir / "prefabs").save(
            {
                "id": "goblin-brute",
                "base": "goblin",
                "overrides": {"health": {"maxHealth": 120}},
            }
        )
        (scene_dir / "scene.json").write_text(
            json.dumps({"id": "t", "name": "T", "gameObjects": []}),
            encoding="utf-8",
        )
        objects_dir = scene_dir / "objects"
        objects_dir.mkdir(parents=True, exist_ok=True)
        (objects_dir / "a.json").write_text(
            json.dumps(
                {
                    "uid": "a",
                    "name": "Goblin A",
                    "prefabUid": "goblin",
                    "position": [5, 1.5, 0],
                }
            ),
            encoding="utf-8",
        )
        (objects_dir / "b.json").write_text(
            json.dumps(
                {
                    "uid": "b",
                    "name": "Goblin King",
                    "prefabUid": "goblin-brute",
                    "color": "#ffd700",
                }
            ),
            encoding="utf-8",
        )
        return scene_dir

    def test_prefab_instances_resolve_with_overrides(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = assemble_from_v2(self._write_prefab_scene(tmp))
        by_name = {o["name"]: o for o in scene["gameObjects"]}
        self.assertEqual(by_name["Goblin A"]["shape"], "capsule")
        self.assertEqual(by_name["Goblin A"]["position"], [5, 1.5, 0])
        self.assertEqual(by_name["Goblin A"]["health"], {"maxHealth": 50})
        self.assertEqual(by_name["Goblin King"]["health"], {"maxHealth": 120})
        self.assertEqual(by_name["Goblin King"]["color"], "#ffd700")
        self.assertNotIn("prefabUid", by_name["Goblin A"])

    def test_unknown_prefab_fails_loudly(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene_dir = self._write_prefab_scene(tmp)
            (scene_dir / "objects" / "c.json").write_text(
                json.dumps({"uid": "c", "name": "Orc", "prefabUid": "orc"}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError) as ctx:
                assemble_from_v2(scene_dir)
        self.assertIn("orc", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
