"""MCP asset-tool tests (Track D.4): unified import path, gated saves.

Network is mocked; the live chain is covered by test_store.LiveChainTests.
Run from the repository root:
    python3 -m unittest harness.test_mcp_assets
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import harness.mcp_server as mcp  # noqa: E402
from harness.assets import store as store_mod  # noqa: E402

FAKE_DETAILS = {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "objectAssets": [{"resources": [{"file": "https://cdn.example.com/hero.glb"}]}],
}


def call_tool(name, args):
    return mcp.handle_request(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": args},
        }
    )


def result_text(response):
    return response["result"]["content"][0]["text"]


class McpAssetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.scenes = os.path.join(self.tmp.name, "scenes")
        self.assets = os.path.join(self.tmp.name, "assets")
        patches = [
            mock.patch.object(
                mcp, "ACTIVE_SCENE_PATH", os.path.join(self.scenes, "active_scene.json")
            ),
            mock.patch.object(mcp, "SCENES_DIR", self.scenes),
            mock.patch.object(mcp.memory, "save_scene_snapshot", return_value=None),
            mock.patch.dict(os.environ, {"HERETEK_ASSETS_DIR": self.assets}),
        ]
        for patch in patches:
            patch.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        mcp.load_active_scene()

    def tearDown(self):
        self.tmp.cleanup()

    def scene_objects(self):
        with open(os.path.join(self.scenes, "active_scene.json")) as fh:
            return json.load(fh)["gameObjects"]

    def test_gdevelop_install_unified(self):
        # Handler imports from .assets.store at call time: patching the
        # submodule attributes steers both resolve and download.
        with (
            mock.patch.object(store_mod, "fetch_json", return_value=FAKE_DETAILS),
            mock.patch.object(
                store_mod, "download_bytes", return_value=b"glTF" + b"\x00" * 64
            ),
        ):
            response = call_tool(
                "studio_import_gdevelop_asset",
                {"asset_id": "abc123", "name": "Hero", "position": [3, 1, 0]},
            )
        text = result_text(response)
        self.assertIn("uid://", text)
        self.assertIn("gated save ok", text)
        objects = self.scene_objects()
        hero = next(o for o in objects if o["name"] == "Hero")
        self.assertTrue(hero["modelUrl"].startswith("uid://"))
        self.assertEqual(hero["license"], "CC0-1.0")
        manifest_files = os.listdir(self.assets)
        self.assertTrue(any(f.endswith(".import.json") for f in manifest_files))

    def test_gdevelop_install_failure_is_explicit(self):
        def boom(url):
            raise store_mod.StoreError("dns down")

        with mock.patch.object(store_mod, "fetch_json", side_effect=boom):
            response = call_tool(
                "studio_import_gdevelop_asset", {"asset_id": "nope", "name": "X"}
            )
        self.assertIn("acquisition failed", result_text(response))
        self.assertEqual(
            len(self.scene_objects()), len(mcp.load_active_scene()["gameObjects"])
        )

    def test_cc0_without_url_is_explicit_gap(self):
        response = call_tool(
            "studio_search_and_install_asset",
            {"query": "ninja", "install_to_scene": True},
        )
        text = result_text(response)
        self.assertIn("no registered download URL", text)
        # Nothing written: scene unchanged apart from rev-neutral load.
        self.assertFalse(
            any(
                o.get("modelUrl", "").startswith("https://")
                for o in self.scene_objects()
            )
        )

    def test_cc0_with_url_installs_through_importer(self):
        entry = dict(mcp.CC0_CATALOG[0])
        entry["url"] = "https://cdn.example.com/ninja.glb"
        with (
            mock.patch.object(mcp, "CC0_CATALOG", [entry]),
            mock.patch.object(
                store_mod, "download_bytes", return_value=b"glTF" + b"\x00" * 64
            ),
        ):
            response = call_tool(
                "studio_search_and_install_asset",
                {"query": "ninja", "install_to_scene": True},
            )
        text = result_text(response)
        self.assertIn("uid://", text)
        self.assertIn("gated save ok", text)
        hero = next(o for o in self.scene_objects() if o["name"] == entry["name"])
        self.assertTrue(hero["modelUrl"].startswith("uid://"))


if __name__ == "__main__":
    unittest.main()
