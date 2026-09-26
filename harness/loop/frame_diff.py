"""
Frame differ for run-vs-baseline visual audit (Track A.4, headless half).

`compare_pngs` pixel-diffs two PNGs into {diffPercent, worstRegion, heatmap} —
the JSON the future Artemis dock view consumes for second-scale human audit.
Baselines live under harness/runs/frame_baselines/<stem>.png (checked in once
a human approves them, Playwright-snapshot-style); `compare_to_baseline`
resolves + compares + optionally promotes the candidate.

Strict on size: mismatched dimensions report sizesDiffer with diffPercent 100
instead of a resampled lie — A.1 frames are fixed-size, so a mismatch means the
capture path changed and deserves attention, not silent normalization.
"""

import io
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BASELINES_DIR = REPO_ROOT / "harness" / "runs" / "frame_baselines"


def compare_pngs(a_bytes: bytes, b_bytes: bytes, cell: int = 8) -> Dict[str, Any]:
    """Diff two PNGs. Raises ImportError without Pillow, ValueError on garbage."""
    from PIL import Image, ImageChops, ImageDraw

    a = Image.open(io.BytesIO(a_bytes)).convert("RGB")
    b = Image.open(io.BytesIO(b_bytes)).convert("RGB")
    if a.size != b.size:
        return {
            "sizesDiffer": True,
            "sizeA": list(a.size),
            "sizeB": list(b.size),
            "diffPercent": 100.0,
            "worstRegion": None,
            "heatmap": b"",
        }
    width, height = a.size
    diff = ImageChops.difference(a, b).convert("L")
    pixels = list(diff.getdata())
    mean = sum(pixels) / (len(pixels) * 255.0) if pixels else 0.0

    cols = max(1, width // cell)
    rows = max(1, height // cell)
    worst: Tuple[int, int, float] = (0, 0, 0.0)
    for row in range(rows):
        for col in range(cols):
            total, count = 0, 0
            for y in range(row * cell, min(height, (row + 1) * cell)):
                base = y * width
                for x in range(col * cell, min(width, (col + 1) * cell)):
                    total += pixels[base + x]
                    count += 1
            score = (total / count / 255.0) if count else 0.0
            if score > worst[2]:
                worst = (col, row, score)
    heat = a.copy()
    overlay = Image.new("RGB", a.size, (255, 0, 0))
    mask = diff.point(lambda v: int(min(255, v * 2)))
    heat.paste(overlay, mask=mask)
    draw = ImageDraw.Draw(heat)
    draw.rectangle(
        [
            worst[0] * cell,
            worst[1] * cell,
            min(width, (worst[0] + 1) * cell),
            min(height, (worst[1] + 1) * cell),
        ],
        outline=(255, 255, 0),
        width=2,
    )
    buffer = io.BytesIO()
    heat.save(buffer, format="PNG")
    return {
        "sizesDiffer": False,
        "sizeA": list(a.size),
        "sizeB": list(b.size),
        "diffPercent": round(mean * 100.0, 3),
        "worstRegion": {
            "col": worst[0],
            "row": worst[1],
            "cell": cell,
            "score": round(worst[2], 3),
        },
        "heatmap": buffer.getvalue(),
    }


def baseline_path(stem: str, baselines_dir: Optional[Path] = None) -> Path:
    safe = "".join(c if (c.isalnum() or c in "-_") else "-" for c in stem)[:80]
    return (baselines_dir or BASELINES_DIR) / f"{safe}.png"


def compare_to_baseline(
    stem: str,
    frame_bytes: bytes,
    baselines_dir: Optional[Path] = None,
    promote: bool = False,
) -> Dict[str, Any]:
    """Compare a frame against its approved baseline (Playwright-style).

    No baseline yet → store nothing, report status 'no-baseline' (never a
    silent pass). promote=True writes the candidate as the new baseline
    (the human-approves step the dock will front).
    """
    path = baseline_path(stem, baselines_dir)
    if promote:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(frame_bytes)
        return {"status": "promoted", "path": str(path)}
    if not path.is_file():
        return {"status": "no-baseline", "path": str(path)}
    result = compare_pngs(path.read_bytes(), frame_bytes)
    result["status"] = "compared"
    result["path"] = str(path)
    return result
