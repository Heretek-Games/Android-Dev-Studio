"""Scene format v2: Git-mergeable prefabs-as-files (Track 0).

ADR-1790368676613. The v1 format (monolithic JSON, name-keyed cross-refs) is
kept as the live path; this module implements the v2 layout alongside it:

    scenes/<scene>/scene.json          # header + scene-level sections
    scenes/<scene>/objects/<uid>.json  # one file per object (merge-friendly)
    prefabs/<name>.prefab.json         # reusable templates (future; instances
                                       # carry prefabUid + overrides)

v2 rules:
- Every object gets a stable `uid` (allocated once at conversion, never
  derived from content). Cross-refs keep human-readable names as fallback.
- The writer normalizes: sorted keys, 2-space indent, floats rounded to 3
  decimals — so no-op edits produce no diff.
- `assemble()` rebuilds the exact v1 flat dict the whole harness consumes
  (loop, exporter, QA runner, MCP); file layout never leaks past this module.
"""

import copy
import json
import math
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

SCENE_SECTIONS = (
    "rules",
    "dialogues",
    "lodDefaults",
    "spatialGrid",
    "economy",
    "alife",
    "streaming",
    "quadtree",
)


def _round_floats(value: Any) -> Any:
    if isinstance(value, float):
        if not math.isfinite(value):
            return value
        return round(value, 3)
    if isinstance(value, list):
        return [_round_floats(item) for item in value]
    if isinstance(value, dict):
        return {key: _round_floats(item) for key, item in value.items()}
    return value


def normalize_scene(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Normalized copy of a v1 flat scene (stable key order + rounded floats)."""
    normalized = copy.deepcopy(scene)
    objects = normalized.get("gameObjects", [])
    objects.sort(key=lambda o: o.get("name", ""))
    normalized["gameObjects"] = objects
    return _round_floats(normalized)


def dump_canonical(scene: Dict[str, Any]) -> str:
    """Canonical bytes for a scene: normalized, sorted keys, 2-space indent."""
    return json.dumps(normalize_scene(scene), indent=2, sort_keys=True) + "\n"


def convert_to_v2(scene: Dict[str, Any], out_dir: Path) -> Dict[str, str]:
    """Write a v1 flat scene as v2 layout. Returns {object_name: uid}."""
    out_dir = Path(out_dir)
    objects_dir = out_dir / "objects"
    objects_dir.mkdir(parents=True, exist_ok=True)
    # Converter output is derived: clear stale object files so rewrites
    # never accumulate orphaned uid files.
    for stale in objects_dir.glob("*.json"):
        stale.unlink()

    header: Dict[str, Any] = {
        "format": "heretek-scene/v2",
        "id": scene.get("id"),
        "name": scene.get("name"),
        "goal": scene.get("goal"),
    }
    for section in SCENE_SECTIONS:
        if section in scene:
            header[section] = scene[section]
    (out_dir / "scene.json").write_text(
        json.dumps(_round_floats(header), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    uid_map: Dict[str, str] = {}
    for obj in scene.get("gameObjects", []):
        uid = obj.get("uid") or uuid.uuid4().hex[:12]
        uid_map[obj.get("name", "")] = uid
        record = {"uid": uid, **obj}
        (objects_dir / f"{uid}.json").write_text(
            json.dumps(_round_floats(record), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return uid_map


def assemble_from_v2(scene_dir: Path) -> Dict[str, Any]:
    """Rebuild the v1 flat dict from a v2 directory (what every consumer reads).

    Object records may carry `prefabUid` (+ optional per-field overrides):
    they resolve against the scene dir's `prefabs/` store (PrefabStore files),
    then merge like loop spawn-from-prefab (explicit fields win, identity from
    the record). Unknown prefab ids fail loudly with the file path.
    """
    from harness.prefabs.prefabs import PrefabStore, resolve_prefab

    scene_dir = Path(scene_dir)
    header = json.loads((scene_dir / "scene.json").read_text(encoding="utf-8"))
    store = PrefabStore(scene_dir / "prefabs").load_all()
    objects: List[Dict[str, Any]] = []
    objects_dir = scene_dir / "objects"
    if objects_dir.is_dir():
        for path in sorted(objects_dir.glob("*.json")):
            record = json.loads(path.read_text(encoding="utf-8"))
            record.pop("uid", None)
            prefab_uid = record.pop("prefabUid", None)
            if prefab_uid is not None:
                errors: List[str] = []
                base = resolve_prefab(store, prefab_uid, None, errors)
                if base is None:
                    raise ValueError(
                        f"{path.name}: {errors[0] if errors else 'unresolvable prefab'}"
                    )
                merged = {k: v for k, v in base.items() if k not in ("name", "uid")}
                merged.update(record)
                record = merged
            objects.append(record)
    scene: Dict[str, Any] = {
        "id": header.get("id"),
        "name": header.get("name"),
    }
    if header.get("goal") is not None:
        scene["goal"] = header["goal"]
    scene["gameObjects"] = objects
    for section in SCENE_SECTIONS:
        if section in header:
            scene[section] = header[section]
    return scene


def load_scene(path: Path) -> Tuple[Dict[str, Any], str]:
    """Dual-format loader: directory with scene.json → v2, else v1 flat JSON.

    Returns (scene_dict, format) where format is 'v2' or 'v1'.
    """
    path = Path(path)
    if path.is_dir() and (path / "scene.json").is_file():
        return assemble_from_v2(path), "v2"
    with open(path, encoding="utf-8") as handle:
        return json.load(handle), "v1"
