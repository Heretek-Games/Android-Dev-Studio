"""
Deterministic top-down layout preview of a flat scene.

The iterate-until-green loop is headless, so the vision critique needs an image
source that does not depend on a GPU or an attached device. This renders a
top-down (X right, Z down) diagram of the scene layout: objects as labelled
rectangles, the player-controlled object ringed in white, lights as diamonds.

For rendered frames (studio screenshot / emulator readback) the critique accepts
any PNG bytes instead — see `harness/loop/vision.py`.
"""

import io
import math
from typing import Any, Dict, List, Optional, Tuple

PREVIEW_SIZE = 640
MARGIN = 48
GRID_STEP = 64


def _parse_color(
    value: Any, fallback: Tuple[int, int, int] = (120, 120, 120)
) -> Tuple[int, int, int]:
    if not isinstance(value, str) or not value.startswith("#"):
        return fallback
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    if len(digits) != 6:
        return fallback
    try:
        return tuple(int(digits[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return fallback


def _scene_bounds(objects: List[Dict[str, Any]]) -> Tuple[float, float, float, float]:
    xs: List[float] = []
    zs: List[float] = []
    for obj in objects:
        position = obj.get("position")
        if not (isinstance(position, (list, tuple)) and len(position) == 3):
            continue
        try:
            xs.append(float(position[0]))
            zs.append(float(position[2]))
        except (TypeError, ValueError):
            continue
    if not xs:
        return (-10.0, -10.0, 10.0, 10.0)
    pad = 2.0
    return (min(xs) - pad, min(zs) - pad, max(xs) + pad, max(zs) + pad)


def render_layout_png(scene: Dict[str, Any], size: int = PREVIEW_SIZE) -> bytes:
    """Render the scene layout to PNG bytes (raises ImportError without Pillow)."""
    from PIL import Image, ImageDraw

    objects = [o for o in scene.get("gameObjects", []) if isinstance(o, dict)]
    min_x, min_z, max_x, max_z = _scene_bounds(objects)
    span = max(max_x - min_x, max_z - min_z, 1.0)
    usable = size - 2 * MARGIN
    scale = usable / span

    def to_px(x: float, z: float) -> Tuple[float, float]:
        return (MARGIN + (x - min_x) * scale, MARGIN + (z - min_z) * scale)

    image = Image.new("RGB", (size, size), (18, 18, 22))
    draw = ImageDraw.Draw(image)

    # Grid
    for offset in range(0, usable + 1, GRID_STEP):
        draw.line(
            [(MARGIN + offset, MARGIN), (MARGIN + offset, size - MARGIN)],
            fill=(34, 34, 40),
        )
        draw.line(
            [(MARGIN, MARGIN + offset), (size - MARGIN, MARGIN + offset)],
            fill=(34, 34, 40),
        )
    draw.text(
        (MARGIN, 16),
        f"TOP-DOWN LAYOUT  X:{min_x:.0f}..{max_x:.0f}  Z:{min_z:.0f}..{max_z:.0f}",
        fill=(200, 200, 210),
    )

    # Ground first (largest footprint), then everything else on top.
    def footprint_area(obj: Dict[str, Any]) -> float:
        sz = obj.get("size") or [1, 1, 1]
        try:
            return float(sz[0]) * float(sz[2])
        except (TypeError, ValueError, IndexError):
            return 1.0

    ordered = sorted(objects, key=footprint_area, reverse=True)
    for obj in ordered:
        position = obj.get("position")
        if not (isinstance(position, (list, tuple)) and len(position) == 3):
            continue
        try:
            x, z = float(position[0]), float(position[2])
        except (TypeError, ValueError):
            continue
        size_vec = obj.get("size") or [1, 1, 1]
        try:
            width = max(1.0, float(size_vec[0])) * scale
            depth = max(1.0, float(size_vec[2])) * scale
        except (TypeError, ValueError, IndexError):
            width = depth = scale

        px, pz = to_px(x, z)
        left, top = px - width / 2, pz - depth / 2
        right, bottom = px + width / 2, pz + depth / 2
        color = _parse_color(obj.get("color"))
        is_light = obj.get("kind") == "light" or bool(obj.get("lightType"))
        if is_light:
            radius = 6
            draw.polygon(
                [
                    (px, pz - radius),
                    (px + radius, pz),
                    (px, pz + radius),
                    (px - radius, pz),
                ],
                fill=(250, 220, 120),
                outline=(120, 100, 40),
            )
        else:
            draw.rectangle([left, top, right, bottom], fill=color, outline=(20, 20, 24))
            if obj.get("controller") is True:
                draw.rectangle(
                    [left - 4, top - 4, right + 4, bottom + 4],
                    outline=(255, 255, 255),
                    width=3,
                )
        label = str(obj.get("name", "?"))[:24]
        draw.text((left, max(0, top - 12)), label, fill=(235, 235, 240))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
