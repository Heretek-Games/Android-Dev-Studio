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
import shutil
import subprocess
import tempfile
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

IMPORTER_VERSION = 1

#: KTX2 file magic (12 bytes): AB 4B 54 58 20 32 30 BB 0D 0A 1A 0A.
KTX2_MAGIC = bytes.fromhex("ab4b5458203230bb0d0a1a0a")

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
    license: str = "UNSPECIFIED",
) -> Dict[str, Any]:
    """Imports raw GLB bytes: stores content + writes the sidecar.

    Returns the sidecar dict. Raises ValueError on unknown preset or empty
    payload. The uid is allocated fresh per import (Godot parity: uid is
    stable across reimports of the same sidecar — see reimport_asset).
    ``license`` is recorded verbatim (e.g. "CC0-1.0", "MIT") for the
    asset_license QA rule and provenance (Track D.3/D.5).
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
        "license": license,
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


class TranscodeError(RuntimeError):
    """Explicit transcode failure (missing tool, bad payload, bad output)."""


#: Injected transcoder signature: (basisu_bin, src_png, out_dir) -> out ktx2 path.
#: The default shells out to the real binary; tests inject fakes.
Transcoder = Callable[[str, str, str], str]


def find_basisu(explicit: Optional[str] = None) -> Optional[str]:
    """Resolve the basisu binary: explicit path > $BASISU_BIN > $PATH."""
    candidates = [explicit, os.environ.get("BASISU_BIN"), shutil.which("basisu")]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _default_transcoder(basisu_bin: str, src_png: str, out_dir: str) -> str:
    """Run the real encoder: ETC1S KTX2 with mipmaps (mobile preset path)."""
    proc = subprocess.run(
        [basisu_bin, "-ktx2", "-mipmap", "-q", "128", src_png],
        capture_output=True,
        text=True,
        cwd=out_dir,
        timeout=600,
    )
    if proc.returncode != 0:
        raise TranscodeError(f"basisu failed: {proc.stderr.strip()[:300]}")
    produced = sorted(f for f in os.listdir(out_dir) if f.endswith(".ktx2"))
    if not produced:
        raise TranscodeError("basisu produced no .ktx2 output")
    # Newest artifact wins (the directory is a fresh temp dir per call).
    produced.sort(key=lambda f: os.path.getmtime(os.path.join(out_dir, f)))
    return os.path.join(out_dir, produced[-1])


def transcode_texture(
    data: bytes,
    *,
    name: str,
    preset: str = "mobile",
    assets_dir: str,
    basisu_bin: Optional[str] = None,
    transcoder: Optional[Transcoder] = None,
) -> Dict[str, Any]:
    """Transcodes image bytes to KTX2/ETC1S (Track C.2 Phase 2, mobile preset).

    Pipeline: PIL decode -> shrink to preset maxTextureSize (aspect-kept) ->
    basisu -ktx2 -> KTX2-magic verification -> uid-addressed artifact +
    sidecar. Missing basisu raises TranscodeError with an install hint —
    never a silent passthrough.
    """
    if preset not in PRESETS:
        raise TranscodeError(
            f"unknown import preset {preset!r} (allowed: {sorted(PRESETS)})"
        )
    if not data:
        raise TranscodeError("transcode payload must not be empty")
    try:
        from PIL import Image
    except ImportError as exc:
        raise TranscodeError(f"Pillow is required for texture decode: {exc}") from exc
    try:
        image = Image.open(__import__("io").BytesIO(data)).convert("RGBA")
    except Exception as exc:
        raise TranscodeError(f"undecodable image payload: {exc}") from exc

    max_size = int(PRESETS[preset].get("maxTextureSize", 1024))
    if max(image.size) > max_size:
        image.thumbnail((max_size, max_size), Image.LANCZOS)
    out_w, out_h = image.size

    binary = find_basisu(basisu_bin)
    if binary is None and transcoder is None:
        raise TranscodeError(
            "basisu binary not found (set $BASISU_BIN or install "
            "basis_universal); refusing silent passthrough"
        )
    os.makedirs(assets_dir, exist_ok=True)
    uid = uuid.uuid4().hex
    digest = sha256_bytes(data)
    with tempfile.TemporaryDirectory(prefix="heretek-tx-") as tmp:
        src_png = os.path.join(tmp, "src.png")
        image.save(src_png, format="PNG")
        run = transcoder or _default_transcoder
        produced = run(binary or "basisu", src_png, tmp)
        with open(produced, "rb") as fh:
            ktx2 = fh.read()
    if ktx2[:12] != KTX2_MAGIC:
        raise TranscodeError("encoder output lacks the KTX2 magic — rejecting")
    model_file = f"{uid}.ktx2"
    with open(os.path.join(assets_dir, model_file), "wb") as fh:
        fh.write(ktx2)
    sidecar: Dict[str, Any] = {
        "uid": uid,
        "sourceName": name,
        "sourceHint": "texture",
        "sha256": digest,
        "bytes": len(data),
        "preset": preset,
        "presetConfig": dict(PRESETS[preset]),
        "importerVersion": IMPORTER_VERSION,
        "outputs": {"texture": model_file},
        "transcode": {
            "tool": "basisu",
            "format": "ktx2-etc1s",
            "mipmaps": True,
            "srcBytes": len(data),
            "outBytes": len(ktx2),
            "outWidth": out_w,
            "outHeight": out_h,
        },
        "deps": [],
    }
    sidecar_path = os.path.join(assets_dir, f"{_safe_stem(name)}{SIDECAR_SUFFIX}")
    with open(sidecar_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=1)
    return sidecar
