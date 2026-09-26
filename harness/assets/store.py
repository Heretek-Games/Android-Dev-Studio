"""
Store acquisition for agent installs (Track D.4): resolve real model bytes
and route them through importer.py — never placeholders.

Resolution mirrors app/services/GDevelopAssetService.ts exactly:
  assetShortHeaders.json -> {asset_id}.json details ->
  objectAssets[0].resources[] -> first .glb/.gltf file URL.
Any step failing returns an explicit error (no silent substitution).

Only stdlib (urllib) is used: 30 s timeouts, 50 MB cap.
"""

import json
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

DETAILS_BASE = "https://resources.gdevelop-app.com/assets-database/assets"
MODEL_SUFFIXES = (".glb", ".gltf")
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
TIMEOUT_SECONDS = 30
_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) HeretekStudio/1.0"


class StoreError(RuntimeError):
    """Explicit acquisition failure (unresolvable, unreachable, too large)."""


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise StoreError(f"fetch failed for {url}: {exc}") from exc


def resolve_gdevelop_glb(
    asset_id: str, fetch: Optional[Callable[[str], Any]] = None
) -> Tuple[str, Dict[str, Any]]:
    """Returns (model_url, details) for a GDevelop asset id.

    ``fetch`` is injectable for hermetic tests; defaults to live HTTPS.
    (None-sentinel, not a direct default: patchable in tests.)
    """
    fetch = fetch or fetch_json
    if (
        not asset_id
        or "/" in asset_id
        or "\\" in asset_id
        or asset_id != asset_id.strip()
    ):
        raise StoreError(f"invalid asset id {asset_id!r}")
    try:
        details = fetch(f"{DETAILS_BASE}/{asset_id}.json")
    except StoreError:
        raise
    except Exception as exc:
        raise StoreError(f"details fetch failed for {asset_id!r}: {exc}") from exc
    if not isinstance(details, dict):
        raise StoreError(f"details for {asset_id!r} are not a JSON object")
    for obj in details.get("objectAssets") or []:
        if not isinstance(obj, dict):
            continue
        for resource in obj.get("resources") or []:
            if not isinstance(resource, dict):
                continue
            url = resource.get("file") or ""
            if isinstance(url, str) and url.lower().endswith(MODEL_SUFFIXES):
                return url, details
    raise StoreError(f"no .glb/.gltf resource in details for {asset_id!r}")


def download_bytes(url: str, opener=urllib.request.urlopen) -> bytes:
    """Downloads with size cap; anything else raises StoreError."""
    if not (url.startswith("https://") or url.startswith("http://")):
        raise StoreError(f"refusing non-HTTP(S) url {url!r}")
    # Store URLs contain raw spaces (GDevelop CDN); percent-encode the path.
    quoted = urllib.parse.quote(url, safe=":/%?&=#")
    request = (
        quoted
        if opener is not urllib.request.urlopen
        else urllib.request.Request(quoted, headers={"User-Agent": _USER_AGENT})
    )
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_DOWNLOAD_BYTES + 1)
    except Exception as exc:
        raise StoreError(f"download failed for {url}: {exc}") from exc
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise StoreError(f"download exceeds 50 MB cap ({url})")
    if not data:
        raise StoreError(f"empty download ({url})")
    return data


def install_store_asset(
    *,
    name: str,
    model_url: str,
    data: bytes,
    license: str,
    author: str,
    assets_dir: str,
    preset: str = "mobile",
) -> Dict[str, Any]:
    """Imports downloaded bytes; returns the sidecar (uid addressing)."""
    from harness.assets.importer import import_asset

    return import_asset(
        data,
        name=name,
        preset=preset,
        assets_dir=assets_dir,
        source_hint=model_url,
        license=license or "UNSPECIFIED",
    )


def details_credit(details: Dict[str, Any]) -> Tuple[str, str]:
    """Best-effort (author, license) from a GDevelop details payload."""
    author = ""
    license = "UNSPECIFIED"
    authors = details.get("authors")
    if isinstance(authors, list) and authors and isinstance(authors[0], str):
        author = authors[0].strip()
    if not author:
        for key in ("author", "authorName", "creator"):
            value = details.get(key)
            if isinstance(value, str) and value.strip():
                author = value.strip()
                break
    for key in ("license", "licenseName", "licenseUrl"):
        value = details.get(key)
        if isinstance(value, str) and value.strip():
            license = value.strip()
            break
    return author, license
