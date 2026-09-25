"""
One-command Android emulator smoke test for both containers (GitHub issue #5).

Boots a headless AVD (KVM host), builds/installs/launches the APKs, and asserts
the runtime telemetry that the on-device validation depends on:

  Tier 2 (native Vulkan): scene parse + terrain plan, real swapchain creation,
      VK_SUCCESS acquire/submit/present, an advancing frame counter, and a
      non-uniform frame readback (proves the renderer rasterizes pixels).
  Tier 1 (WebView): bundle load line and no fatal exceptions.

The assertion logic is pure and unit-tested; the orchestration is thin glue.

CLI:
    python3 harness/agents/emulator_smoke.py                 # boot + test both tiers
    python3 harness/agents/emulator_smoke.py --reuse         # use an attached device
    python3 harness/agents/emulator_smoke.py --tier2-only --keep
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ANDROID_HOME = Path(
    os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
)
ADB = str(ANDROID_HOME / "platform-tools" / "adb") if ANDROID_HOME else "adb"
EMULATOR = str(ANDROID_HOME / "emulator" / "emulator") if ANDROID_HOME else "emulator"

TIER1 = {
    "name": "tier1",
    "package": "com.heretek.gamestudio",
    "activity": ".MainActivity",
    "apk": REPO_ROOT
    / "templates"
    / "android-container"
    / "app"
    / "build"
    / "outputs"
    / "apk"
    / "debug"
    / "app-debug.apk",
}
TIER2 = {
    "name": "tier2",
    "package": "com.heretek.gamestudio.tier2",
    "activity": ".MainActivity",
    "apk": REPO_ROOT
    / "templates"
    / "vulkan-container"
    / "app"
    / "build"
    / "outputs"
    / "apk"
    / "debug"
    / "app-debug.apk",
}

SCENE_READY_RE = re.compile(
    r"Scene ready — draws=(\d+) instances=(\d+) terrainLeaves=(\d+) terrainVertices=(\d+)"
)
SURFACE_READY_RE = re.compile(
    r"Surface ready \((\d+)x(\d+)\) — swapchain \+ pipelines created"
)
PRESENT_STATUS_RE = re.compile(
    r"renderFrame status: acquire=(-?\d+) submit=(-?\d+) present=(-?\d+)"
)
FRAME_RE = re.compile(r"frame (\d+) presented")
VK_FAILURE_RE = re.compile(
    r"vk(QueuePresent|AcquireNextImage|CreateSwapchain|CreateAndroidSurface)\w* failed",
    re.I,
)


# ------------------------------------------------------------------ pure checks
def parse_ppm(data: bytes) -> Tuple[int, int, bytes]:
    """Parse a binary P6 PPM; returns (width, height, rgb bytes)."""
    match = re.match(rb"P6\s+(\d+)\s+(\d+)\s+255\s", data)
    if not match:
        raise ValueError("not a P6 PPM (missing header)")
    width, height = int(match.group(1)), int(match.group(2))
    pixels = data[match.end() :]
    if len(pixels) != width * height * 3:
        raise ValueError(
            f"pixel payload size mismatch: {len(pixels)} != {width * height * 3}"
        )
    return width, height, pixels


def frame_stats(pixels: bytes, sample_stride: int = 97) -> Dict[str, Any]:
    """Color statistics over a sampled grid of RGB pixels."""
    colors = set()
    for index in range(0, len(pixels) - 2, 3 * sample_stride):
        colors.add((pixels[index], pixels[index + 1], pixels[index + 2]))
    return {
        "uniqueColors": len(colors),
        "sampledPixels": len(range(0, len(pixels) - 2, 3 * sample_stride)),
    }


def check_frame_pixels(ppm_bytes: bytes, min_unique: int = 5) -> List[str]:
    """Failures for a frame readback (must decode and be non-uniform)."""
    failures: List[str] = []
    try:
        width, height, pixels = parse_ppm(ppm_bytes)
    except ValueError as error:
        return [f"frame readback is not a valid PPM: {error}"]
    if width < 320 or height < 240:
        failures.append(f"frame readback is suspiciously small: {width}x{height}")
    stats = frame_stats(pixels)
    if stats["uniqueColors"] < min_unique:
        failures.append(
            f"frame readback is uniform ({stats['uniqueColors']} unique colors < {min_unique}) — nothing rendered"
        )
    return failures


def check_tier2_logcat(lines: List[str]) -> List[str]:
    """Failures for the Tier 2 native renderer logcat telemetry."""
    failures: List[str] = []
    scene = [SCENE_READY_RE.search(line) for line in lines]
    scene = [m for m in scene if m]
    if not scene:
        failures.append(
            "missing 'Scene ready — draws=… terrainLeaves=… terrainVertices=…'"
        )
    elif int(scene[-1].group(3)) <= 0:
        failures.append("terrain plan has zero leaves (terrain_lod export missing?)")

    if not any(SURFACE_READY_RE.search(line) for line in lines):
        failures.append("missing 'Surface ready (WxH) — swapchain + pipelines created'")

    statuses = [PRESENT_STATUS_RE.search(line) for line in lines]
    statuses = [m for m in statuses if m]
    if not statuses:
        failures.append(
            "missing 'renderFrame status: acquire/submit/present' telemetry"
        )
    else:
        acquire, submit, present = (int(g) for g in statuses[-1].groups())
        if (acquire, submit, present) != (0, 0, 0):
            failures.append(
                f"Vulkan frame path not clean: acquire={acquire} submit={submit} present={present}"
            )

    frames = [
        int(FRAME_RE.search(line).group(1)) for line in lines if FRAME_RE.search(line)
    ]
    if len(frames) < 2:
        failures.append(
            "frame counter did not advance (need at least two 'frame N presented' lines)"
        )
    elif frames[-1] <= frames[0]:
        failures.append(f"frame counter stalled at {frames[-1]}")

    vk_failures = [line.strip() for line in lines if VK_FAILURE_RE.search(line)]
    if vk_failures:
        failures.append(f"Vulkan failure logged: {vk_failures[-1][:160]}")
    return failures


def check_tier1_logcat(lines: List[str]) -> List[str]:
    """Failures for the Tier 1 WebView container logcat telemetry."""
    failures: List[str] = []
    if not any("Loading 3D Android Game from:" in line for line in lines):
        failures.append("missing bundle load line ('Loading 3D Android Game from:')")
    fatals = [line for line in lines if "FATAL EXCEPTION" in line]
    if fatals:
        failures.append(f"fatal exception in logcat: {fatals[-1].strip()[:160]}")
    return failures


# ------------------------------------------------------------------ orchestration
class EmulatorSmoke:
    def __init__(
        self, avd: Optional[str], gpu: str, reuse: bool, keep: bool, skip_build: bool
    ):
        self.avd = avd
        self.gpu = gpu
        self.reuse = reuse
        self.keep = keep
        self.skip_build = skip_build
        self.booted = False
        self.results: List[Dict[str, Any]] = []

    # -- helpers -----------------------------------------------------------
    def run(
        self, cmd: List[str], timeout: int = 120, check: bool = False
    ) -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=check
        )

    def adb(self, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
        return self.run([ADB, *args], timeout=timeout)

    def attached_device(self) -> Optional[str]:
        proc = self.adb("devices")
        for line in proc.stdout.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                return parts[0]
        return None

    def find_avd(self) -> Optional[str]:
        proc = self.run([EMULATOR, "-list-avds"])
        avds = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
        return avds[0] if avds else None

    # -- lifecycle ---------------------------------------------------------
    def boot(self) -> Optional[str]:
        device = self.attached_device()
        if self.reuse:
            if not device:
                raise RuntimeError("--reuse given but no device is attached")
            self.booted = True
            return device
        if device:
            print(f"[smoke] using already-attached device {device}")
            self.booted = True
            return device

        avd = self.avd or self.find_avd()
        if not avd:
            raise RuntimeError("no AVD available (create one or pass --avd)")
        print(f"[smoke] booting AVD {avd} (gpu={self.gpu})...")
        subprocess.Popen(
            [
                EMULATOR,
                "-avd",
                avd,
                "-no-window",
                "-no-audio",
                "-no-snapshot",
                "-no-boot-anim",
                "-gpu",
                self.gpu,
                "-memory",
                "3072",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        deadline = time.time() + 300
        while time.time() < deadline:
            proc = self.adb("shell", "getprop", "sys.boot_completed", timeout=30)
            if proc.stdout.strip() == "1":
                self.booted = True
                return self.attached_device()
            time.sleep(4)
        raise RuntimeError("emulator did not finish booting within 300s")

    def shutdown(self) -> None:
        if self.booted and not self.keep and not self.reuse:
            self.adb("emu", "kill", timeout=30)

    # -- per-tier flow -----------------------------------------------------
    def build(self, tier: Dict[str, Any]) -> None:
        if self.skip_build:
            return
        print(f"[smoke] building {tier['name']} APK...")
        args = ["python3", "harness/build/apk_builder.py"]
        if tier["name"] == "tier2":
            args.append("--tier2")
        proc = self.run(args, timeout=1800)
        if proc.returncode != 0:
            raise RuntimeError(
                f"apk_builder failed for {tier['name']}: {(proc.stdout + proc.stderr)[-400:]}"
            )

    def install_launch(self, tier: Dict[str, Any]) -> None:
        if not tier["apk"].exists():
            raise RuntimeError(f"APK missing: {tier['apk']}")
        install = self.adb("install", "-r", str(tier["apk"]), timeout=300)
        if "Success" not in install.stdout:
            raise RuntimeError(f"adb install failed: {(install.stdout + install.stderr).strip()[-200:]}")
        self.adb("logcat", "-c", timeout=30)
        self.adb(
            "shell",
            "am",
            "start",
            "-n",
            f"{tier['package']}/{tier['activity']}",
            timeout=60,
        )

    def collect(self, tier: Dict[str, Any], seconds: int = 30) -> List[str]:
        """Poll logcat until the tier's assertions pass or `seconds` elapse."""
        deadline = time.time() + seconds
        lines: List[str] = []
        checker = check_tier2_logcat if tier["name"] == "tier2" else check_tier1_logcat
        while time.time() < deadline:
            proc = self.adb("logcat", "-d", timeout=60)
            lines = proc.stdout.splitlines()
            if not checker(lines):
                break
            time.sleep(2)
        return lines

    def pull_frame(self, tier: Dict[str, Any]) -> bytes:
        proc = subprocess.run(
            [
                ADB,
                "exec-out",
                "run-as",
                tier["package"],
                "cat",
                "files/native_frame.ppm",
            ],
            capture_output=True,
            timeout=120,
        )
        return proc.stdout

    def test_tier(self, tier: Dict[str, Any]) -> Dict[str, Any]:
        result: Dict[str, Any] = {"tier": tier["name"], "failures": [], "checks": {}}
        try:
            self.build(tier)
            self.install_launch(tier)
            lines = self.collect(tier)
            if tier["name"] == "tier2":
                failures = check_tier2_logcat(lines)
                ppm = self.pull_frame(tier)
                frame_failures = check_frame_pixels(ppm)
                failures += frame_failures
                result["checks"] = {
                    "logLines": len(lines),
                    "frameBytes": len(ppm),
                    "lastLines": [line.strip()[:120] for line in lines if "HeretekTier2" in line][-3:],
                }
            else:
                failures = check_tier1_logcat(lines)
                result["checks"] = {
                    "logLines": len(lines),
                    "lastLines": [line.strip()[:120] for line in lines if "Heretek3DGame" in line][-3:],
                }
            result["failures"] = failures
            result["ok"] = not failures
        except Exception as error:
            result["failures"] = [f"exception: {error}"]
            result["ok"] = False
        self.results.append(result)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Emulator smoke test for both Android containers"
    )
    parser.add_argument(
        "--avd", default=None, help="AVD name (default: first available)"
    )
    parser.add_argument(
        "--gpu", default="lavapipe", help="Emulator GPU mode (default lavapipe)"
    )
    parser.add_argument(
        "--reuse", action="store_true", help="Use an already-attached device"
    )
    parser.add_argument(
        "--keep", action="store_true", help="Leave the emulator running"
    )
    parser.add_argument("--skip-build", action="store_true", help="Reuse existing APKs")
    parser.add_argument("--tier1-only", action="store_true")
    parser.add_argument("--tier2-only", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    smoke = EmulatorSmoke(args.avd, args.gpu, args.reuse, args.keep, args.skip_build)
    summary: Dict[str, Any] = {"results": [], "ok": False}
    try:
        device = smoke.boot()
        tiers = []
        if not args.tier2_only:
            tiers.append(TIER1)
        if not args.tier1_only:
            tiers.append(TIER2)
        for tier in tiers:
            result = smoke.test_tier(tier)
            status = "PASS" if result["ok"] else "FAIL"
            print(
                f"[smoke] {tier['name']}: {status}"
                + (f" — {result['failures']}" if result["failures"] else "")
            )
            summary["results"].append(result)
        summary["ok"] = all(r["ok"] for r in summary["results"])
        summary["device"] = device
    except Exception as error:
        summary["error"] = str(error)
    finally:
        smoke.shutdown()

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"\n[smoke] overall: {'PASS' if summary.get('ok') else 'FAIL'}")
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
