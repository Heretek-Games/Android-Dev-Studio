"""
Pack lifecycle: create/install/enable/disable/uninstall .htepak bundles
(Track 3 marketplace, ADR-1790382427947).

`.htepak` = ZIP + root `heretek.json` (VS Code .vsix / Godot ZIP pattern).
Installs land in `packs/<name>@<version>/` with a file index; payloads
register into kind-appropriate stores (Godot checkbox enable model):

  - prefab   -> prefab registry (validate_prefab/resolve_prefab semantics)
  - brief    -> brief index (structural brief validation)
  - dialogue -> dialogue registry (loop dialogue-tree validation)
  - behavior -> preset index (loop behavior-array validation)

Only local folders + `packs/index.json` — no daemon or registry server.
"""

import copy
import hashlib
import io
import json
import os
import shutil
import zipfile
from typing import Any, Dict, List, Optional, Tuple

from .manifest import manifest_id, validate_manifest

MANIFEST_FILENAME = "heretek.json"
INDEX_FILENAME = "index.json"


def _packs_dir(root: str) -> str:
    return os.path.join(root, "packs")


def _index_path(root: str) -> str:
    return os.path.join(_packs_dir(root), INDEX_FILENAME)


def load_index(root: str) -> Dict[str, Any]:
    path = _index_path(root)
    if not os.path.isfile(path):
        return {"packs": {}}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get("packs"), dict):
            return data
    except (OSError, ValueError):
        pass
    return {"packs": {}}


def save_index(root: str, index: Dict[str, Any]) -> None:
    os.makedirs(_packs_dir(root), exist_ok=True)
    with open(_index_path(root), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=1)


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_pack(source_dir: str, out_path: str) -> Dict[str, Any]:
    """Zips a source dir (must hold heretek.json) into a .htepak bundle."""
    manifest_path = os.path.join(source_dir, MANIFEST_FILENAME)
    if not os.path.isfile(manifest_path):
        raise ValueError(f"{source_dir} has no {MANIFEST_FILENAME}")
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = validate_manifest(json.load(fh))
    if manifest is None:
        raise ValueError(f"{MANIFEST_FILENAME} failed validation")
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as archive:
        bundled = set()
        for asset in manifest["assets"] + [MANIFEST_FILENAME]:
            full = os.path.join(source_dir, asset)
            if not os.path.isfile(full):
                raise ValueError(f"pack asset missing on disk: {asset}")
            archive.write(full, asset)
            bundled.add(asset)
        # License files always ship (review requires one present).
        for extra in sorted(os.listdir(source_dir)):
            if extra not in bundled and extra.upper().startswith("LICENSE"):
                full = os.path.join(source_dir, extra)
                if os.path.isfile(full):
                    archive.write(full, extra)
    return {"manifest": manifest, "path": out_path, "sha256": sha256_file(out_path)}


def _read_pack(pack_path: str) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    """Returns (manifest, {path -> bytes}, all members included).

    Declared assets must exist; extra files (e.g. LICENSE) ride along for
    the review gates without counting as install payloads.
    """
    if not zipfile.is_zipfile(pack_path):
        raise ValueError(f"not a zip bundle: {pack_path}")
    with zipfile.ZipFile(pack_path) as archive:
        names = archive.namelist()
        if MANIFEST_FILENAME not in names:
            raise ValueError(f"bundle has no root {MANIFEST_FILENAME}")
        manifest = validate_manifest(
            json.loads(archive.read(MANIFEST_FILENAME).decode("utf-8"))
        )
        if manifest is None:
            raise ValueError(f"{MANIFEST_FILENAME} failed validation")
        files: Dict[str, bytes] = {}
        for asset in manifest["assets"]:
            if asset not in names:
                raise ValueError(f"bundle missing declared asset: {asset}")
            files[asset] = archive.read(asset)
        for extra in names:
            if (
                extra not in files
                and extra != MANIFEST_FILENAME
                and not extra.endswith("/")
            ):
                files[extra] = archive.read(extra)
    return manifest, files


def install_pack(
    root: str, pack_path: str, errors: Optional[List[str]] = None
) -> Optional[str]:
    """Installs a bundle; returns the pack id (name@version) or None.

    Dependency pins resolve against the installed index (exact versions,
    UPM rule); reinstalling the same id is refused (immutable versions,
    npm rule — bump the version instead).
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    try:
        manifest, files = _read_pack(pack_path)
    except ValueError as exc:
        fail(str(exc))
        return None
    pack_id = manifest_id(manifest)
    index = load_index(root)
    if pack_id in index["packs"]:
        fail(
            f"pack '{pack_id}' already installed (versions are immutable — bump instead)"
        )
        return None
    for dep_name, dep_version in manifest["dependencies"].items():
        satisfied = any(
            entry.get("manifest", {}).get("name") == dep_name
            and entry.get("manifest", {}).get("version") == dep_version
            for entry in index["packs"].values()
        )
        if not satisfied:
            fail(f"unsatisfied dependency '{dep_name}@{dep_version}' for '{pack_id}'")
            return None
    dest = os.path.join(_packs_dir(root), pack_id)
    os.makedirs(dest, exist_ok=True)
    try:
        for asset, data in files.items():
            full = os.path.join(dest, asset)
            os.makedirs(os.path.dirname(full) or dest, exist_ok=True)
            with open(full, "wb") as fh:
                fh.write(data)
        with open(os.path.join(dest, MANIFEST_FILENAME), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=1)
    except OSError as exc:
        shutil.rmtree(dest, ignore_errors=True)
        fail(f"install write failed: {exc}")
        return None
    index["packs"][pack_id] = {
        "manifest": manifest,
        "enabled": True,
        "sha256": sha256_file(pack_path),
        "publisher": manifest.get("publisher", "unknown"),
    }
    save_index(root, index)
    return pack_id


def set_enabled(root: str, pack_id: str, enabled: bool) -> bool:
    """Godot-checkbox enable/disable (payloads only apply when enabled)."""
    index = load_index(root)
    entry = index["packs"].get(pack_id)
    if entry is None:
        return False
    entry["enabled"] = enabled
    save_index(root, index)
    return True


def uninstall_pack(root: str, pack_id: str, errors: Optional[List[str]] = None) -> bool:
    """Deregisters + deletes a pack (dependents block, UPM parity)."""

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return False

    index = load_index(root)
    if pack_id not in index["packs"]:
        return fail(f"pack '{pack_id}' is not installed")
    name = index["packs"][pack_id]["manifest"]["name"]
    blockers = [
        other
        for other, entry in index["packs"].items()
        if other != pack_id
        and name in entry.get("manifest", {}).get("dependencies", {})
    ]
    if blockers:
        return fail(f"pack '{pack_id}' is required by {blockers}")
    shutil.rmtree(os.path.join(_packs_dir(root), pack_id), ignore_errors=True)
    del index["packs"][pack_id]
    save_index(root, index)
    return True


def enabled_payloads(root: str) -> List[Dict[str, Any]]:
    """Payload dicts of enabled packs: {pack_id, kind, entry, data}."""
    index = load_index(root)
    out: List[Dict[str, Any]] = []
    for pack_id, entry in index["packs"].items():
        if not entry.get("enabled", True):
            continue
        manifest = entry.get("manifest", {})
        entry_path = os.path.join(_packs_dir(root), pack_id, manifest.get("entry", ""))
        try:
            with open(entry_path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        out.append(
            {
                "pack_id": pack_id,
                "kind": manifest.get("kind"),
                "entry": manifest.get("entry"),
                "data": copy.deepcopy(data),
            }
        )
    return out
