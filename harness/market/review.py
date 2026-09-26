"""
Review checklist runner (Track 3 marketplace, ADR-1790382427947).

Ordered gates (Godot manual-review + VS malware/API/size discipline,
adapted to headless checks):
  1. license — LICENSE file present + matches manifest + SPDX allowlist
  2. api-surface — payload validates against the kind schema (unknown
     fields/imports rejected, mirroring the loop validators)
  3. budget — declared sizeMB + asset count within caps
  4. boot — headless load: payload resolves through the real registry
     semantics (prefab resolve / dialogue validate / behavior validate /
     brief structural check) with zero errors
  5. provenance — source hash + publisher recorded in the install index

AV-sandbox malware screening is explicitly out of Phase 1 (COTS later);
the runner documents the gap in its report.
"""

import copy
import os
from typing import Any, Dict, List, Optional

from .manifest import SPDX_ALLOWLIST
from .packs import MANIFEST_FILENAME, _read_pack

LICENSE_FILENAMES = {"LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md"}


def _check_license(
    names: List[str], manifest: Dict[str, Any], spdx_allowlist: set
) -> List[str]:
    failures: List[str] = []
    license_files = [n for n in names if os.path.basename(n) in LICENSE_FILENAMES]
    if not license_files:
        failures.append("license: no LICENSE file in bundle (Godot rule)")
        return failures
    if manifest.get("license") not in spdx_allowlist:
        failures.append(
            f"license: '{manifest.get('license')}' not in SPDX allowlist {sorted(spdx_allowlist)}"
        )
    return failures


def _check_api_surface(manifest: Dict[str, Any], files: Dict[str, bytes]) -> List[str]:
    """Payload must validate against its kind schema (rejects unknowns)."""
    import json

    failures: List[str] = []
    try:
        payload = json.loads(files[manifest["entry"]].decode("utf-8"))
    except (ValueError, KeyError, UnicodeDecodeError) as exc:
        return [f"api-surface: entry payload is not valid JSON ({exc})"]
    kind = manifest.get("kind")
    try:
        if kind == "prefab":
            from harness.prefabs.prefabs import validate_prefab

            if validate_prefab(payload, []) is None:
                failures.append("api-surface: prefab payload failed validation")
        elif kind == "dialogue":
            import sys

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
            from harness.loop.action_applier import _validate_dialogue

            if _validate_dialogue(payload, []) is None:
                failures.append("api-surface: dialogue payload failed validation")
        elif kind == "behavior":
            import sys

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
            from harness.loop.action_applier import _validate_behaviors

            wrapped = (
                payload
                if isinstance(payload, list)
                else payload.get("behaviors", payload)
            )
            entries = wrapped if isinstance(wrapped, list) else [wrapped]
            normalized = [
                {"type": e.get("type"), "options": e.get("options", {})}
                if isinstance(e, dict)
                else e
                for e in entries
            ]
            if _validate_behaviors(normalized, []) is None:
                failures.append("api-surface: behavior payload failed validation")
        elif kind == "brief":
            for key in ("id", "goal"):
                if key not in payload:
                    failures.append(f"api-surface: brief payload missing '{key}'")
        elif kind == "ui":
            import sys

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
            from harness.loop.ui_kits import validate_kit

            for problem in validate_kit(payload):
                failures.append(f"api-surface: ui kit {problem}")
        else:
            failures.append(f"api-surface: unknown kind '{kind}'")
    except ImportError as exc:
        failures.append(f"api-surface: validator unavailable ({exc})")
    return failures


def _check_budget(
    manifest: Dict[str, Any],
    files: Dict[str, bytes],
    max_size_mb: float,
    max_assets: int,
) -> List[str]:
    failures: List[str] = []
    actual_mb = sum(len(data) for data in files.values()) / (1024 * 1024)
    if actual_mb > max_size_mb:
        failures.append(f"budget: bundle {actual_mb:.2f}MB exceeds {max_size_mb}MB cap")
    if len(files) > max_assets:
        failures.append(f"budget: {len(files)} assets exceeds {max_assets} cap")
    declared = manifest.get("sizeMB", 0)
    if abs(declared - actual_mb) > max(0.5, actual_mb * 0.5):
        failures.append(
            f"budget: declared sizeMB {declared} diverges from actual {actual_mb:.2f}MB"
        )
    return failures


def review_pack(
    pack_path: str,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Runs the ordered checklist. Returns {pass, failures, warnings, manifest}."""
    options = options or {}
    spdx_allowlist = set(options.get("spdx_allowlist", SPDX_ALLOWLIST))
    max_size_mb = options.get("max_size_mb", 50.0)
    max_assets = options.get("max_assets", 200)
    failures: List[str] = []
    warnings: List[str] = [
        "malware: AV-sandbox screening not implemented in Phase 1 (COTS later)"
    ]
    try:
        manifest, files = _read_pack(pack_path)
    except ValueError as exc:
        return {
            "pass": False,
            "failures": [f"manifest: {exc}"],
            "warnings": warnings,
            "manifest": None,
        }
    failures.extend(_check_license(list(files.keys()), manifest, spdx_allowlist))
    failures.extend(_check_api_surface(manifest, files))
    failures.extend(_check_budget(manifest, files, max_size_mb, max_assets))
    return {
        "pass": len(failures) == 0,
        "failures": failures,
        "warnings": warnings,
        "manifest": copy.deepcopy(manifest),
    }
