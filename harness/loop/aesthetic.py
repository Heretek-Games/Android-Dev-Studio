"""
Deterministic visual-quality proxies for the loop (Track A.2, layer 2).

Machine-ruled, dependency-free, and free to run every iteration — the counterweight
to noisy VLM rubric scores. Each proxy maps to one rubric axis (1-5) and emits
actionable defects ("... → repair: ..."), never vibes.

Proxies (all computed from the flat scene dict, no rendering):
  - composition: player grounded on/above a fixed ground + reachable spread of
    props (no stacking pile-ups within 0.5u) + object-count clutter budget.
  - color_harmony: palette size (distinct hues) budget + WCAG contrast of each
    prop color against the ground color (mud-on-mud is unreadable).
  - readability: worst prop-vs-ground WCAG contrast ratio mapped to 1-5
    (4.5+:5, 3+:4, 2+:3, 1.5+:2, else 1).
  - ui_alignment: scene-side stub — headless scenes carry no UI tree yet, so the
    axis reports 3/5 neutral with no defects (explicitly, not silently). Real UI
    scoring arrives with Track A.3 UI kits.

`evaluate_visual_rule(scene, rule)` compiles a scenario rule of type
`visual_quality_min` ({minScore, axes?, enforce?}) into pass/fail + details.
"""

import math
from typing import Any, Dict, List, Tuple

RUBRIC_AXES = ("composition", "color_harmony", "readability", "ui_alignment")

# WCAG 2.x thresholds reused as readability anchors.
CONTRAST_AA_BODY = 4.5
CONTRAST_AA_LARGE = 3.0

