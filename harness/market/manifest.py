"""
Extension pack manifests (Track 3 marketplace, ADR-1790382427947).

`heretek.json` shape (UPM/npm-inspired, Godot-review-informed):
    {
      "name": "com.heretek.coin-pack",   # reverse-domain, required
      "version": "1.2.0",                # SemVer, required
      "displayName": "Coin Pack",        # optional
      "description": "...",              # optional
      "engine": ">=1.0.0",              # engine-API pin, required
      "kind": "prefab",                  # behavior|prefab|brief|dialogue|ui, required
      "entry": "coin.json",              # payload path inside the pack, required
      "dependencies": {"com.heretek.core": "1.0.0"},  # exact pins only (UPM rule)
      "license": "MIT",                  # SPDX id, required
      "assets": ["coin.json"],           # payload files, required non-empty
      "sizeMB": 0.4                      # declared size for budget gates
    }
"""

import re
from typing import Any, Dict, List, Optional

PACK_KINDS = {"behavior", "prefab", "brief", "dialogue", "ui"}

#: Permissive-only default allowlist (configurable at review time).
SPDX_ALLOWLIST = {
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "CC0-1.0",
    "Unlicense",
}

SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$"
)
NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)+$")
ENGINE_PIN_PATTERN = re.compile(r"^(>=|==|~=)?\d+\.\d+\.\d+$")


def _fail(errors: Optional[List[str]], reason: str) -> None:
    if errors is not None:
        errors.append(reason)


def validate_manifest(
    manifest: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Validates a heretek.json manifest. Returns a normalized copy or None."""

    def fail(reason: str) -> None:
        _fail(errors, reason)
        return None

    if not isinstance(manifest, dict):
        fail("manifest must be an object")
        return None
    name = manifest.get("name")
    if not isinstance(name, str) or not NAME_PATTERN.match(name):
        fail("manifest 'name' must be reverse-domain (e.g. com.heretek.coin-pack)")
        return None
    version = manifest.get("version")
    if not isinstance(version, str) or not SEMVER_PATTERN.match(version):
        fail("manifest 'version' must be SemVer (e.g. 1.2.0)")
        return None
    kind = manifest.get("kind")
    if kind not in PACK_KINDS:
        fail(f"manifest 'kind' must be one of {sorted(PACK_KINDS)} (got {kind!r})")
        return None
    entry = manifest.get("entry")
    if not isinstance(entry, str) or not entry.strip() or entry.startswith(("/", "..")):
        fail("manifest 'entry' must be a relative in-pack path")
        return None
    engine = manifest.get("engine")
    if not isinstance(engine, str) or not ENGINE_PIN_PATTERN.match(engine.strip()):
        fail("manifest 'engine' must be a version pin (e.g. >=1.0.0)")
        return None
    license_id = manifest.get("license")
    if not isinstance(license_id, str) or not license_id.strip():
        fail("manifest 'license' must be a non-empty SPDX id")
        return None
    dependencies = manifest.get("dependencies", {})
    if not isinstance(dependencies, dict):
        fail("manifest 'dependencies' must be a name->version map")
        return None
    for dep_name, dep_version in dependencies.items():
        if not isinstance(dep_name, str) or not NAME_PATTERN.match(dep_name):
            fail(f"dependency {dep_name!r} must be reverse-domain")
            return None
        # UPM rule: exact pins only, no ranges (reproducible installs).
        if not isinstance(dep_version, str) or not SEMVER_PATTERN.match(dep_version):
            fail(
                f"dependency '{dep_name}' must be an exact SemVer pin (got {dep_version!r})"
            )
            return None
    assets = manifest.get("assets", [])
    if (
        not isinstance(assets, list)
        or not assets
        or not all(
            isinstance(a, str) and a.strip() and not a.startswith(("/", ".."))
            for a in assets
        )
    ):
        fail("manifest 'assets' must be a non-empty array of relative paths")
        return None
    if entry.strip() not in [a.strip() for a in assets]:
        fail("manifest 'entry' must be listed in 'assets'")
        return None
    size_mb = manifest.get("sizeMB", 0)
    if (
        isinstance(size_mb, bool)
        or not isinstance(size_mb, (int, float))
        or size_mb < 0
    ):
        fail("manifest 'sizeMB' must be a non-negative number")
        return None
    normalized: Dict[str, Any] = {
        "name": name,
        "version": version,
        "kind": kind,
        "entry": entry.strip(),
        "engine": engine.strip(),
        "license": license_id.strip(),
        "dependencies": dict(dependencies),
        "assets": [a.strip() for a in assets],
        "sizeMB": float(size_mb),
    }
    for optional in ("displayName", "description"):
        if optional in manifest:
            if not isinstance(manifest[optional], str):
                fail(f"manifest '{optional}' must be a string")
                return None
            normalized[optional] = manifest[optional]
    for key in manifest:
        if key not in (
            "name",
            "version",
            "displayName",
            "description",
            "engine",
            "kind",
            "entry",
            "dependencies",
            "license",
            "assets",
            "sizeMB",
        ):
            fail(f"unknown manifest key '{key}'")
            return None
    return normalized


def manifest_id(manifest: Dict[str, Any]) -> str:
    """Canonical install key: name@version (npm/UPM parity)."""
    return f"{manifest['name']}@{manifest['version']}"
