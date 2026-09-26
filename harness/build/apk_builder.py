"""
Heretek 3D Android Studio — Automated APK Packaging & ADB Deployment Pipeline
Bundles the desktop/mobile WebGL2 Three.js application into the high-performance
Android container (hardware-accelerated WebView + AndroidBridge) and deploys via ADB.
"""

import os
import sys
import json
import shutil
import subprocess
import argparse
import urllib.request
import zipfile
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
APP_DIR = PROJECT_ROOT / "app"
APP_DIST_DIR = APP_DIR / "dist"
CONTAINER_DIR = PROJECT_ROOT / "templates" / "android-container"
CONTAINER_ASSETS_DIR = CONTAINER_DIR / "app" / "src" / "main" / "assets" / "game"
VULKAN_CONTAINER_DIR = PROJECT_ROOT / "templates" / "vulkan-container"
VULKAN_CPP_DIR = VULKAN_CONTAINER_DIR / "app" / "src" / "main" / "cpp"
VULKAN_ASSETS_DIR = VULKAN_CONTAINER_DIR / "app" / "src" / "main" / "assets"
VULKAN_BUILD_DIR = PROJECT_ROOT / "harness" / "build" / "tier2-build"

# Khronos prebuilt Android validation-layer binaries (delivery path (a)).
# The release publishes only the .zip/.tar.gz (no checksums — verified
# 2026-09-26), so integrity is checked structurally after download: every
# staged ABI must contain libVkLayer_khronos_validation.so.
VALIDATION_LAYERS_URL = (
    "https://github.com/KhronosGroup/Vulkan-ValidationLayers/releases/download/"
    "vulkan-sdk-1.4.357.0/android-binaries-1.4.357.0.zip"
)
VALIDATION_LAYER_LIB = "libVkLayer_khronos_validation.so"
# Staged ABIs must stay in sync with abiFilters in the Tier 2 build.gradle.kts.
VALIDATION_LAYER_ABIS = ("arm64-v8a", "x86_64")
# Layer-download cache. The default lives under harness/build/tier2-build/
# (covered by the root .gitignore), overridable per-run via
# HERETEK_VALIDATION_LAYER_CACHE. Resolved at call time — not import time —
# so tests can redirect it with the env var.
LAYER_CACHE_ENV_VAR = "HERETEK_VALIDATION_LAYER_CACHE"
LAYER_ARCHIVE_NAME = "android-binaries-1.4.357.0.zip"
LAYER_DOWNLOAD_TIMEOUT_S = 60
LAYER_DOWNLOAD_ATTEMPTS = 3
TIER2_JNILIBS_DIR = VULKAN_CONTAINER_DIR / "app" / "src" / "main" / "jniLibs"


