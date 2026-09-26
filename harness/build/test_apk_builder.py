"""
Unit tests for the APK packaging pipeline helpers.

These cover the environment-resolution logic that the packaging pipeline relies
on (NDK discovery, JDK 17-23 validation for Gradle 8.11, tier dispatch) without
invoking the heavy toolchains — the real Gradle/NDK builds are exercised by the
`--tier2` E2E path documented in AGENTS.md.

Run from the repository root:
    python3 -m unittest harness.build.test_apk_builder
"""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.build.apk_builder import AndroidApkBuilder  # noqa: E402


class JavaMajorTests(unittest.TestCase):
    def test_parses_modern_version_string(self):
        # openjdk version "21.0.12.1" 2026-08-18
        fake = mock.Mock()
        fake.stderr = (
            'openjdk version "21.0.12.1" 2026-08-18\nOpenJDK Runtime Environment\n'
        )
        fake.stdout = ""
        with mock.patch("harness.build.apk_builder.subprocess.run", return_value=fake):
            self.assertEqual(AndroidApkBuilder._java_major(Path("/fake/bin/java")), 21)

    def test_parses_legacy_1x_version_string(self):
        fake = mock.Mock()
        fake.stderr = 'java version "1.8.0_402"\n'
        fake.stdout = ""
        with mock.patch("harness.build.apk_builder.subprocess.run", return_value=fake):
            self.assertEqual(AndroidApkBuilder._java_major(Path("/fake/bin/java")), 8)

    def test_unparseable_output_returns_none(self):
        fake = mock.Mock()
        fake.stderr = "not a java version"
        fake.stdout = ""
        with mock.patch("harness.build.apk_builder.subprocess.run", return_value=fake):
            self.assertIsNone(AndroidApkBuilder._java_major(Path("/fake/bin/java")))

    def test_missing_binary_returns_none(self):
        with mock.patch(
            "harness.build.apk_builder.subprocess.run",
            side_effect=FileNotFoundError(),
        ):
            self.assertIsNone(AndroidApkBuilder._java_major(Path("/nope/bin/java")))


class FindJdkTests(unittest.TestCase):
    def test_skips_invalid_java_home_and_accepts_valid_candidate(self):
        """An invalid JAVA_HOME (e.g. a stale flatpak path) must be skipped."""
        builder = AndroidApkBuilder()
        good = Path("/usr/lib/jvm/java-21-openjdk")
        real_java = good / "bin" / "java"
        with (
            mock.patch.object(
                builder,
                "_jdk_candidates",
                return_value=[Path("/nonexistent/jbr"), good],
            ),
            mock.patch.object(builder, "_java_major", return_value=21) as major,
            mock.patch.object(
                Path,
                "exists",
                autospec=True,
                side_effect=lambda self: self == real_java,
            ),
        ):
            jdk = builder.find_jdk()
        self.assertEqual(jdk, good)
        major.assert_called_once_with(real_java)

    def test_rejects_too_new_runtime(self):
        """Gradle 8.11 rejects Java 24+; the detector must skip such candidates."""
        builder = AndroidApkBuilder()
        too_new = Path("/usr/lib/jvm/java-25-openjdk")
        real_java = too_new / "bin" / "java"
        with (
            mock.patch.object(builder, "_jdk_candidates", return_value=[too_new]),
            mock.patch.object(builder, "_java_major", return_value=25),
            mock.patch.object(
                Path,
                "exists",
                autospec=True,
                side_effect=lambda self: self == real_java,
            ),
        ):
            self.assertIsNone(builder.find_jdk())

    def test_returns_none_when_nothing_usable(self):
        builder = AndroidApkBuilder()
        with mock.patch.object(builder, "_jdk_candidates", return_value=[]):
            self.assertIsNone(builder.find_jdk())


