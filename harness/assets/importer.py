"""
Asset import pipeline, Phase 1 (Track 1; ADR-1790367123059 lineage).

Godot-shaped design adapted to a harness-side pipeline:
  - per-source ``<name>.import.json`` sidecars (uid allocated once, SHA-256
    reimport gate, outputs + deps, importer version),
  - scene refs by ``uid://<uid>`` with plain-URL fallback (remote URLs are
    never gated — only imported local assets are),
  - flat manifest regenerated from sidecars on demand (no central DB),
  - disposable artifact cache (bytes live next to sidecars; gitignored).

Phase 1 scope: GLB passthrough import + presets declared/validated +
reimport detection feeding the invariant gate as reimport-needed failures.
Texture transcoding (Basis/KTX2), mesh quantization/LOD, and audio are
Phase 2 — presets already carry the target knobs so sidecars stay
forward-compatible. OSS pull list lives in the ADR (meshoptimizer,
glTF-Transform, sharp/PIL, Basis + KTX-Software).
"""

import hashlib
import json
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

IMPORTER_VERSION = 1

#: Declared import presets. Phase 1 stores the selected preset (and its
#: knobs) in the sidecar; enforcement beyond passthrough is Phase 2.
PRESETS: Dict[str, Dict[str, Any]] = {
    "mobile": {
        "maxTextureSize": 1024,
        "textureFormat": "ktx2-etc1s",
        "meshQuantize": True,
        "maxTriangles": 50000,
    },
    "desktop": {
        "maxTextureSize": 2048,
        "textureFormat": "ktx2-uastc",
        "meshQuantize": True,
        "maxTriangles": 200000,
    },
    "preview": {
        "maxTextureSize": 512,
        "textureFormat": "webp",
        "meshQuantize": False,
        "maxTriangles": 20000,
    },
}

SIDECAR_SUFFIX = ".import.json"
UID_SCHEME = "uid://"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_stem(name: str) -> str:
    stem = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in name
    ).strip("_")
    return stem or "asset"


def import_asset(
    data: bytes,
    *,
    name: str,
    preset: str = "mobile",
    assets_dir: str,
    source_hint: str = "",
) -> Dict[str, Any]:
    """Imports raw GLB bytes: stores content + writes the sidecar.

    Returns the sidecar dict. Raises ValueError on unknown preset or empty
    payload. The uid is allocated fresh per import (Godot parity: uid is
    stable across reimports of the same sidecar — see reimport_asset).
    """
    if preset not in PRESETS:
        raise ValueError(
            f"unknown import preset {preset!r} (allowed: {sorted(PRESETS)})"
        )
    if not data:
        raise ValueError("import payload must not be empty")
    os.makedirs(assets_dir, exist_ok=True)
    uid = uuid.uuid4().hex
    digest = sha256_bytes(data)
    model_file = f"{uid}.glb"
    with open(os.path.join(assets_dir, model_file), "wb") as fh:
        fh.write(data)
    sidecar: Dict[str, Any] = {
        "uid": uid,
        "sourceName": name,
        "sourceHint": source_hint,
        "sha256": digest,
        "bytes": len(data),
        "preset": preset,
        "presetConfig": dict(PRESETS[preset]),
        "importerVersion": IMPORTER_VERSION,
        "outputs": {"model": model_file},
        "deps": [],
    }
    sidecar_path = os.path.join(assets_dir, f"{_safe_stem(name)}{SIDECAR_SUFFIX}")
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=1)
    return sidecar


def reimport_asset(
    assets_dir: str, data: bytes, sidecar_name: str
) -> Tuple[Dict[str, Any], bool]:
    """Refreshes an existing sidecar when source bytes changed.

    Returns (sidecar, changed). The uid is preserved (Godot parity: refs by
    uid:// survive reimports); the model bytes + hash are rewritten.
    """
    sidecar_path = os.path.join(assets_dir, sidecar_name)
    with open(sidecar_path, encoding="utf-8") as fh:
        sidecar = json.load(fh)
    digest = sha256_bytes(data)
    if digest == sidecar.get("sha256"):
        return sidecar, False
    model_file = sidecar["outputs"]["model"]
    with open(os.path.join(assets_dir, model_file), "wb") as fh:
        fh.write(data)
    sidecar["sha256"] = digest
    sidecar["bytes"] = len(data)
    sidecar["importerVersion"] = IMPORTER_VERSION
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=1)
    return sidecar, True


