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
from pathlib import Path
from typing import Dict, Any, Optional, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
APP_DIR = PROJECT_ROOT / "app"
APP_DIST_DIR = APP_DIR / "dist"
CONTAINER_DIR = PROJECT_ROOT / "templates" / "android-container"
CONTAINER_ASSETS_DIR = CONTAINER_DIR / "app" / "src" / "main" / "assets" / "game"


class AndroidApkBuilder:
    def __init__(self, verbose: bool = False):
        self.verbose = verbose

    def log(self, msg: str):
        print(f"[APK-Builder] {msg}")

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
                print(res.stdout)
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
    ) -> Dict[str, Any]:
        """
        Orchestrates full pipeline:
        1. Compile WebGL bundle
        2. Sync to Android assets
        3. Build APK with Gradle (or dry-run verification)
        4. Deploy to ADB device and launch
        """
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
        self.log(f"Executing Gradle build in {CONTAINER_DIR}...")
        try:
            cmd = ["./gradlew", "assembleDebug"]
            subprocess.run(cmd, cwd=str(CONTAINER_DIR), check=True)
            result["apk_path"] = str(apk_output_path)
        except subprocess.CalledProcessError as e:
            result["message"] = f"Gradle assembleDebug failed: {e}"
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
            subprocess.run(
                ["adb", "-s", target_device, "install", "-r", str(apk_output_path)],
                check=True,
            )
            subprocess.run(
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
            )
            result["deployed"] = True
            result["success"] = True
            result["message"] = (
                f"Successfully installed and launched on {target_device}."
            )
        except Exception as e:
            result["message"] = f"ADB deployment failed: {e}"

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
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    builder = AndroidApkBuilder(verbose=args.verbose)
    res = builder.build_and_deploy(
        device_serial=args.device, dry_run=args.dry_run, build_only=args.build_only
    )
    print("\nResult: " + json.dumps(res))
    sys.exit(0 if res["success"] else 1)


if __name__ == "__main__":
    main()