class FindNdkTests(unittest.TestCase):
    def test_picks_newest_version_sorted_numerically(self):
        builder = AndroidApkBuilder()
        versions = [Path("/sdk/ndk/30.0.14904198"), Path("/sdk/ndk/9.0.1")]
        with (
            mock.patch.dict(os.environ, {"ANDROID_HOME": "/sdk"}),
            mock.patch.object(Path, "exists", autospec=True, return_value=True),
            mock.patch.object(
                Path, "iterdir", autospec=True, return_value=iter(versions)
            ),
            mock.patch.object(Path, "is_dir", autospec=True, return_value=True),
        ):
            self.assertEqual(builder.find_ndk(), Path("/sdk/ndk/30.0.14904198"))

    def test_no_android_home(self):
        builder = AndroidApkBuilder()
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(builder.find_ndk())


class TierDispatchTests(unittest.TestCase):
    def test_tier2_dispatches_to_native_pipeline(self):
        builder = AndroidApkBuilder()
        sentinel = {"success": True, "tier": 2}
        with mock.patch.object(builder, "build_tier2", return_value=sentinel) as tier2:
            res = builder.build_and_deploy(dry_run=True, tier=2)
        self.assertIs(res, sentinel)
        tier2.assert_called_once_with(
            dry_run=True, scene_path=None, quadtree=True, debug_layers=False
        )

    def test_tier2_dispatch_passes_debug_layers_flag(self):
        builder = AndroidApkBuilder(debug_layers=True)
        sentinel = {"success": True, "tier": 2}
        with mock.patch.object(builder, "build_tier2", return_value=sentinel) as tier2:
            builder.build_and_deploy(dry_run=True, tier=2)
        tier2.assert_called_once_with(
            dry_run=True, scene_path=None, quadtree=True, debug_layers=True
        )

    def test_default_tier_is_webview(self):
        builder = AndroidApkBuilder()
        with (
            mock.patch.object(builder, "build_tier2") as tier2,
            mock.patch.object(builder, "sync_assets_to_container", return_value=False),
        ):
            res = builder.build_and_deploy(dry_run=True)
        tier2.assert_not_called()
        self.assertFalse(res["success"])


if __name__ == "__main__":
    unittest.main()


