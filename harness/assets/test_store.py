"""Store acquisition tests (Track D.4): resolve/download/import paths.

Hermetic via injected fetch/opener; one live test proves the real GDevelop
CDN chain (marked live — needs network, fails loudly offline).

Run from the repository root:
    python3 -m unittest harness.assets.test_store
"""

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.assets.store import (  # noqa: E402
    StoreError,
    details_credit,
    download_bytes,
    install_store_asset,
    resolve_gdevelop_glb,
)

DETAILS = {
    "author": "Quaternius",
    "objectAssets": [
        {
            "resources": [
                {"file": "https://cdn.example.com/preview.png"},
                {"file": "https://cdn.example.com/hero.glb"},
            ],
        }
    ],
}


class ResolveTests(unittest.TestCase):
    def test_resolves_first_glb(self):
        url, details = resolve_gdevelop_glb("abc123", fetch=lambda u: DETAILS)
        self.assertEqual(url, "https://cdn.example.com/hero.glb")
        self.assertEqual(details_credit(details), ("Quaternius", "UNSPECIFIED"))

    def test_gltf_suffix_accepted(self):
        payload = {
            "objectAssets": [
                {"resources": [{"file": "https://cdn.example.com/x.gltf"}]}
            ]
        }
        url, _ = resolve_gdevelop_glb("z", fetch=lambda u: payload)
        self.assertTrue(url.endswith(".gltf"))

    def test_no_model_rejected(self):
        with self.assertRaises(StoreError):
            resolve_gdevelop_glb("z", fetch=lambda u: {"objectAssets": []})

    def test_bad_ids_rejected(self):
        for bad in ("", "../evil", "a/b", " x "):
            with self.assertRaises(StoreError):
                resolve_gdevelop_glb(bad, fetch=lambda u: DETAILS)

    def test_fetch_failure_is_explicit(self):
        def boom(url):
            raise ValueError("dns down")

        with self.assertRaises(StoreError):
            resolve_gdevelop_glb("z", fetch=boom)


class DownloadTests(unittest.TestCase):
    def test_downloads_bytes(self):
        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return b"glTF-DATA"

        data = download_bytes(
            "https://cdn.example.com/x.glb", opener=lambda *a, **k: Resp()
        )
        self.assertEqual(data, b"glTF-DATA")

    def test_non_http_refused(self):
        with self.assertRaises(StoreError):
            download_bytes("file:///etc/passwd")

    def test_empty_rejected(self):
        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return b""

        with self.assertRaises(StoreError):
            download_bytes(
                "https://cdn.example.com/x.glb", opener=lambda *a, **k: Resp()
            )

    def test_cap_enforced(self):
        from harness.assets import store as store_mod

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return b"x" * (n + 1)

        with mock.patch.object(store_mod, "MAX_DOWNLOAD_BYTES", 4):
            with self.assertRaises(StoreError):
                download_bytes(
                    "https://cdn.example.com/x.glb", opener=lambda *a, **k: Resp()
                )


class InstallTests(unittest.TestCase):
    def test_install_returns_uid_sidecar(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            sidecar = install_store_asset(
                name="Hero",
                model_url="https://cdn.example.com/hero.glb",
                data=b"glTF" + b"\x00" * 64,
                license="CC0-1.0",
                author="Quaternius",
                assets_dir=assets_dir,
            )
            self.assertEqual(sidecar["license"], "CC0-1.0")
            self.assertTrue(
                os.path.isfile(
                    os.path.join(
                        assets_dir,
                        sidecar["outputs"]["texture"]
                        if "texture" in sidecar["outputs"]
                        else sidecar["outputs"]["model"],
                    )
                )
            )


class LiveChainTests(unittest.TestCase):
    def test_live_gdevelop_glb_downloads(self):
        from harness.assets import store as store_mod

        if os.environ.get("HERETEK_OFFLINE", ""):
            self.skipTest("offline")
        try:
            headers = store_mod.fetch_json(
                "https://resources.gdevelop-app.com/assets-database/assetShortHeaders.json"
            )
        except StoreError as exc:
            self.fail(f"GDevelop CDN unreachable: {exc}")
        three_d = [
            h
            for h in headers
            if isinstance(h, dict) and h.get("objectType") == "Scene3D::Model3DObject"
        ]
        self.assertTrue(three_d, "no Model3D headers in live catalog")
        asset_id = three_d[0].get("id") or three_d[0].get("name")
        url, _ = resolve_gdevelop_glb(str(asset_id))
        data = download_bytes(url)
        self.assertGreater(len(data), 1000)


if __name__ == "__main__":
    unittest.main()
