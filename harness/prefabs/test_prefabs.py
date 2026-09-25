"""Unit tests for prefab templates + variant chains (Track 1.1).

Run from the repository root:
    python3 -m unittest harness.prefabs.test_prefabs
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.prefabs.prefabs import (  # noqa: E402
    PrefabStore,
    resolve_prefab,
    validate_prefab,
)


def base_prefab():
    return {
        "id": "goblin",
        "name": "Goblin",
        "template": {
            "shape": "capsule",
            "size": [1, 1.5, 1],
            "color": "#4d7c0f",
            "physics": "none",
            "health": {"maxHealth": 50},
            "ai": {"targetName": "Player Hero", "moveSpeed": 2.5},
        },
    }


class ValidateTests(unittest.TestCase):
    def test_valid_prefab_normalizes(self):
        prefab = validate_prefab(base_prefab())
        self.assertEqual(prefab["id"], "goblin")
        self.assertIsNone(prefab["base"])
        self.assertEqual(prefab["overrides"], {})

    def test_rejects_malformed(self):
        for bad, hint in (
            (None, "object"),
            ({}, "id"),
            ({"id": "  "}, "id"),
            ({"id": "g", "base": 42}, "base"),
            ({"id": "g", "template": []}, "template"),
            ({"id": "g", "mystery": 1}, "mystery"),
        ):
            errors = []
            self.assertIsNone(validate_prefab(bad, errors), f"should reject {bad!r}")
            self.assertTrue(errors, "rejection names the offense")


class ResolveTests(unittest.TestCase):
    def test_base_resolves_to_template(self):
        store = {"goblin": validate_prefab(base_prefab())}
        obj = resolve_prefab(store, "goblin")
        self.assertEqual(obj["shape"], "capsule")
        self.assertEqual(obj["health"], {"maxHealth": 50})

    def test_instance_overrides_win(self):
        store = {"goblin": validate_prefab(base_prefab())}
        obj = resolve_prefab(
            store, "goblin", {"color": "#ff0000", "health": {"maxHealth": 80}}
        )
        self.assertEqual(obj["color"], "#ff0000")
        self.assertEqual(obj["health"], {"maxHealth": 80})
        self.assertEqual(obj["ai"], {"targetName": "Player Hero", "moveSpeed": 2.5})

    def test_variant_chain_three_levels(self):
        store = {
            "goblin": validate_prefab(base_prefab()),
            "goblin-brute": validate_prefab(
                {
                    "id": "goblin-brute",
                    "base": "goblin",
                    "overrides": {"size": [1.5, 2, 1.5], "health": {"maxHealth": 120}},
                }
            ),
            "goblin-king": validate_prefab(
                {
                    "id": "goblin-king",
                    "base": "goblin-brute",
                    "overrides": {"color": "#ffd700"},
                }
            ),
        }
        obj = resolve_prefab(store, "goblin-king")
        self.assertEqual(obj["shape"], "capsule")  # from root template
        self.assertEqual(obj["size"], [1.5, 2, 1.5])  # mid-chain override holds
        self.assertEqual(obj["health"], {"maxHealth": 120})
        self.assertEqual(obj["color"], "#ffd700")  # leaf wins
        # Mid-chain override survives base edits downstream of it.
        self.assertEqual(obj["ai"]["moveSpeed"], 2.5)

    def test_cycle_rejected_with_path(self):
        store = {
            "a": {"id": "a", "name": "A", "base": "b", "template": {}, "overrides": {}},
            "b": {"id": "b", "name": "B", "base": "a", "template": {}, "overrides": {}},
        }
        errors = []
        self.assertIsNone(resolve_prefab(store, "a", None, errors))
        self.assertIn("a -> b -> a", errors[0])

    def test_unknown_ids_rejected(self):
        store = {"goblin": validate_prefab(base_prefab())}
        errors = []
        self.assertIsNone(resolve_prefab(store, "orc", None, errors))
        self.assertIn("orc", errors[0])

        bad = validate_prefab({"id": "x", "base": "ghost"})
        errors = []
        self.assertIsNone(resolve_prefab({**store, "x": bad}, "x", None, errors))
        self.assertIn("ghost", errors[0])

    def test_resolve_is_pure(self):
        store = {"goblin": validate_prefab(base_prefab())}
        obj = resolve_prefab(store, "goblin", {"color": "#fff"})
        self.assertEqual(obj["color"], "#fff")
        self.assertEqual(store["goblin"]["template"]["color"], "#4d7c0f")
        obj["health"]["maxHealth"] = 999
        self.assertEqual(store["goblin"]["template"]["health"]["maxHealth"], 50)


class StoreTests(unittest.TestCase):
    def test_save_load_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = PrefabStore(Path(tmp))
            store.save(base_prefab())
            loaded = store.load_all()
        self.assertIn("goblin", loaded)
        obj = resolve_prefab(loaded, "goblin")
        self.assertEqual(obj["shape"], "capsule")

    def test_empty_dir_loads_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(PrefabStore(Path(tmp)).load_all(), {})


if __name__ == "__main__":
    unittest.main()