class PlayBootTargetTests(unittest.TestCase):
    """apk_builder --play ships a title boot target (E.6 shipping leg)."""

    def test_play_writes_boot_txt(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "game"
            assets.mkdir()
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<html></html>")
            builder = AndroidApkBuilder(play="tide")
            with (
                mock.patch("harness.build.apk_builder.CONTAINER_ASSETS_DIR", assets),
                mock.patch("harness.build.apk_builder.APP_DIST_DIR", dist),
            ):
                self.assertTrue(builder.sync_assets_to_container())
            self.assertEqual((assets / "boot.txt").read_text(), "?play=tide")

    def test_no_play_writes_no_boot_txt(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "game"
            assets.mkdir()
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<html></html>")
            builder = AndroidApkBuilder()
            with (
                mock.patch("harness.build.apk_builder.CONTAINER_ASSETS_DIR", assets),
                mock.patch("harness.build.apk_builder.APP_DIST_DIR", dist),
            ):
                self.assertTrue(builder.sync_assets_to_container())
            self.assertFalse((assets / "boot.txt").exists())

    def test_play_rejects_query_injection(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "game"
            assets.mkdir()
            dist = Path(tmp) / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<html></html>")
            builder = AndroidApkBuilder(play="tide&evil=1")
            with (
                mock.patch("harness.build.apk_builder.CONTAINER_ASSETS_DIR", assets),
                mock.patch("harness.build.apk_builder.APP_DIST_DIR", dist),
            ):
                self.assertFalse(builder.sync_assets_to_container())


class DebugLayersFlagTests(unittest.TestCase):
    """apk_builder --debug-layers forces the validation-layer lookup on."""

    def test_accepts_bool_values(self):
        self.assertFalse(AndroidApkBuilder().debug_layers)
        self.assertTrue(AndroidApkBuilder(debug_layers=True).debug_layers)
        self.assertFalse(AndroidApkBuilder(debug_layers=False).debug_layers)

    def test_constructor_rejects_non_bool(self):
        for bad in ("yes", 1, None, ["true"]):
            with self.assertRaises(TypeError, msg=f"debug_layers={bad!r}"):
                AndroidApkBuilder(debug_layers=bad)

    def test_build_tier2_rejects_non_bool(self):
        builder = AndroidApkBuilder()
        # None is the valid "fall back to self.debug_layers" sentinel.
        for bad in ("yes", 1, ["true"]):
            with self.assertRaises(TypeError, msg=f"debug_layers={bad!r}"):
                builder.build_tier2(dry_run=True, debug_layers=bad)

    def test_build_tier2_none_falls_back_to_constructor(self):
        # None is the valid "fall back to self.debug_layers" sentinel.
        import json as _json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp) / "scene.json"
            scene.write_text(_json.dumps({"entities": []}))
            builder = AndroidApkBuilder(debug_layers=True)
            fake = mock.Mock()
            fake.returncode = 0
            fake.stdout = ""
            fake.stderr = ""
            with (
                mock.patch(
                    "harness.build.apk_builder.subprocess.run", return_value=fake
                ),
                mock.patch.object(AndroidApkBuilder, "find_ndk", return_value=None),
                mock.patch.object(
                    AndroidApkBuilder,
                    "stage_validation_layers",
                    return_value=(True, "staged (mock)"),
                ),
                mock.patch("harness.build.apk_builder.VULKAN_ASSETS_DIR", Path(tmp)),
            ):
                res = builder.build_tier2(scene_path=str(scene), debug_layers=None)
            # No ValueError: None resolved to the constructor's True.
            self.assertTrue(res["debug_layers"])

    def _tier2_configure_cmd(self, debug_layers):
        """Run build_tier2 with mocked toolchains; return cmake argv + mocks."""
        import json as _json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp) / "scene.json"
            scene.write_text(_json.dumps({"entities": [], "quadtree": {}}))
            builder = AndroidApkBuilder()
            calls = []

            def fake_run(cmd, **kwargs):
                calls.append(list(cmd) if isinstance(cmd, list) else cmd)
                fake = mock.Mock()
                fake.returncode = 0
                fake.stdout = ""
                fake.stderr = ""
                return fake

            with (
                mock.patch(
                    "harness.build.apk_builder.subprocess.run", side_effect=fake_run
                ),
                mock.patch.object(
                    AndroidApkBuilder, "find_ndk", return_value=Path("/fake/ndk")
                ),
                mock.patch.object(
                    AndroidApkBuilder,
                    "stage_validation_layers",
                    return_value=(True, "staged (mock)"),
                ) as stage,
                mock.patch.object(
                    AndroidApkBuilder,
                    "clear_staged_validation_layers",
                    return_value=[],
                ) as clear,
                mock.patch("harness.build.apk_builder.VULKAN_ASSETS_DIR", Path(tmp)),
                mock.patch(
                    "harness.build.apk_builder.VULKAN_CONTAINER_DIR",
                    Path(tmp) / "no-gradle",
                ),
            ):
                res = builder.build_tier2(
                    scene_path=str(scene), debug_layers=debug_layers
                )
            configure = next(c for c in calls if c[0] == "cmake" and "-S" in c)
            return configure, stage, clear, res

    def test_debug_layers_selects_relwithdebinfo_and_define(self):
        configure, stage, clear, res = self._tier2_configure_cmd(True)
        self.assertIn("-DCMAKE_BUILD_TYPE=RelWithDebInfo", configure)
        self.assertIn("-DHERETEK_FORCE_VALIDATION_LAYERS=ON", configure)
        stage.assert_called_once_with()
        clear.assert_not_called()
        self.assertTrue(res["validation_layers_staged"])

    def test_default_release_unchanged(self):
        configure, stage, clear, res = self._tier2_configure_cmd(False)
        self.assertIn("-DCMAKE_BUILD_TYPE=Release", configure)
        # OFF must be explicit: the reused CMake cache would otherwise leak a
        # previous ON from a --debug-layers run into a plain Release build.
        self.assertIn("-DHERETEK_FORCE_VALIDATION_LAYERS=OFF", configure)
        self.assertNotIn("-DHERETEK_FORCE_VALIDATION_LAYERS=ON", configure)
        stage.assert_not_called()
        clear.assert_called_once_with()
        self.assertFalse(res["validation_layers_staged"])

    def test_debug_layers_reaches_gradle_property(self):
        import json as _json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp) / "scene.json"
            scene.write_text(_json.dumps({"entities": []}))
            container = Path(tmp) / "container"
            (container).mkdir()
            (container / "gradlew").write_text("#!/bin/sh\n")
            import os as _os

            _os.chmod(container / "gradlew", 0o755)
            builder = AndroidApkBuilder()
            gradle_cmds = []

            def fake_run(cmd, **kwargs):
                if isinstance(cmd, list) and cmd and str(cmd[0]).endswith("gradlew"):
                    gradle_cmds.append([str(c) for c in cmd])
                fake = mock.Mock()
                fake.returncode = 0
                fake.stdout = ""
                fake.stderr = ""
                return fake

            with (
                mock.patch(
                    "harness.build.apk_builder.subprocess.run", side_effect=fake_run
                ),
                mock.patch.object(
                    AndroidApkBuilder, "find_ndk", return_value=Path("/fake/ndk")
                ),
                mock.patch.object(
                    AndroidApkBuilder,
                    "stage_validation_layers",
                    return_value=(True, "staged (mock)"),
                ),
                mock.patch.object(
                    AndroidApkBuilder, "find_jdk", return_value=Path("/fake/jdk")
                ),
                mock.patch("harness.build.apk_builder.VULKAN_ASSETS_DIR", Path(tmp)),
                mock.patch("harness.build.apk_builder.VULKAN_CONTAINER_DIR", container),
                mock.patch(
                    "harness.build.apk_builder.VULKAN_BUILD_DIR", Path(tmp) / "build"
                ),
            ):
                (Path(tmp) / "build" / "libheretek_native.so").parent.mkdir(
                    exist_ok=True
                )
                (Path(tmp) / "build" / "libheretek_native.so").write_bytes(b"so")
                builder.build_tier2(scene_path=str(scene), debug_layers=True)
            self.assertEqual(len(gradle_cmds), 1)
            self.assertIn("-PheretekForceValidationLayers=true", gradle_cmds[0])

    def test_dry_run_skips_staging(self):
        import json as _json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp) / "scene.json"
            scene.write_text(_json.dumps({"entities": []}))
            builder = AndroidApkBuilder()
            fake = mock.Mock()
            fake.returncode = 0
            fake.stdout = ""
            fake.stderr = ""
            with (
                mock.patch(
                    "harness.build.apk_builder.subprocess.run", return_value=fake
                ),
                mock.patch.object(
                    AndroidApkBuilder,
                    "stage_validation_layers",
                    return_value=(True, "staged (mock)"),
                ) as stage,
                mock.patch("harness.build.apk_builder.VULKAN_ASSETS_DIR", Path(tmp)),
            ):
                res = builder.build_tier2(
                    scene_path=str(scene), dry_run=True, debug_layers=True
                )
            stage.assert_not_called()
            self.assertTrue(res["success"])
            self.assertTrue(res["debug_layers"])
            self.assertFalse(res["validation_layers_staged"])

    def test_release_clears_stale_staged_layers_only(self):
        import json as _json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            scene = Path(tmp) / "scene.json"
            scene.write_text(_json.dumps({"entities": []}))
            jni = Path(tmp) / "jniLibs"
            stale = jni / "arm64-v8a" / "libVkLayer_khronos_validation.so"
            stale.parent.mkdir(parents=True)
            stale.write_bytes(b"stale")
            other = jni / "arm64-v8a" / "libother.so"
            other.write_bytes(b"keep me")
            builder = AndroidApkBuilder()
            fake = mock.Mock()
            fake.returncode = 0
            fake.stdout = ""
            fake.stderr = ""
            with (
                mock.patch(
                    "harness.build.apk_builder.subprocess.run", return_value=fake
                ),
                mock.patch.object(AndroidApkBuilder, "find_ndk", return_value=None),
                mock.patch("harness.build.apk_builder.TIER2_JNILIBS_DIR", jni),
                mock.patch("harness.build.apk_builder.VULKAN_ASSETS_DIR", Path(tmp)),
            ):
                builder.build_tier2(scene_path=str(scene), debug_layers=False)
            self.assertFalse(stale.exists())
            self.assertTrue(other.exists())
            self.assertEqual(other.read_bytes(), b"keep me")


