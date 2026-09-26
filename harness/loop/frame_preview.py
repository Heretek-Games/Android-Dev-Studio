"""
Gameplay-camera frame preview for the iterate-until-green loop (Track A.1).

Deterministic Pillow perspective projection from the gameplay camera — a QA
artifact, not a beauty render. The headless loop has no GPU, so real three.js
pixels are unavailable in CI; this gives every run a cheap, byte-stable
gameplay-view image stored with the run evidence and feedable to
`vision.critique_frame` (advisory until the A.2 rubric calibrates).

Camera selection (first match wins):
  1. explicit gameplay camera: object with kind == "camera"
     (position + radian YXZ rotation + cameraOptions.fov, mirroring
     CameraComponent / qa_scenario_runner semantics)
  2. chase view: behind + above the first controller object, looking at it
  3. default orbit: position (0, 6, 10) looking at the origin

Projection matches engine semantics: Transform rotation is radians YXZ;
CameraComponent is a THREE.PerspectiveCamera with the same quaternion.
"""

import io
import math
from typing import Any, Dict, List, Optional, Tuple

FRAME_WIDTH = 320
FRAME_HEIGHT = 180

DEFAULT_FOV_DEG = 60.0
DEFAULT_CAM_POS = (0.0, 6.0, 10.0)
DEFAULT_LOOK_AT = (0.0, 1.0, 0.0)
CHASE_BACK = 6.0
CHASE_UP = 3.5

_CORNERS = (
    (-0.5, -0.5, -0.5),
    (0.5, -0.5, -0.5),
    (0.5, 0.5, -0.5),
    (-0.5, 0.5, -0.5),
    (-0.5, -0.5, 0.5),
    (0.5, -0.5, 0.5),
    (0.5, 0.5, 0.5),
    (-0.5, 0.5, 0.5),
)
_FACES = (
    (0, 1, 2, 3),
    (4, 5, 6, 7),
    (0, 1, 5, 4),
    (2, 3, 7, 6),
    (0, 3, 7, 4),
    (1, 2, 6, 5),
)


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def _parse_color(value: Any, fallback: Tuple[int, int, int] = (120, 120, 120)):
    if not isinstance(value, str) or not value.startswith("#"):
        return fallback
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    if len(digits) != 6:
        return fallback
    try:
        return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16))
    except ValueError:
        return fallback


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def _vec3(obj: Dict[str, Any], key: str, fallback: Tuple[float, float, float]):
    value = obj.get(key)
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return fallback
    return (_num(value[0]), _num(value[1]), _num(value[2]))


def _euler_to_forward(
    rotation: Tuple[float, float, float],
) -> Tuple[float, float, float]:
    """Forward (-Z) direction for a YXZ radian Euler, matching THREE.Euler YXZ."""
    rx, ry, _ = rotation
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    # R = Ry * Rx applied to (0, 0, -1)
    return (-sy * cx, sx, -cy * cx)


def _look_at_rotation(
    eye: Tuple[float, float, float], target: Tuple[float, float, float]
):
    dx, dy, dz = target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]
    yaw = math.atan2(-dx, -dz)
    horiz = math.hypot(dx, dz)
    pitch = math.atan2(dy, horiz)
    return (pitch, yaw, 0.0)


