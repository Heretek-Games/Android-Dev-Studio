"""Prefab templates + variant chains (Track 1.1).

ADR-1790368956644. Unity-adapted semantics for our flat object model:

- Prefab: {id, name, base (prefab id or null), template (object fields),
  overrides (stored field map)}. Files live in prefabs/*.prefab.json.
- Instance: prefabUid + per-field overrides, deep-merged at resolve time.
- Variant: a prefab whose base names another prefab; chains resolve
  base-first, overrides winning at every level (Unity precedence).
- Cycles and unknown bases are rejected with specific reasons.
- Nested prefabs are explicitly out of scope: objects are flat (no
  children). Resolution outputs plain object dicts, so the invariant
  gate, QA runner, exporter, and loop consume them unchanged.
"""

import copy
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

RESERVED_PREFAB_KEYS = ("id", "name", "base", "template", "overrides")


def _is_plain(value: Any) -> bool:
    return value is None or isinstance(value, (bool, int, float, str, list, dict))


def validate_prefab(
    prefab: Any, errors: Optional[List[str]] = None
) -> Optional[Dict[str, Any]]:
    """Validate a prefab definition. Returns normalized copy or None."""

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if not isinstance(prefab, dict):
        fail("prefab must be an object")
        return None
    pid = prefab.get("id")
    if not isinstance(pid, str) or not pid.strip():
        fail("prefab 'id' must be a non-empty string")
        return None
    name = prefab.get("name", pid.strip())
    if not isinstance(name, str) or not name.strip():
        fail("prefab 'name' must be a non-empty string")
        return None
    base = prefab.get("base")
    if base is not None and (not isinstance(base, str) or not base.strip()):
        fail(f"prefab '{pid}' 'base' must be a prefab id string")
        return None
    template = prefab.get("template", {})
    if not isinstance(template, dict):
        fail(f"prefab '{pid}' 'template' must be an object")
        return None
    overrides = prefab.get("overrides", {})
    if not isinstance(overrides, dict):
        fail(f"prefab '{pid}' 'overrides' must be an object")
        return None
    for key in prefab:
        if key not in RESERVED_PREFAB_KEYS:
            fail(
                f"prefab '{pid}' unknown key '{key}' "
                f"(allowed: {sorted(RESERVED_PREFAB_KEYS)})"
            )
            return None
    if not all(
        _is_plain(v) for v in list(template.values()) + list(overrides.values())
    ):
        fail(f"prefab '{pid}' template/overrides must hold plain JSON values")
        return None
    normalized = {
        "id": pid.strip(),
        "name": name.strip(),
        "base": base.strip() if base else None,
        "template": copy.deepcopy(template),
        "overrides": copy.deepcopy(overrides),
    }
    return normalized


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def resolve_prefab(
    store: Dict[str, Dict[str, Any]],
    prefab_id: str,
    instance_overrides: Optional[Dict[str, Any]] = None,
    errors: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve a prefab (+ optional instance overrides) to a plain object dict.

    Walks the base chain root-first, deep-merging template then stored
    overrides at each level, then instance overrides last. Cycles and unknown
    ids are rejected with specific reasons.
    """

    def fail(reason: str) -> None:
        if errors is not None:
            errors.append(reason)
        return None

    if prefab_id not in store:
        fail(f"unknown prefab '{prefab_id}'")
        return None
    chain: List[Dict[str, Any]] = []
    seen: List[str] = []
    current: Optional[str] = prefab_id
    while current is not None:
        if current in seen:
            fail(f"prefab base cycle: {' -> '.join(seen + [current])}")
            return None
        seen.append(current)
        prefab = store.get(current)
        if prefab is None:
            fail(f"prefab '{prefab_id}' extends unknown base '{current}'")
            return None
        chain.append(prefab)
        current = prefab.get("base")

    resolved: Dict[str, Any] = {}
    for link in reversed(chain):
        resolved = _deep_merge(resolved, link.get("template", {}))
        resolved = _deep_merge(resolved, link.get("overrides", {}))
    if instance_overrides is not None:
        if not isinstance(instance_overrides, dict):
            fail("instance overrides must be an object")
            return None
        resolved = _deep_merge(resolved, instance_overrides)
    return resolved


class PrefabStore:
    """File-backed prefab registry (prefabs/*.prefab.json)."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def save(self, prefab: Dict[str, Any]) -> Path:
        validated = validate_prefab(prefab)
        if validated is None:
            raise ValueError("invalid prefab definition")
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / f"{validated['id']}.prefab.json"
        path.write_text(
            json.dumps(validated, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return path

    def load_all(self) -> Dict[str, Dict[str, Any]]:
        store: Dict[str, Dict[str, Any]] = {}
        if not self.directory.is_dir():
            return store
        for path in sorted(self.directory.glob("*.prefab.json")):
            prefab = json.loads(path.read_text(encoding="utf-8"))
            validated = validate_prefab(prefab)
            if validated is None:
                raise ValueError(f"invalid prefab file: {path}")
            store[validated["id"]] = validated
        return store