class AndroidApkBuilder:
    def __init__(
        self,
        verbose: bool = False,
        scene_path: Optional[str] = None,
        quadtree: bool = True,
        play: Optional[str] = None,
        debug_layers: bool = False,
    ):
        if not isinstance(debug_layers, bool):
            raise TypeError(
                f"debug_layers must be bool, got {type(debug_layers).__name__}"
            )
        self.verbose = verbose
        self.scene_path = scene_path
        self.quadtree = quadtree
        self.play = play
        self.debug_layers = debug_layers

    def log(self, msg: str):
        # MCP stdio framing owns stdout; all human-readable logs go to stderr.
        print(f"[APK-Builder] {msg}", file=sys.stderr)

    def build_web_bundle(self) -> bool:
        """Compiles the TypeScript & Vite web bundle for production."""
        self.log(f"Compiling Studio WebGL production bundle in {APP_DIR}...")
        try:
            res = subprocess.run(
                ["npm", "--workspace=app", "run", "build"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                check=True,
            )
            if self.verbose:
                print(res.stdout, file=sys.stderr)
            self.log("WebGL bundle compiled successfully.")
            return True
        except subprocess.CalledProcessError as e:
            self.log(f"Failed to compile web bundle: {e.stderr}")
            return False

    def sync_assets_to_container(self) -> bool:
        """Copies dist files into the Android container assets directory."""
        if not APP_DIST_DIR.exists():
            self.log(
                f"Error: {APP_DIST_DIR} does not exist. Run build_web_bundle first."
            )
            return False

        self.log(f"Syncing bundle assets to {CONTAINER_ASSETS_DIR}...")
        CONTAINER_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

        # Clear existing assets
        for item in CONTAINER_ASSETS_DIR.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

        # Copy new build artifacts
        for item in APP_DIST_DIR.iterdir():
            dest = CONTAINER_ASSETS_DIR / item.name
            if item.is_dir():
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)

        # Per-title boot slice (apk_builder --play <slice>): boots straight
        # into the game instead of the studio shell. Absent = studio default.
        if self.play:
            import re as _re

            if not _re.fullmatch(r"[A-Za-z0-9_-]{1,32}", self.play):
                self.log(f"Invalid --play slice {self.play!r} (alphanumeric only).")
                return False
            (CONTAINER_ASSETS_DIR / "boot.txt").write_text(f"?play={self.play}")
            self.log(f"Title boot target written: ?play={self.play}")

        file_count = sum(1 for _ in CONTAINER_ASSETS_DIR.rglob("*") if _.is_file())
        self.log(f"Synced {file_count} web assets to Android container.")
        return True

    def check_adb_devices(self) -> List[str]:
        """Returns list of connected ADB device serials."""
        try:
            res = subprocess.run(
                ["adb", "devices"], capture_output=True, text=True, check=True
            )
            devices = []
            for line in res.stdout.strip().split("\n")[1:]:
                parts = line.strip().split()
                if len(parts) >= 2 and parts[1] == "device":
                    devices.append(parts[0])
            return devices
        except Exception:
            return []

    def build_and_deploy(
        self,
        device_serial: Optional[str] = None,
        dry_run: bool = False,
        build_only: bool = False,
        tier: int = 1,
    ) -> Dict[str, Any]:
        """
        Orchestrates full pipeline:
        1. Compile WebGL bundle
        2. Sync to Android assets
        3. Build APK with Gradle (or dry-run verification)
        4. Deploy to ADB device and launch

        tier=2 targets the native Vulkan container instead: exports the scene +
        shaders and cross-compiles libheretek_native.so with the NDK.
        """
        if tier == 2:
            return self.build_tier2(
                dry_run=dry_run,
                scene_path=self.scene_path,
                quadtree=self.quadtree,
                debug_layers=self.debug_layers,
            )

        result = {
            "success": False,
            "bundle_built": False,
            "assets_synced": False,
            "apk_path": None,
            "deployed": False,
            "message": "",
        }

        # 1. Build Web Bundle
        if not dry_run:
            if not self.build_web_bundle():
                result["message"] = "Vite build failed."
                return result
        result["bundle_built"] = True

        # 2. Sync Assets
        if not self.sync_assets_to_container():
            result["message"] = "Asset sync failed."
            return result
        result["assets_synced"] = True

        # 3. Check Gradle
        gradlew = CONTAINER_DIR / "gradlew"
        has_gradle = gradlew.exists() and os.access(str(gradlew), os.X_OK)

        apk_output_path = (
            CONTAINER_DIR
            / "app"
            / "build"
            / "outputs"
            / "apk"
            / "debug"
            / "app-debug.apk"
        )

        if dry_run or not has_gradle:
            self.log(
                f"Container assets verified. Target package: com.heretek.gamestudio (Dry run: {dry_run})"
            )
            result["success"] = True
            result["apk_path"] = str(apk_output_path)
            result["message"] = (
                "Assets packaged and synced to Android container successfully."
            )
            return result

        # Execute Gradle
        jdk = self.find_jdk()
        if jdk is None:
            result["message"] = (
                "Gradle wrapper present, but no JDK 17-23 found (set JAVA_HOME to a compatible JDK)."
            )
            return result
        self.log(f"Executing Gradle build in {CONTAINER_DIR} (JDK: {jdk})...")
        try:
            cmd = ["./gradlew", "assembleDebug"]
            env = dict(os.environ)
            env["JAVA_HOME"] = str(jdk)
            env["PATH"] = str(jdk / "bin") + os.pathsep + env.get("PATH", "")
            gradle = subprocess.run(
                cmd,
                cwd=str(CONTAINER_DIR),
                check=True,
                capture_output=True,
                text=True,
                env=env,
            )
            if self.verbose:
                self.log(f"Gradle output tail: {gradle.stdout[-400:]}")
            result["apk_path"] = str(apk_output_path)
        except subprocess.CalledProcessError as e:
            result["message"] = (
                f"Gradle assembleDebug failed: {(e.stderr or '')[-300:]}"
            )
            return result

        if build_only:
            result["success"] = True
            result["message"] = f"APK built at {apk_output_path}"
            return result

        # 4. Deploy via ADB
        devices = self.check_adb_devices()
        target_device = device_serial or (devices[0] if devices else None)

        if not target_device:
            self.log("No connected ADB devices detected. Skipping live deployment.")
            result["success"] = True
            result["message"] = (
                f"APK built at {apk_output_path}. No ADB device connected."
            )
            return result

        self.log(f"Deploying to device {target_device}...")
        try:
            install = subprocess.run(
                ["adb", "-s", target_device, "install", "-r", str(apk_output_path)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.log(f"adb install: {install.stdout.strip()[-200:]}")
            launch = subprocess.run(
                [
                    "adb",
                    "-s",
                    target_device,
                    "shell",
                    "am",
                    "start",
                    "-n",
                    "com.heretek.gamestudio/.MainActivity",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.log(f"adb launch: {launch.stdout.strip()[-200:]}")
            result["deployed"] = True
            result["success"] = True
            result["message"] = (
                f"Successfully installed and launched on {target_device}."
            )
        except Exception as e:
            result["message"] = f"ADB deployment failed: {e}"

        return result

    def find_ndk(self) -> Optional[Path]:
        """Locate the newest installed Android NDK under ANDROID_HOME."""
        android_home = os.environ.get("ANDROID_HOME") or os.environ.get(
            "ANDROID_SDK_ROOT"
        )
        if not android_home:
            return None
        ndk_root = Path(android_home) / "ndk"
        if not ndk_root.exists():
            return None
        versions = sorted(
            [d for d in ndk_root.iterdir() if d.is_dir()],
            key=lambda d: [int(p) if p.isdigit() else p for p in d.name.split(".")],
        )
        return versions[-1] if versions else None

    @staticmethod
    def _java_major(java_bin: Path) -> Optional[int]:
        """Return the major version of a java binary, or None if unusable."""
        try:
            res = subprocess.run(
                [str(java_bin), "-version"], capture_output=True, text=True, timeout=30
            )
            first = (res.stderr or res.stdout).splitlines()[0]
            token = first.split('"')[1] if '"' in first else ""
            major = int(token.split(".")[0])
            return major if major > 1 else int(token.split(".")[1])
        except Exception:
            return None

    def _jdk_candidates(self) -> List[Path]:
        """Ordered candidate JAVA_HOME locations (env first, then common installs)."""
        candidates: List[Path] = []
        env_home = os.environ.get("JAVA_HOME")
        if env_home:
            candidates.append(Path(env_home))
        candidates += [
            Path("/home/linuxbrew/.linuxbrew/opt/openjdk@21"),
            Path("/home/linuxbrew/.linuxbrew/opt/openjdk@17"),
        ]
        jvm_root = Path("/usr/lib/jvm")
        if jvm_root.exists():
            candidates += sorted([d for d in jvm_root.iterdir() if d.is_dir()])
        candidates += sorted(
            Path(p)
            for p in __import__("glob").glob(
                "/var/lib/flatpak/app/com.google.AndroidStudio/*/stable/*/files/extra/jbr"
            )
        )
        return candidates

    def find_jdk(self) -> Optional[Path]:
        """
        Best-effort JAVA_HOME for the Gradle wrapper. Gradle 8.11 supports
        running on JDK 17-23, so candidates are version-checked; an invalid or
        too-new JAVA_HOME (e.g. a stale flatpak path) is skipped.
        """
        for candidate in self._jdk_candidates():
            java_bin = candidate / "bin" / "java"
            if not java_bin.exists():
                continue
            major = self._java_major(java_bin)
            if major is not None and 17 <= major <= 23:
                return candidate
        return None

    @staticmethod
    def _layer_cache_dir() -> Path:
        """Download-cache dir: env override or the (gitignored) tier2-build dir."""
        override = os.environ.get(LAYER_CACHE_ENV_VAR)
        if override:
            return Path(override)
        return VULKAN_BUILD_DIR / ".layer-cache"

    def _download_layer_archive(self, dest: Path) -> Tuple[bool, str]:
        """Fetch the layer zip with timeout + retries; cleans partial artifacts."""
        last_error = "unknown error"
        for attempt in range(1, LAYER_DOWNLOAD_ATTEMPTS + 1):
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with (
                    urllib.request.urlopen(
                        VALIDATION_LAYERS_URL, timeout=LAYER_DOWNLOAD_TIMEOUT_S
                    ) as src,
                    open(dest, "wb") as dst,
                ):
                    shutil.copyfileobj(src, dst)
                if zipfile.is_zipfile(dest):
                    return True, f"downloaded on attempt {attempt}"
                last_error = "downloaded file is not a valid zip"
            except Exception as e:  # network error or timeout
                last_error = str(e) or type(e).__name__
            try:
                dest.unlink(missing_ok=True)
            except OSError:
                pass
            self.log(
                "Validation-layer download attempt "
                f"{attempt}/{LAYER_DOWNLOAD_ATTEMPTS} failed "
                f"({last_error}); retrying..."
            )
        return (
            False,
            f"Validation-layer download failed after {LAYER_DOWNLOAD_ATTEMPTS} "
            f"attempts ({last_error}); continuing without bundled layers.",
        )

    @staticmethod
    def clear_staged_validation_layers() -> List[str]:
        """
        Remove previously staged layer libraries from the Tier 2 jniLibs tree.
        Only the exact staged filenames are touched — never anything else.
        Returns the ABIs that had a stale file removed.
        """
        removed: List[str] = []
        for abi in VALIDATION_LAYER_ABIS:
            staged = TIER2_JNILIBS_DIR / abi / VALIDATION_LAYER_LIB
            try:
                if staged.is_file():
                    staged.unlink()
                    removed.append(abi)
            except OSError:
                pass
        return removed

    def stage_validation_layers(self) -> Tuple[bool, str]:
        """
        Fetch the Khronos prebuilt Android validation-layer binaries (cached)
        and stage libVkLayer_khronos_validation.so into the Tier 2 jniLibs
        tree. The Android loader picks up app-bundled layers automatically —
        no manifest needed.

        Returns (staged, message). A False result is non-fatal: the forced
        lookup is still compiled in and the runtime status line reports
        ABSENT, so the failure mode is observable, not silent.
        """
        try:
            cache_zip = self._layer_cache_dir() / LAYER_ARCHIVE_NAME
            if cache_zip.exists() and not zipfile.is_zipfile(cache_zip):
                self.log(
                    "Cached validation-layer archive is corrupt; re-downloading..."
                )
                cache_zip.unlink(missing_ok=True)
            if not cache_zip.exists():
                self.log(
                    "Downloading Khronos validation-layer binaries "
                    f"({VALIDATION_LAYERS_URL})..."
                )
                ok, msg = self._download_layer_archive(cache_zip)
                if not ok:
                    return False, msg
            with zipfile.ZipFile(cache_zip) as archive:
                names = set(archive.namelist())
                staged: List[str] = []
                for abi in VALIDATION_LAYER_ABIS:
                    member = f"android-binaries-1.4.357.0/{abi}/{VALIDATION_LAYER_LIB}"
                    if member not in names:
                        return (
                            False,
                            f"Validation-layer archive has no {abi} entry "
                            f"({member}); continuing without bundled layers.",
                        )
                    dest = TIER2_JNILIBS_DIR / abi / VALIDATION_LAYER_LIB
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    staged.append(f"{abi} ({dest.stat().st_size} bytes)")
            return True, f"Staged validation layers: {', '.join(staged)}."
        except zipfile.BadZipFile as e:
            try:
                (self._layer_cache_dir() / LAYER_ARCHIVE_NAME).unlink(missing_ok=True)
            except OSError:
                pass
            return (
                False,
                f"Validation-layer archive unreadable ({e}); corrupt cache "
                "removed, continuing without bundled layers.",
            )
        except Exception as e:
            return (
                False,
                f"Validation-layer staging failed ({e}); "
                "continuing without bundled layers.",
            )

    def build_tier2(
        self,
        dry_run: bool = False,
        scene_path: Optional[str] = None,
        quadtree: bool = True,
        debug_layers: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Tier 2 native Vulkan container pipeline:
        1. Export the canonical scene (+ focus-driven quadtree from scene.quadtree)
           into the container assets
        2. Cross-compile libheretek_native.so for arm64-v8a with the NDK toolchain
        3. Attempt APK assembly when the Gradle wrapper is present

        debug_layers=True stages the Khronos validation-layer binaries into
        jniLibs and forces the VK_LAYER_KHRONOS_validation lookup on
        (HERETEK_FORCE_VALIDATION_LAYERS) independent of NDEBUG, building the
        native lib as RelWithDebInfo. Default False leaves the Release build
        untouched: the define is passed as OFF explicitly (the reused CMake
        cache would otherwise leak a previous ON) and any stale staged layer
        libraries are removed from jniLibs. Dry runs skip download/staging.
        """
        if debug_layers is None:
            debug_layers = self.debug_layers
        if not isinstance(debug_layers, bool):
            raise TypeError(
                f"debug_layers must be bool, got {type(debug_layers).__name__}"
            )
        result = {
            "success": False,
            "tier": 2,
            "scene_exported": False,
            "scene_summary": None,
            "native_library": None,
            "apk_path": None,
            "debug_layers": debug_layers,
            "validation_layers_staged": False,
            "message": "",
        }

        # 1. Scene export — honor the scene's persisted terrain LOD config
        source_scene = (
            Path(scene_path)
            if scene_path
            else PROJECT_ROOT / "harness" / "scenes" / "active_scene.json"
        )
        quadtree_cfg = {}
        try:
            scene_data = json.loads(source_scene.read_text())
            quadtree_cfg = scene_data.get("quadtree") or {}
        except Exception:
            pass
        depth = int(quadtree_cfg.get("maxDepth", 3))
        focus = quadtree_cfg.get("focus") or [0.0, 0.0]

        export_cmd = [
            sys.executable,
            str(PROJECT_ROOT / "harness" / "build" / "scene_exporter.py"),
            "--scene",
            str(source_scene),
            "--out",
            str(VULKAN_ASSETS_DIR),
        ]
        if quadtree:
            export_cmd += [
                "--quadtree",
                "--lod-depth",
                str(depth),
                "--lod-focus",
                str(focus[0]),
                str(focus[1]),
            ]
        self.log(
            f"Exporting scene to {VULKAN_ASSETS_DIR} (quadtree depth {depth}, focus {focus})..."
        )
        export = subprocess.run(export_cmd, capture_output=True, text=True)
        if export.returncode not in (0, 1):  # 1 = draw-budget warning, still exported
            result["message"] = f"Scene export failed: {export.stderr[-300:]}"
            return result
        result["scene_exported"] = True
        summary_path = VULKAN_ASSETS_DIR / "scene.summary.json"
        if summary_path.exists():
            try:
                result["scene_summary"] = json.loads(summary_path.read_text())
            except Exception:
                pass

        # 2. NDK cross-compile (+ optional validation-layer staging)
        cmake_build_type = "Release"
        gradle_extra_args: List[str] = []
        # Always passed explicitly: VULKAN_BUILD_DIR is reused across runs and
        # a CMake option() never overrides an existing cache entry, so omitting
        # the -D on the Release path would leak a previous ON into Release.
        cmake_force_layers = [
            "-DHERETEK_FORCE_VALIDATION_LAYERS=" + ("ON" if debug_layers else "OFF")
        ]
        if debug_layers:
            if dry_run:
                self.log("Dry-run: skipping validation-layer download/staging.")
            else:
                staged, stage_msg = self.stage_validation_layers()
                result["validation_layers_staged"] = staged
                self.log(stage_msg)
            # RelWithDebInfo keeps NDEBUG defined (like Release) while adding
            # symbols — proving the forced lookup works independent of NDEBUG.
            cmake_build_type = "RelWithDebInfo"
            gradle_extra_args = ["-PheretekForceValidationLayers=true"]
        elif not dry_run:
            # A previous --debug-layers run stages layer .so files into
            # jniLibs; a plain Release build must not silently bundle them.
            removed = self.clear_staged_validation_layers()
            if removed:
                self.log(
                    "Removed stale staged validation layers: "
                    + ", ".join(removed)
                    + "."
                )
        ndk = self.find_ndk()
        if ndk is None:
            result["message"] = (
                "Scene exported, but no NDK found under ANDROID_HOME — native library not built."
            )
            return result
        if dry_run:
            result["success"] = True
            result["message"] = (
                f"Scene exported (quadtree depth {depth}). Dry-run: native build skipped "
                f"(NDK {ndk.name} detected)."
            )
            return result

        self.log(
            f"Cross-compiling libheretek_native.so with NDK {ndk.name} (arm64-v8a)..."
        )
        toolchain = ndk / "build" / "cmake" / "android.toolchain.cmake"
        configure = subprocess.run(
            [
                "cmake",
                "-G",
                "Unix Makefiles",
                "-S",
                str(VULKAN_CPP_DIR),
                "-B",
                str(VULKAN_BUILD_DIR),
                f"-DCMAKE_TOOLCHAIN_FILE={toolchain}",
                "-DANDROID_ABI=arm64-v8a",
                "-DANDROID_PLATFORM=android-24",
                f"-DCMAKE_BUILD_TYPE={cmake_build_type}",
            ]
            + cmake_force_layers,
            capture_output=True,
            text=True,
        )
        if configure.returncode != 0:
            result["message"] = f"CMake configure failed: {configure.stderr[-300:]}"
            return result
        build = subprocess.run(
            ["cmake", "--build", str(VULKAN_BUILD_DIR), "--parallel"],
            capture_output=True,
            text=True,
        )
        if build.returncode != 0:
            result["message"] = f"Native build failed: {build.stderr[-300:]}"
            return result
        so_path = VULKAN_BUILD_DIR / "libheretek_native.so"
        if not so_path.exists():
            result["message"] = (
                "Native build reported success but libheretek_native.so is missing."
            )
            return result
        result["native_library"] = str(so_path)

        # 3. APK assembly (requires the vendored Gradle wrapper + a JDK 17-23)
        gradlew = VULKAN_CONTAINER_DIR / "gradlew"
        if gradlew.exists() and os.access(str(gradlew), os.X_OK):
            jdk = self.find_jdk()
            if jdk is None:
                result["success"] = True
                result["message"] = (
                    f"Tier 2 native library built for arm64-v8a: {so_path}. "
                    "APK assembly skipped (no JDK 17-23 found for the Gradle wrapper — set JAVA_HOME)."
                )
                return result
            self.log(f"Assembling Tier 2 APK with Gradle (JDK: {jdk})...")
            env = dict(os.environ)
            env["JAVA_HOME"] = str(jdk)
            env["PATH"] = str(jdk / "bin") + os.pathsep + env.get("PATH", "")
            try:
                subprocess.run(
                    [str(gradlew), ":app:assembleDebug"] + gradle_extra_args,
                    cwd=str(VULKAN_CONTAINER_DIR),
                    check=True,
                    capture_output=True,
                    text=True,
                    env=env,
                )
                apk = (
                    VULKAN_CONTAINER_DIR
                    / "app"
                    / "build"
                    / "outputs"
                    / "apk"
                    / "debug"
                    / "app-debug.apk"
                )
                if apk.exists():
                    result["apk_path"] = str(apk)
            except subprocess.CalledProcessError as e:
                result["message"] = f"Gradle assemble failed: {(e.stderr or '')[-300:]}"
                return result
        else:
            self.log(
                "Gradle wrapper not present in the Tier 2 container — skipping APK assembly."
            )

        result["success"] = True
        if result["apk_path"]:
            result["message"] = (
                f"Tier 2 APK built: {result['apk_path']} (native library: {so_path})"
            )
        else:
            result["message"] = (
                f"Tier 2 native library built for arm64-v8a: {so_path}. "
                "APK assembly skipped (gradle wrapper not present — add it to assemble the APK)."
            )
        return result


def main():
    parser = argparse.ArgumentParser(
        description="Heretek Studio Android APK Packaging Pipeline"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Stage and verify assets without invoking Gradle/ADB",
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Build APK without deploying to device",
    )
    parser.add_argument(
        "--device", type=str, default=None, help="Target ADB device serial"
    )
    parser.add_argument(
        "--tier2",
        action="store_true",
        help="Target the native Vulkan container (export scene + NDK cross-compile)",
    )
    parser.add_argument(
        "--scene",
        default=None,
        help="Scene JSON to export for Tier 2 (default: the canonical active scene)",
    )
    parser.add_argument(
        "--no-quadtree",
        action="store_true",
        help="Skip the terrain quadtree export (demo scenes without terrain occlusion)",
    )
    parser.add_argument(
        "--debug-layers",
        action="store_true",
        help="Tier 2 only: stage the Khronos validation-layer binaries and force "
        "the VK_LAYER_KHRONOS_validation lookup on (RelWithDebInfo native lib). "
        "Release default is untouched.",
    )
    parser.add_argument(
        "--play",
        default=None,
        help="Tier 1 title boot slice (e.g. tide): ships assets/game/boot.txt "
        "with '?play=<slice>' so the container boots straight into the game",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    builder = AndroidApkBuilder(
        verbose=args.verbose,
        scene_path=args.scene,
        quadtree=not args.no_quadtree,
        play=args.play,
        debug_layers=args.debug_layers,
    )
    res = builder.build_and_deploy(
        device_serial=args.device,
        dry_run=args.dry_run,
        build_only=args.build_only,
        tier=2 if args.tier2 else 1,
    )
    print("\nResult: " + json.dumps(res))
    sys.exit(0 if res["success"] else 1)


if __name__ == "__main__":
    main()