class LayerCacheTests(unittest.TestCase):
    """Download cache: location, retry, corruption handling."""

    def _fake_layer_zip(self) -> bytes:
        import io
        import zipfile as _zf

        buf = io.BytesIO()
        with _zf.ZipFile(buf, "w") as archive:
            for abi in ("arm64-v8a", "x86_64"):
                archive.writestr(
                    f"android-binaries-1.4.357.0/{abi}/"
                    "libVkLayer_khronos_validation.so",
                    b"fake-layer-so",
                )
        return buf.getvalue()

    def test_cache_dir_env_override(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"HERETEK_VALIDATION_LAYER_CACHE": tmp}):
                self.assertEqual(AndroidApkBuilder._layer_cache_dir(), Path(tmp))

    def test_cache_default_is_gitignored(self):
        import subprocess as _sp

        default = AndroidApkBuilder._layer_cache_dir() / "probe.zip"
        out = _sp.run(
            ["git", "check-ignore", "-v", str(default)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            out.returncode,
            0,
            f"default layer cache {default} is not gitignored",
        )

    def test_corrupt_cache_redownloads_and_stages(self):
        import io
        import tempfile
        import urllib.error

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache"
            cache.mkdir()
            (cache / "android-binaries-1.4.357.0.zip").write_bytes(b"corrupt")
            jni = Path(tmp) / "jniLibs"
            resp = mock.MagicMock()
            resp.__enter__.return_value = io.BytesIO(self._fake_layer_zip())
            builder = AndroidApkBuilder()
            with (
                mock.patch.dict(
                    os.environ, {"HERETEK_VALIDATION_LAYER_CACHE": str(cache)}
                ),
                mock.patch(
                    "harness.build.apk_builder.urllib.request.urlopen",
                    side_effect=[
                        urllib.error.URLError("flaky network"),
                        resp,
                    ],
                ),
                mock.patch("harness.build.apk_builder.TIER2_JNILIBS_DIR", jni),
            ):
                ok, msg = builder.stage_validation_layers()
            self.assertTrue(ok, msg)
            for abi in ("arm64-v8a", "x86_64"):
                staged = jni / abi / "libVkLayer_khronos_validation.so"
                self.assertTrue(staged.is_file())
                self.assertEqual(staged.read_bytes(), b"fake-layer-so")

    def test_download_failure_cleans_partial_cache(self):
        import tempfile
        import urllib.error

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache"
            builder = AndroidApkBuilder()
            with (
                mock.patch.dict(
                    os.environ, {"HERETEK_VALIDATION_LAYER_CACHE": str(cache)}
                ),
                mock.patch(
                    "harness.build.apk_builder.urllib.request.urlopen",
                    side_effect=urllib.error.URLError("offline"),
                ),
                mock.patch("harness.build.apk_builder.LAYER_DOWNLOAD_ATTEMPTS", 2),
            ):
                ok, msg = builder.stage_validation_layers()
            self.assertFalse(ok)
            self.assertIn("2 attempts", msg)
            leftovers = list(cache.rglob("*")) if cache.exists() else []
            self.assertEqual(leftovers, [])
