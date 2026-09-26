"""
HUD layout zones + safe-area audit (Track A.3).

Named zones in normalized 0-1 screen space (landscape 1280x720 baseline,
Godot-preset-flavored: corners, edge wides, center). Elements anchor to a zone
instead of hand-placed pixels; the audit (pure, deterministic) checks:

  1. safe-area: interactive elements stay inside the safe rect (Unity SafeArea
     pattern: full-bleed backgrounds allowed, interactive UI inset).
  2. overlap: two elements in the same zone must not overlap (order decides
     stacking only across zones, never within).
  3. known zones/kinds/sizes: rejects unknowns so the model cannot invent
     layout vocabulary.

Element spec: {id, kind, zone, size:[w,h] (normalized fractions), order?}.
Kinds: label, bar, button, panel, toast, minimap.
"""

from typing import Any, Dict, List, Optional, Tuple

Rect = Tuple[float, float, float, float]  # x, y, w, h in 0-1 space

#: Named zones (Godot LayoutPreset-flavored). Values are default rects.
ZONES: Dict[str, Rect] = {
    "top_center": (0.35, 0.04, 0.30, 0.10),
    "top_left": (0.05, 0.04, 0.22, 0.12),
    "top_right": (0.74, 0.04, 0.22, 0.12),
    "bottom_left": (0.05, 0.80, 0.24, 0.16),
    "bottom_right": (0.74, 0.78, 0.24, 0.18),
    "bottom_center": (0.35, 0.88, 0.30, 0.08),
    "center": (0.30, 0.30, 0.40, 0.40),
    "full": (0.0, 0.0, 1.0, 1.0),
}

ELEMENT_KINDS = ("label", "bar", "button", "panel", "toast", "minimap")

#: Kinds that must live inside the safe area (backgrounds/panels may bleed).
INTERACTIVE_KINDS = ("label", "bar", "button", "toast", "minimap")

#: Safe-area inset (fraction per edge): landscape mobile with notch/sensors.
#: Unity Screen.safeArea equivalent: interactive UI inside, art may fill.
SAFE_INSETS = {"left": 0.04, "right": 0.04, "top": 0.03, "bottom": 0.05}


def safe_rect() -> Rect:
    return (
        SAFE_INSETS["left"],
        SAFE_INSETS["top"],
        1.0 - SAFE_INSETS["left"] - SAFE_INSETS["right"],
        1.0 - SAFE_INSETS["top"] - SAFE_INSETS["bottom"],
    )


def element_rect(element: Dict[str, Any]) -> Optional[Rect]:
    """Resolve an element to its rect: zone origin + declared size."""
    zone = ZONES.get(
        element.get("zone") if isinstance(element.get("zone"), str) else ""
    )
    if zone is None:
        return None
    size = element.get("size")
    if (
        not isinstance(size, (list, tuple))
        or len(size) != 2
        or not all(isinstance(v, (int, float)) for v in size)
        or not (0 < size[0] <= 1 and 0 < size[1] <= 1)
    ):
        return None
    return (zone[0], zone[1], float(size[0]), float(size[1]))


def _inside(inner: Rect, outer: Rect) -> bool:
    return (
        inner[0] >= outer[0]
        and inner[1] >= outer[1]
        and inner[0] + inner[2] <= outer[0] + outer[2] + 1e-9
        and inner[1] + inner[3] <= outer[1] + outer[3] + 1e-9
    )


def _overlaps(a: Rect, b: Rect) -> bool:
    return (
        a[0] < b[0] + b[2]
        and b[0] < a[0] + a[2]
        and a[1] < b[1] + b[3]
        and b[1] < a[1] + a[3]
    )


def validate_element(element: Any) -> List[str]:
    """Problems with one element spec (empty = valid)."""
    problems: List[str] = []
    if not isinstance(element, dict):
        return ["element must be an object"]
    if not isinstance(element.get("id"), str) or not element["id"].strip():
        problems.append("element.id must be a non-empty string")
    if element.get("kind") not in ELEMENT_KINDS:
        problems.append(f"element.kind must be one of {list(ELEMENT_KINDS)}")
    if element.get("zone") not in ZONES:
        problems.append(f"element.zone must be one of {sorted(ZONES)}")
    if element_rect(element) is None and element.get("zone") in ZONES:
        problems.append("element.size must be [w,h] fractions in (0,1]")
    order = element.get("order", 0)
    if not isinstance(order, int) or order < 0:
        problems.append("element.order must be a non-negative int")
    return problems


def audit_ui(ui: Any) -> Dict[str, Any]:
    """Audit a scene.ui block. Returns {score 1-5, defects[], elementCount}."""
    defects: List[Dict[str, str]] = []
    if not isinstance(ui, dict):
        return {"score": 3, "defects": [], "elementCount": 0, "present": False}
    raw = ui.get("elements")
    elements = [e for e in raw if isinstance(e, dict)] if isinstance(raw, list) else []
    if not elements:
        return {"score": 3, "defects": [], "elementCount": 0, "present": False}

    safe = safe_rect()
    placed: List[Dict[str, Any]] = []
    for element in elements:
        for problem in validate_element(element):
            defects.append(
                {
                    "axis": "ui_alignment",
                    "defect": f"element {element.get('id', '?')!r}: {problem} "
                    "→ repair: use a known kind/zone and a (0,1] size",
                }
            )
        rect = element_rect(element)
        if rect is None:
            continue
        if element.get("kind") in INTERACTIVE_KINDS and not _inside(rect, safe):
            defects.append(
                {
                    "axis": "ui_alignment",
                    "defect": f"element {element.get('id')!r} escapes the safe area "
                    "→ repair: shrink/move it inside the 4%/3%/5% safe insets",
                }
            )
        placed.append(
            {
                "id": str(element.get("id")),
                "rect": rect,
                "zone": element.get("zone"),
                "order": element.get("order", 0),
            }
        )

    # Overlap: cross-zone overlaps are always defects. Same-zone elements are a
    # container stack (Godot pattern): distinct `order` stacks them, so only an
    # identical order in one zone collides.
    for i in range(len(placed)):
        for j in range(i + 1, len(placed)):
            a, b = placed[i], placed[j]
            if not _overlaps(a["rect"], b["rect"]):
                continue
            if a["zone"] == b["zone"] and a["order"] != b["order"]:
                continue
            defects.append(
                {
                    "axis": "ui_alignment",
                    "defect": f"elements {a['id']!r} and {b['id']!r} overlap "
                    "→ repair: move one to a free zone or give stacked elements distinct order values",
                }
            )

    if not defects:
        score = 5
    elif len(defects) == 1:
        score = 4
    elif len(defects) == 2:
        score = 3
    elif len(defects) <= 4:
        score = 2
    else:
        score = 1
    return {
        "score": score,
        "defects": defects,
        "elementCount": len(elements),
        "present": True,
    }
