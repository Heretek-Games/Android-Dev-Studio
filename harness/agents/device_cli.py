#!/usr/bin/env python3
"""
Device CLI — real ADB device detection for the studio bridge.

`GET /api/devices` (dev-server middleware) invokes this to report the actual
attached Android devices/emulators instead of the previously mocked list.

Usage:
    python3 harness/agents/device_cli.py list

Output (stdout JSON):
    {"ok": true, "error": null, "devices": [{id, model, status, isEmulator, product, device, transportId}], "adbPath": "..."}
    {"ok": false, "error": "...", "devices": []}
"""

import json
import os
import shutil
import subprocess
import sys


def find_adb() -> str:
    for env_var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        sdk = os.environ.get(env_var)
        if sdk:
            candidate = os.path.join(sdk, "platform-tools", "adb")
            if os.path.exists(candidate):
                return candidate
    return shutil.which("adb") or ""


def list_devices() -> dict:
    adb = find_adb()
    if not adb:
        return {
            "ok": False,
            "error": "adb not found (set ANDROID_HOME or add platform-tools to PATH)",
            "devices": [],
        }

    try:
        proc = subprocess.run(
            [adb, "devices", "-l"], capture_output=True, text=True, timeout=15
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"adb failed: {e}", "devices": []}

    devices = []
    for raw in proc.stdout.splitlines():
        line = raw.strip()
        if not line or line.startswith("List of"):
            continue
        parts = line.split()
        serial = parts[0]
        state = parts[1] if len(parts) > 1 else "unknown"
        attrs = {}
        for token in parts[2:]:
            if ":" in token:
                key, value = token.split(":", 1)
                attrs[key] = value
        devices.append(
            {
                "id": serial,
                "model": attrs.get("model", serial).replace("_", " "),
                "status": state,
                "isEmulator": serial.startswith("emulator-"),
                "product": attrs.get("product"),
                "device": attrs.get("device"),
                "transportId": attrs.get("transport_id"),
            }
        )

    return {"ok": True, "error": None, "devices": devices, "adbPath": adb}


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "list"
    if command != "list":
        print(
            json.dumps(
                {"ok": False, "error": f"unknown command: {command}", "devices": []}
            )
        )
        return 2
    print(json.dumps(list_devices()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
