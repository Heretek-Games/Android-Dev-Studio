"""
Prefab UI kits (Track A.3): complete HUD/menu/dialogue screens as data.

The model instantiates a kit instead of designing a HUD from atoms every run.
Kits are plain dicts {name, theme, description, elements[]} — validated by the
same ui_layout validators the loop enforces, distributable as marketplace `ui`
packs, and applied through the loop `ui` action (op: kit).
"""

from typing import Any, Dict, List, Optional

KITS: Dict[str, Dict[str, Any]] = {
    "hud_arena": {
        "theme": "fantasy",
        "description": "Arena run HUD: score top-center, health bottom-left, wave top-left, pause top-right.",
        "elements": [
            {
                "id": "score",
                "kind": "label",
                "zone": "top_center",
                "size": [0.28, 0.08],
                "order": 0,
            },
            {
                "id": "wave",
                "kind": "label",
                "zone": "top_left",
                "size": [0.20, 0.08],
                "order": 0,
            },
            {
                "id": "health",
                "kind": "bar",
                "zone": "bottom_left",
                "size": [0.22, 0.06],
                "order": 0,
            },
            {
                "id": "pause",
                "kind": "button",
                "zone": "top_right",
                "size": [0.10, 0.08],
                "order": 0,
            },
        ],
    },
    "hud_racer": {
        "theme": "driving",
        "description": "Racer HUD: speed bottom-right, distance top-center, minimap top-right.",
        "elements": [
            {
                "id": "distance",
                "kind": "label",
                "zone": "top_center",
                "size": [0.28, 0.08],
                "order": 0,
            },
            {
                "id": "speed",
                "kind": "label",
                "zone": "bottom_right",
                "size": [0.20, 0.10],
                "order": 0,
            },
            {
                "id": "minimap",
                "kind": "minimap",
                "zone": "top_right",
                "size": [0.16, 0.16],
                "order": 0,
            },
        ],
    },
    "menu_basic": {
        "theme": "default",
        "description": "Title menu: centered panel with title label and start/continue buttons.",
        "elements": [
            {
                "id": "menu_panel",
                "kind": "panel",
                "zone": "center",
                "size": [0.36, 0.36],
                "order": 0,
            },
            {
                "id": "title",
                "kind": "label",
                "zone": "center",
                "size": [0.30, 0.08],
                "order": 1,
            },
            {
                "id": "start",
                "kind": "button",
                "zone": "center",
                "size": [0.20, 0.08],
                "order": 2,
            },
        ],
    },
    "dialogue_panel": {
        "theme": "fantasy",
        "description": "Dialogue screen: bottom-center panel with speaker label and advance button.",
        "elements": [
            {
                "id": "dlg_panel",
                "kind": "panel",
                "zone": "bottom_center",
                "size": [0.56, 0.10],
                "order": 0,
            },
            {
                "id": "speaker",
                "kind": "label",
                "zone": "bottom_center",
                "size": [0.20, 0.05],
                "order": 1,
            },
            {
                "id": "advance",
                "kind": "button",
                "zone": "bottom_right",
                "size": [0.10, 0.07],
                "order": 0,
            },
        ],
    },
}


def kit_names() -> List[str]:
    return sorted(KITS)


def get_kit(name: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(name, str):
        return None
    kit = KITS.get(name.strip())
    if kit is None:
        return None
    import copy

    return copy.deepcopy(kit)


def validate_kit(kit: Any) -> List[str]:
    """Problems with a kit payload (empty = valid). Shared by review + tests."""
    from harness.loop.ui_layout import validate_element
    from harness.loop.ui_themes import get_theme

    problems: List[str] = []
    if not isinstance(kit, dict):
        return ["ui kit must be an object"]
    if get_theme(kit.get("theme")) is None:
        problems.append(f"kit.theme must be a known theme (got {kit.get('theme')!r})")
    elements = kit.get("elements")
    if not isinstance(elements, list) or not elements:
        problems.append("kit.elements must be a non-empty array")
        return problems
    seen = set()
    for element in elements:
        for problem in validate_element(element):
            problems.append(
                f"element {element.get('id') if isinstance(element, dict) else element!r}: {problem}"
            )
        if isinstance(element, dict) and isinstance(element.get("id"), str):
            if element["id"] in seen:
                problems.append(f"duplicate element id {element['id']!r}")
            seen.add(element["id"])
    return problems
