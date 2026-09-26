"""Tests for harness/assets/importer.py (run: python3 -m unittest harness.assets.test_importer)."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.assets.importer import (  # noqa: E402
    KTX2_MAGIC,
    PRESETS,
    TranscodeError,
    audit_scene_assets,
    build_manifest,
    check_reimport,
    find_basisu,
    import_asset,
    reimport_asset,
    resolve_uid,
    transcode_texture,
)

GLB_MAGIC = b"glTF" + b"\x00" * 100


class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_import_writes_bytes_and_sidecar(self):
        sidecar = import_asset(
            GLB_MAGIC, name="Crate", preset="mobile", assets_dir=self.dir
        )
        self.assertIn("uid", sidecar)
        self.assertEqual(sidecar["preset"], "mobile")
        self.assertEqual(sidecar["presetConfig"], PRESETS["mobile"])
        self.assertEqual(sidecar["importerVersion"], 1)
        self.assertEqual(sidecar["deps"], [])
        model_path = os.path.join(self.dir, sidecar["outputs"]["model"])
        self.assertTrue(os.path.isfile(model_path))
        with open(model_path, "rb") as fh:
            self.assertEqual(fh.read(), GLB_MAGIC)
        sidecar_path = os.path.join(self.dir, "Crate.import.json")
        self.assertTrue(os.path.isfile(sidecar_path))
        with open(sidecar_path) as fh:
            self.assertEqual(json.load(fh)["uid"], sidecar["uid"])

    def test_unknown_preset_and_empty_payload_rejected(self):
        with self.assertRaises(ValueError):
            import_asset(GLB_MAGIC, name="X", preset="ultra", assets_dir=self.dir)
        with self.assertRaises(ValueError):
            import_asset(b"", name="X", assets_dir=self.dir)

    def test_manifest_regenerates_from_sidecars(self):
        first = import_asset(GLB_MAGIC, name="A", assets_dir=self.dir)
        second = import_asset(
            GLB_MAGIC + b"1", name="B", preset="desktop", assets_dir=self.dir
        )
        manifest = build_manifest(self.dir)
        self.assertEqual(set(manifest), {first["uid"], second["uid"]})
        self.assertEqual(manifest[second["uid"]]["preset"], "desktop")
        # Missing dir -> empty manifest, never an exception.
        self.assertEqual(build_manifest(os.path.join(self.dir, "nope")), {})

    def test_reimport_preserves_uid_and_detects_change(self):
        sidecar = import_asset(GLB_MAGIC, name="Crate", assets_dir=self.dir)
        same, changed = reimport_asset(self.dir, GLB_MAGIC, "Crate.import.json")
        self.assertFalse(changed)
        self.assertEqual(same["uid"], sidecar["uid"])
        evolved, changed = reimport_asset(
            self.dir, GLB_MAGIC + b"v2", "Crate.import.json"
        )
        self.assertTrue(changed)
        self.assertEqual(evolved["uid"], sidecar["uid"])
        manifest = build_manifest(self.dir)
        self.assertEqual(manifest[sidecar["uid"]]["sha256"], evolved["sha256"])

    def test_check_reimport_statuses(self):
        import_asset(GLB_MAGIC, name="Crate", assets_dir=self.dir)
        ok = check_reimport(self.dir, {"Crate.import.json": GLB_MAGIC})
        self.assertEqual(
            [(s["sidecar"], s["status"]) for s in ok], [("Crate.import.json", "ok")]
        )
        stale = check_reimport(self.dir, {"Crate.import.json": GLB_MAGIC + b"edit"})
        self.assertEqual(stale[0]["status"], "stale")
        missing = check_reimport(self.dir, {})
        self.assertEqual(missing[0]["status"], "source-missing")

    def test_resolve_uid_with_passthrough(self):
        sidecar = import_asset(GLB_MAGIC, name="Crate", assets_dir=self.dir)
        manifest = build_manifest(self.dir)
        resolved = resolve_uid(manifest, f"uid://{sidecar['uid']}")
        self.assertEqual(resolved, sidecar["outputs"]["model"])
        self.assertIsNone(resolve_uid(manifest, "uid://deadbeef"))
        remote = "https://example.com/model.glb"
        self.assertEqual(resolve_uid(manifest, remote), remote)

    def test_audit_scene_assets(self):
        sidecar = import_asset(GLB_MAGIC, name="Crate", assets_dir=self.dir)
        uid = sidecar["uid"]
        clean = {
            "gameObjects": [
                {"name": "Local", "modelUrl": f"uid://{uid}"},
                {"name": "Remote", "modelUrl": "https://example.com/x.glb"},
                {"name": "Plain"},
            ]
        }
        self.assertEqual(audit_scene_assets(clean, self.dir), [])
        # Nested engine-exported schema resolves too.
        nested = {
            "gameObjects": [
                {
                    "name": "N",
                    "components": [
                        {"type": "ModelRenderer", "modelUrl": f"uid://{uid}"}
                    ],
                },
            ]
        }
        self.assertEqual(audit_scene_assets(nested, self.dir), [])

        unknown = {"gameObjects": [{"name": "Ghost", "modelUrl": "uid://nope"}]}
        violations = audit_scene_assets(unknown, self.dir)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["code"], "ASSET_UNKNOWN_UID")
        self.assertEqual(violations[0]["entity"], "Ghost")

        # Corrupt the stored bytes behind the sidecar's back -> stale.
        with open(os.path.join(self.dir, sidecar["outputs"]["model"]), "ab") as fh:
            fh.write(b"tamper")
        stale_scene = {"gameObjects": [{"name": "Local", "modelUrl": f"uid://{uid}"}]}
        violations = audit_scene_assets(stale_scene, self.dir)
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["code"], "ASSET_REIMPORT_NEEDED")


if __name__ == "__main__":
    unittest.main()


def _png_bytes(width, height, color=(200, 40, 40, 255)):
    from PIL import Image

    buffer = __import__("io").BytesIO()
    Image.new("RGBA", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _fake_transcoder(basisu_bin, src_png, out_dir):
    out = __import__("os").path.join(out_dir, "src.ktx2")
    with open(out, "wb") as fh:
        fh.write(KTX2_MAGIC + b"fake-etc1s-payload")
    return out


class TranscodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_fake_transcoder_round_trip(self):
        sidecar = transcode_texture(
            _png_bytes(64, 64),
            name="brick",
            preset="mobile",
            assets_dir=self.dir,
            transcoder=_fake_transcoder,
        )
        self.assertEqual(sidecar["outputs"]["texture"], f"{sidecar['uid']}.ktx2")
        self.assertEqual(sidecar["transcode"]["format"], "ktx2-etc1s")
        with open(os.path.join(self.dir, sidecar["outputs"]["texture"]), "rb") as fh:
            self.assertTrue(fh.read().startswith(KTX2_MAGIC))
        manifest = build_manifest(self.dir)
        self.assertIn(sidecar["uid"], manifest)

    def test_large_image_shrinks_to_preset(self):
        seen = {}

        def spy(basisu_bin, src_png, out_dir):
            from PIL import Image

            with Image.open(src_png) as frame:
                seen["size"] = frame.size
            return _fake_transcoder(basisu_bin, src_png, out_dir)

        sidecar = transcode_texture(
            _png_bytes(2048, 1024),
            name="big",
            preset="mobile",
            assets_dir=self.dir,
            transcoder=spy,
        )
        self.assertLessEqual(max(seen["size"]), 1024)
        self.assertEqual(sidecar["transcode"]["outWidth"], seen["size"][0])

    def test_missing_binary_is_explicit(self):
        import unittest.mock as mock

        with mock.patch.dict(os.environ, {"PATH": "/nonexistent", "BASISU_BIN": ""}):
            with self.assertRaises(TranscodeError):
                transcode_texture(
                    _png_bytes(16, 16),
                    name="x",
                    assets_dir=self.dir,
                    basisu_bin="/nonexistent/basisu",
                )
            self.assertIsNone(find_basisu("/nonexistent/basisu"))

    def test_bad_payloads_rejected(self):
        with self.assertRaises(TranscodeError):
            transcode_texture(
                b"", name="x", assets_dir=self.dir, transcoder=_fake_transcoder
            )
        with self.assertRaises(TranscodeError):
            transcode_texture(
                b"not-an-image",
                name="x",
                assets_dir=self.dir,
                transcoder=_fake_transcoder,
            )
        with self.assertRaises(TranscodeError):
            transcode_texture(
                _png_bytes(8, 8),
                name="x",
                preset="nope",
                assets_dir=self.dir,
                transcoder=_fake_transcoder,
            )

    def test_bad_magic_rejected(self):
        def liar(basisu_bin, src_png, out_dir):
            out = os.path.join(out_dir, "src.ktx2")
            with open(out, "wb") as fh:
                fh.write(b"not really ktx2")
            return out

        with self.assertRaises(TranscodeError):
            transcode_texture(
                _png_bytes(8, 8), name="x", assets_dir=self.dir, transcoder=liar
            )
