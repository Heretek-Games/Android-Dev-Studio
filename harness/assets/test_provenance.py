"""Unit tests for the asset provenance registry (Track D.5, hermetic).

Run from the repository root:
    python3 -m unittest harness.assets.test_provenance
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.assets.importer import import_asset  # noqa: E402
from harness.assets.provenance import audit_scene_provenance  # noqa: E402
from harness.loop.action_applier import apply_actions  # noqa: E402
from harness.memory.project_memory import ProjectMemory  # noqa: E402


def ground_scene():
    return {
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [24, 1, 24],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            }
        ]
    }


class AuditTests(unittest.TestCase):
    def test_empty_scene_has_no_rows(self):
        audit = audit_scene_provenance({"gameObjects": []})
        self.assertEqual(audit, {"rows": [], "gaps": [], "complete": True, "count": 0})

    def test_stamped_object_is_complete(self):
        audit = audit_scene_provenance(
            {
                "gameObjects": [
                    {
                        "name": "Knight",
                        "modelUrl": "uid://" + "a" * 32,
                        "source": "GDevelop/x",
                        "license": "CC0-1.0",
                        "provenance": {"addedBy": "loop", "addedAt": 123.0},
                    }
                ]
            }
        )
        self.assertTrue(audit["complete"])
        row = audit["rows"][0]
        self.assertEqual(
            (row["object"], row["license"], row["addedBy"], row["drawCost"]),
            ("Knight", "CC0-1.0", "loop", 1),
        )

    def test_unstamped_object_defaults_to_studio(self):
        audit = audit_scene_provenance(
            {
                "gameObjects": [
                    {
                        "name": "Old",
                        "modelUrl": "uid://" + "b" * 32,
                        "source": "CC0/Q",
                        "license": "MIT",
                    }
                ]
            }
        )
        self.assertTrue(audit["complete"])
        self.assertEqual(audit["rows"][0]["addedBy"], "studio")

    def test_missing_license_is_a_gap(self):
        audit = audit_scene_provenance(
            {
                "gameObjects": [
                    {"name": "Shady", "modelUrl": "uid://" + "c" * 32, "source": "???"}
                ]
            }
        )
        self.assertFalse(audit["complete"])
        self.assertTrue(any("Shady" in gap for gap in audit["gaps"]))

    def test_primitives_ignored(self):
        audit = audit_scene_provenance(
            {"gameObjects": [{"name": "Box", "shape": "box"}]}
        )
        self.assertEqual(audit["count"], 0)


class StampTests(unittest.TestCase):
    def test_loop_spawn_stamps_provenance(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            sidecar = import_asset(
                b"glTF" + b"\x00" * 64,
                name="Knight",
                preset="mobile",
                assets_dir=assets_dir,
                license="CC0-1.0",
            )
            with mock.patch.dict(os.environ, {"HERETEK_ASSETS_DIR": assets_dir}):
                scene, result = apply_actions(
                    ground_scene(),
                    [
                        {
                            "type": "spawn",
                            "name": "Knight",
                            "size": [1, 2, 1],
                            "position": [3, 1, 0],
                            "physics": "none",
                            "model": f"uid://{sidecar['uid']}",
                        }
                    ],
                )
        self.assertEqual(result.applied, 1)
        stamp = scene["gameObjects"][1].get("provenance")
        self.assertEqual(stamp["addedBy"], "loop")
        self.assertGreater(stamp["addedAt"], 0)


class MemoryTests(unittest.TestCase):
    def test_record_and_query(self):
        memory = ProjectMemory(db_path=":memory:")
        audit = audit_scene_provenance(
            {
                "gameObjects": [
                    {
                        "name": "Knight",
                        "modelUrl": "uid://" + "a" * 32,
                        "source": "GDevelop/x",
                        "license": "CC0-1.0",
                        "provenance": {"addedBy": "loop", "addedAt": 7.0},
                    }
                ]
            }
        )
        self.assertEqual(memory.record_provenance(audit["rows"], origin="run1"), 1)
        by_uid = memory.query_provenance(uid="uid://" + "a" * 32)
        self.assertEqual(len(by_uid), 1)
        self.assertEqual(by_uid[0]["added_by"], "loop")
        self.assertEqual(by_uid[0]["origin"], "run1")
        self.assertEqual(memory.query_provenance(license="MIT"), [])
        self.assertEqual(len(memory.query_provenance(license="CC0-1.0")), 1)


class GateTests(unittest.TestCase):
    def test_loop_built_scene_query_green(self):
        """D.5 gate: provenance query green over a loop-built scene."""
        with tempfile.TemporaryDirectory() as assets_dir:
            sidecar = import_asset(
                b"glTF" + b"\x00" * 64,
                name="Knight",
                preset="mobile",
                assets_dir=assets_dir,
                license="CC0-1.0",
            )
            with mock.patch.dict(os.environ, {"HERETEK_ASSETS_DIR": assets_dir}):
                scene, result = apply_actions(
                    ground_scene(),
                    [
                        {
                            "type": "spawn",
                            "name": "Knight",
                            "size": [1, 2, 1],
                            "position": [3, 1, 0],
                            "physics": "none",
                            "model": f"uid://{sidecar['uid']}",
                        }
                    ],
                )
        self.assertEqual(result.applied, 1)
        audit = audit_scene_provenance(scene)
        self.assertTrue(audit["complete"], audit["gaps"])
        memory = ProjectMemory(db_path=":memory:")
        memory.record_provenance(audit["rows"], origin="gate-run")
        rows = memory.query_provenance(uid=f"uid://{sidecar['uid']}")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["license"], "CC0-1.0")


if __name__ == "__main__":
    unittest.main()
