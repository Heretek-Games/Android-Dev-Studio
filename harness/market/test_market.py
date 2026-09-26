"""Tests for harness/market (run: python3 -m unittest harness.market.test_market)."""

import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.market.manifest import manifest_id, validate_manifest  # noqa: E402
from harness.market.packs import (  # noqa: E402
    create_pack,
    enabled_payloads,
    install_pack,
    set_enabled,
    uninstall_pack,
)
from harness.market.review import review_pack  # noqa: E402


def good_manifest(**overrides):
    base = {
        "name": "com.heretek.coin-pack",
        "version": "1.2.0",
        "engine": ">=1.0.0",
        "kind": "prefab",
        "entry": "coin.json",
        "license": "MIT",
        "assets": ["coin.json"],
        "sizeMB": 0.1,
    }
    base.update(overrides)
    return base


def write_pack_dir(root, manifest, files):
    src = os.path.join(root, "src")
    os.makedirs(src, exist_ok=True)
    with open(os.path.join(src, "heretek.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    for name, data in files.items():
        full = os.path.join(src, name)
        os.makedirs(os.path.dirname(full) or src, exist_ok=True)
        mode = "w" if isinstance(data, str) else "wb"
        with open(
            full, mode, encoding="utf-8" if isinstance(data, str) else None
        ) as fh:
            fh.write(data)
    return src


COIN_PREFAB = {
    "id": "coin",
    "template": {"shape": "cylinder", "physics": "none"},
}


class ManifestTests(unittest.TestCase):
    def test_valid_manifest_normalizes(self):
        manifest = validate_manifest(good_manifest(), [])
        assert manifest is not None
        self.assertEqual(manifest_id(manifest), "com.heretek.coin-pack@1.2.0")
        self.assertEqual(manifest["dependencies"], {})

    def test_manifest_rejects_malformed(self):
        for bad, hint in (
            ({"name": "Coin Pack"}, "reverse-domain"),
            (good_manifest(version="1.2"), "SemVer"),
            (good_manifest(kind="shader"), "kind"),
            (good_manifest(entry="../evil.json"), "relative"),
            (good_manifest(engine="latest"), "pin"),
            (good_manifest(license=""), "SPDX"),
            (good_manifest(dependencies={"com.heretek.core": "^1.0.0"}), "exact"),
            (good_manifest(assets=[]), "non-empty"),
            (good_manifest(entry="other.json"), "listed"),
            (good_manifest(sizeMB=-1), "non-negative"),
            (good_manifest(mystery=1), "mystery"),
        ):
            errors: list = []
            self.assertIsNone(validate_manifest(bad, errors), f"should reject {bad!r}")
            self.assertIn(hint, errors[0])


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def build_bundle(self, manifest=None, files=None, name="coin.htepak"):
        src = write_pack_dir(
            self.root,
            manifest or good_manifest(),
            files
            if files is not None
            else {"coin.json": json.dumps(COIN_PREFAB), "LICENSE": "MIT License\n"},
        )
        out = os.path.join(self.root, name)
        create_pack(src, out)
        return out

    def test_install_use_disable_uninstall_cycle(self):
        bundle = self.build_bundle()
        review = review_pack(bundle)
        self.assertTrue(review["pass"], f"review failed: {review['failures']}")
        pack_id = install_pack(self.root, bundle, [])
        self.assertEqual(pack_id, "com.heretek.coin-pack@1.2.0")
        # Use: enabled payload resolves through prefab semantics.
        payloads = enabled_payloads(self.root)
        self.assertEqual(len(payloads), 1)
        self.assertEqual(payloads[0]["data"]["id"], "coin")
        # Disable hides it; re-enable restores it.
        self.assertTrue(set_enabled(self.root, pack_id, False))
        self.assertEqual(enabled_payloads(self.root), [])
        self.assertTrue(set_enabled(self.root, pack_id, True))
        self.assertEqual(len(enabled_payloads(self.root)), 1)
        # Immutable versions: reinstall refused.
        errors: list = []
        self.assertIsNone(install_pack(self.root, bundle, errors))
        self.assertIn("immutable", errors[0])
        # Uninstall removes everything.
        self.assertTrue(uninstall_pack(self.root, pack_id, []))
        self.assertEqual(enabled_payloads(self.root), [])
        self.assertFalse(os.path.exists(os.path.join(self.root, "packs", pack_id)))

    def test_dependency_and_dependent_gates(self):
        base = self.build_bundle(name="base.htepak")
        self.assertIsNotNone(install_pack(self.root, base, []))
        child_manifest = good_manifest(
            name="com.heretek.coin-plus",
            dependencies={"com.heretek.coin-pack": "1.2.0"},
        )
        child = self.build_bundle(manifest=child_manifest, name="child.htepak")
        self.assertIsNotNone(install_pack(self.root, child, []))
        # Dependent blocks base uninstall (UPM parity).
        errors: list = []
        self.assertFalse(
            uninstall_pack(self.root, "com.heretek.coin-pack@1.2.0", errors)
        )
        self.assertIn("required by", errors[0])
        # Missing dependency refuses install.
        lonely_manifest = good_manifest(
            name="com.heretek.lonely", dependencies={"com.heretek.ghost": "9.9.9"}
        )
        lonely = self.build_bundle(manifest=lonely_manifest, name="lonely.htepak")
        errors = []
        self.assertIsNone(install_pack(self.root, lonely, errors))
        self.assertIn("unsatisfied dependency", errors[0])

    def test_review_rejects_bad_packs(self):
        # No LICENSE file.
        bundle = self.build_bundle(files={"coin.json": json.dumps(COIN_PREFAB)})
        review = review_pack(bundle)
        self.assertFalse(review["pass"])
        self.assertTrue(any("LICENSE" in f for f in review["failures"]))
        # Copyleft license.
        bundle = self.build_bundle(
            manifest=good_manifest(license="GPL-3.0-only"),
            files={"coin.json": json.dumps(COIN_PREFAB), "LICENSE": "GPL"},
        )
        review = review_pack(bundle)
        self.assertFalse(review["pass"])
        self.assertTrue(any("SPDX" in f for f in review["failures"]))
        # Invalid payload for kind.
        bundle = self.build_bundle(
            files={"coin.json": json.dumps({"nope": True}), "LICENSE": "MIT"}
        )
        review = review_pack(bundle)
        self.assertFalse(review["pass"])
        self.assertTrue(any("api-surface" in f for f in review["failures"]))
        # Oversize budget.
        big = "x" * (2 * 1024 * 1024)
        bundle = self.build_bundle(
            manifest=good_manifest(sizeMB=0.1, assets=["coin.json", "big.bin"]),
            files={
                "coin.json": json.dumps(COIN_PREFAB),
                "LICENSE": "MIT",
                "big.bin": big,
            },
        )
        review = review_pack(bundle, {"max_size_mb": 1.0})
        self.assertFalse(review["pass"])
        self.assertTrue(any("budget" in f for f in review["failures"]))

    def test_malformed_bundle_rejected(self):
        bad = os.path.join(self.root, "bad.htepak")
        with open(bad, "w") as fh:
            fh.write("not a zip")
        errors: list = []
        self.assertIsNone(install_pack(self.root, bad, errors))
        self.assertTrue(errors)
        review = review_pack(bad)
        self.assertFalse(review["pass"])
        # Missing asset on disk fails creation.
        src = write_pack_dir(self.root, good_manifest(), {"LICENSE": "MIT"})
        with self.assertRaises(ValueError):
            create_pack(src, os.path.join(self.root, "out.htepak"))

    def test_behavior_and_dialogue_payloads_validate(self):
        behavior_manifest = good_manifest(
            name="com.heretek.patrol",
            kind="behavior",
            entry="patrol.json",
            assets=["patrol.json"],
        )
        bundle = self.build_bundle(
            manifest=behavior_manifest,
            files={
                "patrol.json": json.dumps(
                    [
                        {
                            "type": "Pathfollow",
                            "options": {
                                "waypoints": [{"x": 0, "z": 0}],
                                "mode": "loop",
                            },
                        }
                    ]
                ),
                "LICENSE": "MIT",
            },
            name="behavior.htepak",
        )
        self.assertTrue(review_pack(bundle)["pass"])
        dialogue_manifest = good_manifest(
            name="com.heretek.greet",
            kind="dialogue",
            entry="tree.json",
            assets=["tree.json"],
        )
        bundle = self.build_bundle(
            manifest=dialogue_manifest,
            files={
                "tree.json": json.dumps(
                    {
                        "id": "greet",
                        "startNodeId": "hi",
                        "nodes": {"hi": {"id": "hi", "type": "text"}},
                    }
                ),
                "LICENSE": "MIT",
            },
            name="dialogue.htepak",
        )
        self.assertTrue(review_pack(bundle)["pass"])


if __name__ == "__main__":
    unittest.main()
