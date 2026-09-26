"""
Bounded asset search for loop builders (Track D.4): query the importer
manifest so the model picks real store assets instead of inventing them.

Taste-memory pattern: results are injected into the generation prompt as
advisory lines (uid + name + license + size). The machine rules
(uid-validated spawn, asset_count, asset_license) remain the gate.
"""

from typing import Any, Dict, List, Optional

from harness.assets.importer import build_manifest


def search_assets(
    *,
    assets_dir: str,
    query: str = "",
    licenses: Optional[List[str]] = None,
    max_bytes: Optional[int] = None,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    """Search imported sidecars by name with license/size bounds."""
    manifest = build_manifest(assets_dir)
    terms = [t for t in query.lower().split() if len(t) > 2]
    allowed = {str(lic).lower() for lic in licenses} if licenses else None
    scored: List[tuple] = []
    for uid, entry in manifest.items():
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("sourceName", ""))
        license = str(entry.get("license", "UNSPECIFIED"))
        size = entry.get("bytes", 0)
        if allowed is not None and license.lower() not in allowed:
            continue
        if max_bytes is not None:
            try:
                if float(size) > max_bytes:
                    continue
            except (TypeError, ValueError):
                continue
        haystack = name.lower()
        score = sum(1 for term in terms if term in haystack)
        if terms and score == 0:
            continue
        scored.append(
            (
                -score,
                name,
                {
                    "uid": uid,
                    "name": name,
                    "license": license,
                    "bytes": size,
                    "source": str(entry.get("sourceHint", "")),
                },
            )
        )
    scored.sort(key=lambda row: (row[0], row[1]))
    return [row[2] for row in scored[: max(1, limit)]]


def format_asset_notes(assets: List[Dict[str, Any]]) -> List[str]:
    """Prompt lines: one per asset (uid + name + license)."""
    return [
        f"uid://{a['uid']} — {a['name']} ({a['license']})"
        for a in assets
        if isinstance(a, dict)
    ]
