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
                builder, "_jdk_candidates", return_value=[Path("/nonexistent/jbr"), good]
            ),
            mock.patch.object(builder, "_java_major", return_value=21) as major,
            mock.patch.object(
                Path, "exists", autospec=True, side_effect=lambda self: self == real_java
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
                Path, "exists", autospec=True, side_effect=lambda self: self == real_java
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
        tier2.assert_called_once_with(dry_run=True, scene_path=None, quadtree=True)

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
