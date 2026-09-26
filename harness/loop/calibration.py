"""
VLM calibration logging (A.2 promotion path): measure rubric-vs-proxy agreement.

VLM rubric scores are advisory until calibrated against human judgment; the
deterministic aesthetic proxies are the machine-ruled stand-in both judge
against. Every loop iteration carrying BOTH is one calibration sample:
per-axis {proxy, vlm, delta, agree} with agreement defined as |delta| <= 1
(one step of rater wobble, JudgeFit-style tolerance thinking).

Promotion rule (documented, NOT executed): an axis graduates to blocking only
with agree >= 0.8 over >= 20 samples AND logged human agreement behind it.
Promotion stays a human decision — this module produces the evidence ledger.
"""

from typing import Any, Dict, List, Optional

AGREE_TOLERANCE = 1
PROMOTION_MIN_AGREE = 0.8
PROMOTION_MIN_SAMPLES = 20


def compare_rubric(
    proxy_scores: Dict[str, Any], vlm_scores: Dict[str, Any]
) -> Dict[str, Any]:
    """Compare deterministic proxy scores against VLM rubric scores."""
    axes = sorted(set(proxy_scores) & set(vlm_scores))
    per_axis = {}
    for axis in axes:
        try:
            proxy = int(proxy_scores[axis])
            vlm = int(vlm_scores[axis])
        except (TypeError, ValueError):
            continue
        delta = vlm - proxy
        per_axis[axis] = {
            "proxy": proxy,
            "vlm": vlm,
            "delta": delta,
            "agree": abs(delta) <= AGREE_TOLERANCE,
        }
    deltas = [abs(v["delta"]) for v in per_axis.values()]
    agreed = sum(1 for v in per_axis.values() if v["agree"])
    return {
        "axes": per_axis,
        "compared": len(per_axis),
        "agreed": agreed,
        "agreementRate": round(agreed / len(per_axis), 3) if per_axis else 0.0,
        "meanAbsDelta": round(sum(deltas) / len(deltas), 3) if deltas else 0.0,
    }


def promotion_readiness(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Per-axis promotion verdicts from a calibration_summary() bundle."""
    ready = {}
    for axis, stats in (summary.get("perAxis") or {}).items():
        samples = stats.get("samples", 0)
        rate = stats.get("agreementRate", 0.0)
        ready[axis] = {
            "ready": samples >= PROMOTION_MIN_SAMPLES and rate >= PROMOTION_MIN_AGREE,
            "samples": samples,
            "agreementRate": rate,
            "needed": max(0, PROMOTION_MIN_SAMPLES - samples),
        }
    return ready


def extract_proxy_scores(record: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """Pull deterministic visual scores from a loop iteration record."""
    audits = record.get("visual")
    if not isinstance(audits, list) or not audits:
        return None
    merged: Dict[str, int] = {}
    for audit in audits:
        scores = audit.get("scores") if isinstance(audit, dict) else None
        if isinstance(scores, dict):
            for axis, value in scores.items():
                try:
                    merged[str(axis)] = int(value)
                except (TypeError, ValueError):
                    continue
    return merged or None


def extract_vlm_scores(record: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """Pull VLM rubric scores from a loop iteration record (advisory layer)."""
    vision = record.get("vision")
    if not isinstance(vision, dict):
        return None
    scores = vision.get("rubricScores")
    if not isinstance(scores, dict) or not scores:
        return None
    out = {}
    for axis, value in scores.items():
        try:
            out[str(axis)] = int(value)
        except (TypeError, ValueError):
            continue
    return out or None