def select_camera(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the gameplay camera: explicit kind==camera, else chase, else default."""
    for obj in _objects(scene):
        if obj.get("kind") == "camera":
            pos = _vec3(obj, "position", DEFAULT_CAM_POS)
            rot = _vec3(obj, "rotation", (0.0, 0.0, 0.0))
            options = obj.get("cameraOptions")
            fov = (
                _num(options.get("fov"), DEFAULT_FOV_DEG)
                if isinstance(options, dict)
                else DEFAULT_FOV_DEG
            )
            if not (1.0 <= fov <= 179.0):
                fov = DEFAULT_FOV_DEG
            return {
                "source": "explicit",
                "name": str(obj.get("name", "camera")),
                "position": pos,
                "rotation": rot,
                "fov": fov,
            }
    for obj in _objects(scene):
        if obj.get("controller") is True:
            target = _vec3(obj, "position", (0.0, 1.0, 0.0))
            eye = (target[0], target[1] + CHASE_UP, target[2] + CHASE_BACK)
            return {
                "source": "chase",
                "name": str(obj.get("name", "player")),
                "position": eye,
                "rotation": _look_at_rotation(eye, target),
                "fov": DEFAULT_FOV_DEG,
            }
    eye = DEFAULT_CAM_POS
    return {
        "source": "default",
        "name": "default-orbit",
        "position": eye,
        "rotation": _look_at_rotation(eye, DEFAULT_LOOK_AT),
        "fov": DEFAULT_FOV_DEG,
    }


def _basis(rotation: Tuple[float, float, float]):
    rx, ry, _ = rotation
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    # Camera looks along -Z in its local frame; world-to-camera rows:
    # right = Ry*Rx*(1,0,0), up = Ry*Rx*(0,1,0), fwd = Ry*Rx*(0,0,-1)
    right = (cy, 0.0, -sy)
    up = (sy * sx, cx, cy * sx)
    fwd = (-sy * cx, sx, -cy * cx)
    return right, up, fwd


def _project(
    point: Tuple[float, float, float],
    eye: Tuple[float, float, float],
    right: Tuple[float, float, float],
    up: Tuple[float, float, float],
    fwd: Tuple[float, float, float],
    focal: float,
    cx: float,
    cy: float,
) -> Optional[Tuple[float, float, float]]:
    dx, dy, dz = point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]
    x = dx * right[0] + dy * right[1] + dz * right[2]
    y = dx * up[0] + dy * up[1] + dz * up[2]
    z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]
    if z <= 0.05:  # behind / too close to the lens
        return None
    return (cx + focal * x / z, cy - focal * y / z, z)


def render_frame_png(
    scene: Dict[str, Any],
    width: int = FRAME_WIDTH,
    height: int = FRAME_HEIGHT,
) -> bytes:
    """Render the gameplay-camera view to PNG bytes (raises ImportError w/o Pillow)."""
    from PIL import Image, ImageDraw

    cam = select_camera(scene)
    eye = cam["position"]
    right, up, fwd = _basis(cam["rotation"])
    focal = (height / 2.0) / math.tan(math.radians(cam["fov"]) / 2.0)
    cx, cy = width / 2.0, height / 2.0

    image = Image.new("RGB", (width, height), (12, 14, 20))
    draw = ImageDraw.Draw(image)
    # Sky gradient (cheap depth cue, deterministic).
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=(int(12 + 30 * t), int(14 + 34 * t), int(20 + 52 * t)),
        )

    boxes: List[Dict[str, Any]] = []
    for obj in _objects(scene):
        if obj.get("kind") in ("camera", "light"):
            continue
        pos = _vec3(obj, "position", (0.0, 0.0, 0.0))
        size = _vec3(obj, "size", (1.0, 1.0, 1.0))
        size = (max(0.05, size[0]), max(0.05, size[1]), max(0.05, size[2]))
        color = _parse_color(obj.get("color"))
        corners = [
            (pos[0] + cx_ * size[0], pos[1] + cy_ * size[1], pos[2] + cz_ * size[2])
            for (cx_, cy_, cz_) in _CORNERS
        ]
        projected = [_project(p, eye, right, up, fwd, focal, cx, cy) for p in corners]
        depths = [p[2] for p in projected if p is not None]
        if not depths:
            continue
        boxes.append(
            {
                "name": str(obj.get("name", "?")),
                "color": color,
                "projected": projected,
                "depth": min(depths),
                "controller": obj.get("controller") is True,
            }
        )
    boxes.sort(key=lambda b: b["depth"], reverse=True)

    for box in boxes:
        proj = box["projected"]
        shade = max(0.25, min(1.0, 8.0 / (box["depth"] + 4.0)))
        base = box["color"]
        fill = (int(base[0] * shade), int(base[1] * shade), int(base[2] * shade))
        for face in _FACES:
            pts = [proj[i] for i in face]
            if any(p is None for p in pts):
                continue
            draw.polygon([(p[0], p[1]) for p in pts], fill=fill, outline=(10, 10, 14))
        # Label the nearest corner so frames stay debuggable.
        visible = [p for p in proj if p is not None]
        if visible:
            nearest = min(visible, key=lambda p: p[2])
            draw.text(
                (
                    min(max(2, nearest[0]), width - 60),
                    min(max(2, nearest[1] - 10), height - 12),
                ),
                box["name"][:18],
                fill=(235, 235, 240),
            )

    draw.text((6, 4), f"CAM {cam['source']}:{cam['name'][:20]}", fill=(200, 200, 210))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def frame_metadata(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Small JSON-serializable summary of the frame viewpoint (for run logs)."""
    cam = select_camera(scene)
    return {
        "cameraSource": cam["source"],
        "cameraName": cam["name"],
        "cameraPosition": list(cam["position"]),
        "fov": cam["fov"],
        "objectCount": len(_objects(scene)),
    }
