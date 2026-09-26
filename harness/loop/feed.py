"""
Agent activity feed summarizer (Track D.2): project loop run logs into a
UI-sized feed. Pure stdlib; the dev-server bridge calls summarize_runs()
on user expand (never polled).
"""

import glob
import json
import os
from typing import Any, Dict, List

DEFAULT_RUNS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "runs",
    "loop_runs",
)


def _summarize_iteration(record: Dict[str, Any]) -> Dict[str, Any]:
    apply = record.get("apply") or {}
    gate = record.get("gate") or {}
    qa = record.get("qa") or {}
    visual = record.get("visual") or []
    spatial = record.get("spatial") or []
    return {
        "iteration": record.get("iteration"),
        "phase": record.get("phase"),
        "applied": apply.get("applied", 0),
        "gate": "ok" if gate.get("valid") else ("violated" if gate else "n/a"),
        "qa": qa.get("verdict", "n/a"),
        "qaScore": (
            f"{qa.get('passed')}/{qa.get('total')}"
            if qa.get("passed") is not None
            else None
        ),
        "visual": (
            f"{sum(1 for v in visual if v.get('pass'))}/{len(visual)}"
            if visual
            else None
        ),
        "spatial": (
            "pass"
            if all(s.get("pass") for s in spatial)
            else "fail"
            if spatial
            else None
        ),
        "hasDiff": bool(record.get("spatialDiff")),
        "hasFrame": bool(record.get("frame")),
    }


def summarize_runs(
    runs_dir: str = DEFAULT_RUNS_DIR, limit_runs: int = 5, limit_iterations: int = 8
) -> Dict[str, Any]:
    """Newest-first run summaries with capped per-iteration rows."""
    try:
        paths = sorted(
            glob.glob(os.path.join(runs_dir, "*.json")),
            key=os.path.getmtime,
            reverse=True,
        )[:limit_runs]
    except OSError:
        return {"runs": []}
    runs: List[Dict[str, Any]] = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        iterations = data.get("iterations") or []
        runs.append(
            {
                "file": os.path.basename(path),
                "goal": data.get("goal", "?"),
                "verdict": data.get("verdict", "?"),
                "totalTokens": data.get("totalTokens", 0),
                "mtime": os.path.getmtime(path),
                "iterations": [
                    _summarize_iteration(r) for r in iterations if isinstance(r, dict)
                ][-limit_iterations:],
            }
        )
    return {"runs": runs}