def load_sidecar(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def iter_sidecars(assets_dir: str) -> List[str]:
    if not os.path.isdir(assets_dir):
        return []
    return sorted(f for f in os.listdir(assets_dir) if f.endswith(SIDECAR_SUFFIX))


def build_manifest(assets_dir: str) -> Dict[str, Dict[str, Any]]:
    """Regenerates the flat uid -> entry manifest from sidecars (no DB)."""
    manifest: Dict[str, Dict[str, Any]] = {}
    for fname in iter_sidecars(assets_dir):
        try:
            entry = load_sidecar(os.path.join(assets_dir, fname))
        except (OSError, ValueError):
            continue
        uid = entry.get("uid")
        if isinstance(uid, str) and uid:
            manifest[uid] = {"sidecar": fname, **entry}
    return manifest


def resolve_uid(manifest: Dict[str, Dict[str, Any]], ref: str) -> Optional[str]:
    """Resolves a model ref to a local model file.

    ``uid://<uid>`` -> the imported ``<uid>.glb`` filename (None when
    unknown). Anything else (http(s) URLs, paths) passes through unchanged:
    remote assets are never import-gated.
    """
    if not isinstance(ref, str) or not ref.startswith(UID_SCHEME):
        return ref
    entry = manifest.get(ref[len(UID_SCHEME) :])
    if entry is None:
        return None
    outputs = entry.get("outputs") or {}
    return outputs.get("model")


def check_reimport(assets_dir: str, current: Dict[str, bytes]) -> List[Dict[str, Any]]:
    """Compares live source bytes against sidecar hashes.

    ``current`` maps sidecar filename -> present source bytes. Returns one
    status dict per sidecar: ok / stale / source-missing.
    """
    statuses: List[Dict[str, Any]] = []
    for fname in iter_sidecars(assets_dir):
        try:
            entry = load_sidecar(os.path.join(assets_dir, fname))
        except (OSError, ValueError):
            statuses.append({"sidecar": fname, "status": "sidecar-unreadable"})
            continue
        if fname not in current:
            statuses.append(
                {"sidecar": fname, "uid": entry.get("uid"), "status": "source-missing"}
            )
            continue
        live = sha256_bytes(current[fname])
        statuses.append(
            {
                "sidecar": fname,
                "uid": entry.get("uid"),
                "status": "ok" if live == entry.get("sha256") else "stale",
            }
        )
    return statuses


def _scene_model_refs(scene: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Collects (object name, modelUrl) pairs from flat or nested schemas."""
    refs: List[Tuple[str, str]] = []
    objects = scene.get("gameObjects")
    if not isinstance(objects, list):
        return refs
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        name = obj.get("name", "?")
        url = obj.get("modelUrl")
        if url is None:
            for comp in obj.get("components") or []:
                if (
                    isinstance(comp, dict)
                    and comp.get("type") == "ModelRenderer"
                    and comp.get("modelUrl")
                ):
                    url = comp.get("modelUrl")
                    break
        if isinstance(url, str) and url:
            refs.append((name, url))
    return refs


def audit_scene_assets(scene: Dict[str, Any], assets_dir: str) -> List[Dict[str, Any]]:
    """Feeds the invariant gate: unknown uids + stale imports as failures.

    Remote (non-uid://) refs are skipped by design. Returns violation dicts
    shaped like the gate's ({code, message, entity}).
    """
    manifest = build_manifest(assets_dir)
    violations: List[Dict[str, Any]] = []
    for name, ref in _scene_model_refs(scene):
        if not ref.startswith(UID_SCHEME):
            continue
        uid = ref[len(UID_SCHEME) :]
        entry = manifest.get(uid)
        if entry is None:
            violations.append(
                {
                    "code": "ASSET_UNKNOWN_UID",
                    "message": (
                        f"object '{name}' references unknown asset uid '{uid}' "
                        f"(import it first; manifest holds {len(manifest)} asset(s))"
                    ),
                    "entity": name,
                }
            )
            continue
        model_file = (entry.get("outputs") or {}).get("model")
        stale = False
        if model_file:
            try:
                with open(os.path.join(assets_dir, model_file), "rb") as fh:
                    stale = sha256_bytes(fh.read()) != entry.get("sha256")
            except OSError:
                stale = True
        if stale:
            violations.append(
                {
                    "code": "ASSET_REIMPORT_NEEDED",
                    "message": (
                        f"object '{name}' asset uid '{uid}' is stale "
                        f"(bytes changed since import; run reimport)"
                    ),
                    "entity": name,
                }
            )
    return violations