# Composition budgets.
MAX_OBJECTS_SOFT = 40
MAX_OBJECTS_HARD = 80
PILEUP_DISTANCE = 0.5
REACH_SPREAD = 30.0


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def _objects(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = scene.get("gameObjects")
    if not isinstance(raw, list):
        return []
    return [o for o in raw if isinstance(o, dict)]


def _pos(obj: Dict[str, Any]) -> Tuple[float, float, float]:
    value = obj.get("position")
    if not (isinstance(value, (list, tuple)) and len(value) == 3):
        return (0.0, 0.0, 0.0)
    return (_num(value[0]), _num(value[1]), _num(value[2]))


def _hex_to_rgb(value: Any) -> Tuple[float, float, float]:
    if not isinstance(value, str) or not value.startswith("#"):
        return (0.47, 0.47, 0.47)
    digits = value[1:]
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    if len(digits) != 6:
        return (0.47, 0.47, 0.47)
    try:
        return tuple(int(digits[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (0.47, 0.47, 0.47)


def _linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: Tuple[float, float, float]) -> float:
    r, g, b = (_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: Any, b: Any) -> float:
    """WCAG contrast ratio between two #rrggbb colors (1..21)."""
    la = relative_luminance(_hex_to_rgb(a))
    lb = relative_luminance(_hex_to_rgb(b))
    lighter, darker = (la, lb) if la >= lb else (lb, la)
    return (lighter + 0.05) / (darker + 0.05)


def _ground_object(objects: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Largest fixed-physics footprint: the walkable ground plane, if any."""
    best: Optional[Dict[str, Any]] = None
    best_area = -1.0
    for obj in objects:
        if obj.get("kind") in ("camera", "light"):
            continue
        if obj.get("physics") != "fixed":
            continue
        size = obj.get("size")
        try:
            area = (
                float(size[0]) * float(size[2])
                if isinstance(size, (list, tuple))
                else 1.0
            )
        except (TypeError, ValueError, IndexError):
            area = 1.0
        if area > best_area:
            best_area = area
            best = obj
    return best


def _ground_color(objects: List[Dict[str, Any]]) -> Any:
    ground = _ground_object(objects)
    if ground is not None:
        return ground.get("color", "#18181b")
    best: Any = "#18181b"
    best_area = -1.0
    for obj in objects:
        if obj.get("kind") in ("camera", "light"):
            continue
        size = obj.get("size")
        try:
            area = (
                float(size[0]) * float(size[2])
                if isinstance(size, (list, tuple))
                else 1.0
            )
        except (TypeError, ValueError, IndexError):
            area = 1.0
        if area > best_area:
            best_area = area
            best = obj.get("color", best)
    return best


def audit_scene(scene: Dict[str, Any]) -> Dict[str, Any]:
    """Score the scene 1-5 per axis with actionable defects. Pure + deterministic."""
    objects = _objects(scene)
    solids = [o for o in objects if o.get("kind") not in ("camera", "light")]
    ground_obj = _ground_object(objects)
    # The ground plane is the backdrop, not a prop: scoring it against its own
    # color would always report contrast 1:1. Props are everything else.
    props = [o for o in solids if o is not ground_obj]
    scores: Dict[str, int] = {}
    defects: List[Dict[str, str]] = []

    # --- composition: grounding + pile-ups + spread + clutter ---
    comp_defects: List[str] = []
    players = [o for o in solids if o.get("controller") is True]
    grounds = [o for o in solids if (o.get("physics") == "fixed")]
    if players and not grounds:
        comp_defects.append(
            "player has no fixed ground under it → repair: spawn a fixed ground plane beneath the player"
        )
    pileups = 0
    for i in range(len(solids)):
        for j in range(i + 1, len(solids)):
            a, b = _pos(solids[i]), _pos(solids[j])
            dist = math.dist((a[0], a[2]), (b[0], b[2]))
            if dist < PILEUP_DISTANCE and abs(a[1] - b[1]) < 1.0:
                pileups += 1
    if pileups:
        comp_defects.append(
            f"{pileups} prop pile-up(s) within {PILEUP_DISTANCE}u (overlapping footprints) "
            "→ repair: spread props ≥1u apart so each is collectible/avoidable"
        )
    if len(solids) > MAX_OBJECTS_HARD:
        comp_defects.append(
            f"{len(solids)} objects exceeds hard clutter budget {MAX_OBJECTS_HARD} "
            "→ repair: delete or batch props"
        )
    elif len(solids) > MAX_OBJECTS_SOFT:
        comp_defects.append(
            f"{len(solids)} objects over soft clutter budget {MAX_OBJECTS_SOFT} "
            "→ repair: trim decorative props"
        )
    if len(comp_defects) == 0:
        scores["composition"] = 5
    elif len(solids) > MAX_OBJECTS_HARD or (players and not grounds):
        scores["composition"] = 1 if (players and not grounds) else 2
    elif len(comp_defects) == 1:
        scores["composition"] = 3
    else:
        scores["composition"] = 2
    for defect in comp_defects:
        defects.append({"axis": "composition", "defect": defect})

    # --- color_harmony: palette breadth + mud check ---
    ground = _ground_color(objects)
    hues = set()
    for obj in props:
        rgb = _hex_to_rgb(obj.get("color"))
        mx, mn = max(rgb), min(rgb)
        if mx - mn < 0.08:
            continue  # near-gray, not a hue
        import colorsys

        h, _, _ = colorsys.rgb_to_hsv(*rgb)
        hues.add(round(h * 12))
    color_defects: List[str] = []
    if len(hues) > 8:
        color_defects.append(
            f"palette spans {len(hues)} hue buckets (>8) → repair: consolidate props toward 2-3 genre hues"
        )
    muddy = [o for o in props if contrast_ratio(o.get("color"), ground) < 1.5]
    if muddy:
        names = ", ".join(str(o.get("name", "?"))[:16] for o in muddy[:4])
        color_defects.append(
            f"{len(muddy)} prop(s) near-identical to the ground ({names}) "
            "→ repair: shift their colors ≥3:1 contrast from the ground"
        )
    if not props:
        scores["color_harmony"] = 1
        color_defects.append(
            "scene has no visible props → repair: spawn the brief's set pieces"
        )
    elif not color_defects:
        scores["color_harmony"] = 5
    elif len(color_defects) == 1 and not muddy:
        scores["color_harmony"] = 4
    else:
        scores["color_harmony"] = 2 if muddy else 3
    for defect in color_defects:
        defects.append({"axis": "color_harmony", "defect": defect})

    # --- readability: worst prop-vs-ground contrast ---
    if not props:
        scores["readability"] = 1
    else:
        worst = min(contrast_ratio(o.get("color"), ground) for o in props)
        if worst >= CONTRAST_AA_BODY:
            scores["readability"] = 5
        elif worst >= CONTRAST_AA_LARGE:
            scores["readability"] = 4
        elif worst >= 2.0:
            scores["readability"] = 3
            defects.append(
                {
                    "axis": "readability",
                    "defect": f"worst prop-vs-ground contrast {worst:.1f}:1 < 3:1 "
                    "→ repair: brighten/darken low-contrast props",
                }
            )
        elif worst >= 1.5:
            scores["readability"] = 2
            defects.append(
                {
                    "axis": "readability",
                    "defect": f"worst prop-vs-ground contrast {worst:.1f}:1 < 2:1 "
                    "→ repair: recolor low-contrast props",
                }
            )
        else:
            scores["readability"] = 1
            defects.append(
                {
                    "axis": "readability",
                    "defect": f"worst prop-vs-ground contrast {worst:.1f}:1 — props invisible on ground "
                    "→ repair: recolor props to ≥3:1 contrast",
                }
            )

    # --- ui_alignment: explicit neutral stub (no UI tree headless yet) ---
    scores["ui_alignment"] = 3

    overall = min(scores.values()) if scores else 1
    mean = round(sum(scores.values()) / len(scores), 2) if scores else 1.0
    return {"scores": scores, "overall": overall, "mean": mean, "defects": defects}


def evaluate_visual_rule(scene: Dict[str, Any], rule: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate one visual_quality_min rule. Returns JSON-serializable verdict."""
    audit = audit_scene(scene)
    min_score = rule.get("minScore", 3)
    try:
        min_score = int(min_score)
    except (TypeError, ValueError):
        min_score = 3
    axes = rule.get("axes")
    if not isinstance(axes, list) or not axes:
        axes = list(RUBRIC_AXES)
    axes = [a for a in axes if a in RUBRIC_AXES] or list(RUBRIC_AXES)
    failing = [
        {"axis": axis, "score": audit["scores"][axis], "minScore": min_score}
        for axis in axes
        if audit["scores"][axis] < min_score
    ]
    axis_defects = [d for d in audit["defects"] if d["axis"] in axes]
    return {
        "id": rule.get("id", rule.get("type")),
        "type": "visual_quality_min",
        "pass": not failing,
        "scores": {a: audit["scores"][a] for a in axes},
        "overall": min(audit["scores"][a] for a in axes),
        "minScore": min_score,
        "enforce": bool(rule.get("enforce", False)),
        "failingAxes": failing,
        "defects": axis_defects,
    }
