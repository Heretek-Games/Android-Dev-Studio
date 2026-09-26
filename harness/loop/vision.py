"""
Vision critique for the iterate-until-green loop (Track A.2: rubric layer).

Two critique paths share one telemetry envelope (`VisionResult`):

- layout critique: the deterministic top-down diagram (spawn overlaps, missing
  ground, unreachable props) — unchanged from Phase 0.
- frame rubric critique: the A.1 gameplay-camera frame scored 1-5 on four axes
  (composition, color_harmony, readability, ui_alignment) with actionable
  defects. VLM scores are LOGGED calibration evidence and never gate anything:
  gameplay verdicts stay machine-ruled and look-dev gating runs on the
  deterministic proxies in `harness/loop/aesthetic.py` (see `visual_quality_min`
  with enforce:true). VLM noise rationale: JudgeFit-style per-model calibration
  plus judge-without-seeing grounding risk — promote to blocking only with
  logged human agreement behind it.

Critique calls carry their own telemetry (`VisionResult`) so the loop can include
vision tokens/latency in the run dashboard.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from harness.loop.llm_client import DEFAULT_VISION_MODEL, LlmClient
from harness.loop.scene_preview import render_layout_png

#: The vision route is served by a reasoning model: small budgets are consumed by
#: the thinking phase and return empty content with finish_reason="length".
DEFAULT_VISION_MAX_TOKENS = 6000
VISION_RETRY_MAX_TOKENS = 12000

RUBRIC_AXES = ("composition", "color_harmony", "readability", "ui_alignment")

CRITIQUE_PROMPT = """You are the visual QA reviewer for a mobile 3D game scene under construction.

The attached image is a TOP-DOWN layout diagram of the generated scene:
- X grows to the right, Z grows downward; the header shows the world-space extents
- filled rectangles are objects (rectangle size = object size.x by size.z), labelled with names
- the rectangle ringed in WHITE is the player-controlled object
- yellow diamonds are lights

Critique the layout for a playable level. Report only concrete, verifiable problems:
player spawning inside obstacles, missing ground under the player, objects overlapping
so they cannot be collected/avoided, props outside the arena bounds, missing light, or
excessive clutter. Do not invent details that are not visible.

Respond with a single JSON object and nothing else:
{"issues": ["..."], "suggestions": ["..."]}
"""

FRAME_RUBRIC_PROMPT = """You are the visual QA reviewer for a mobile 3D game scene under construction.

The attached image is a GAMEPLAY-CAMERA view of the generated scene (a low-fidelity
software preview: flat-shaded boxes, painter-sorted, sky gradient background).
Judge what is visible — layout, color, and legibility — not the preview fidelity.

Score each axis 1-5 (anchors: 1 broken/unusable, 2 poor, 3 acceptable, 4 good, 5 excellent):
- composition: is the scene framed as a playable space (ground present, subject
  visible, props spread so each reads as collectible/avoidable, no clutter pile-ups)?
- color_harmony: does the palette cohere (2-3 genre hues, intentional accents)
  instead of random rainbow or mud-on-mud?
- readability: can each prop be told apart from the ground and its neighbors at
  a glance (contrast, separation)?
- ui_alignment: only score above 1 if visible UI/text/HUD is present AND aligned
  and legible; with no UI visible, score 3 and note "no UI in frame".

Every defect must be concrete and repairable: name the object/region and the fix
("move X", "recolor Y toward Z", "delete N"). Never write "make it prettier".

Respond with a single JSON object and nothing else:
{"scores": {"composition": 3, "color_harmony": 2, "readability": 4, "ui_alignment": 3},
 "defects": [{"axis": "color_harmony", "defect": "...", "repair": "..."}]}
"""


@dataclass
class VisionResult:
    """Critique notes plus the telemetry of the underlying vision call."""

    notes: List[str] = field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_seconds: float = 0.0
    error: Optional[str] = None
    detail: str = ""
    #: Rubric layer (A.2): axis scores + structured defects. Empty when the
    #: response carried no parseable rubric (layout critiques, garbage).
    rubric_scores: Dict[str, int] = field(default_factory=dict)
    rubric_defects: List[Dict[str, str]] = field(default_factory=list)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    @property
    def rubric_overall(self) -> Optional[int]:
        if not self.rubric_scores:
            return None
        return min(self.rubric_scores.values())


def parse_critique(text: str) -> List[str]:
    """Extract issue/suggestion notes from a critique response (tolerant parse)."""
    candidates: List[str] = []
    closed = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if closed:
        candidates.append(closed.group(1).strip())
    candidates.append(text.strip())

    for payload in candidates:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        notes: List[str] = []
        issues = data.get("issues")
        suggestions = data.get("suggestions")
        for issue in issues if isinstance(issues, list) else []:
            if isinstance(issue, str) and issue.strip():
                notes.append(f"Issue: {issue.strip()}")
        for suggestion in suggestions if isinstance(suggestions, list) else []:
            if isinstance(suggestion, str) and suggestion.strip():
                notes.append(f"Suggestion: {suggestion.strip()}")
        return notes
    return []


def parse_rubric(text: str) -> Dict[str, Any]:
    """Extract {scores, defects} from a rubric response (tolerant parse).

    Returns {} when nothing rubric-shaped parses. Scores are clamped to 1-5
    and restricted to known axes; defects keep only entries with a known axis
    and non-empty defect text. Legacy issues/suggestions payloads return {}
    (they are not rubrics) — use parse_critique for those.
    """
    candidates: List[str] = []
    closed = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if closed:
        candidates.append(closed.group(1).strip())
    candidates.append(text.strip())

    for payload in candidates:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict) or not isinstance(data.get("scores"), dict):
            continue
        scores: Dict[str, int] = {}
        for axis in RUBRIC_AXES:
            value = data["scores"].get(axis)
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            scores[axis] = max(1, min(5, number))
        if not scores:
            continue
        defects: List[Dict[str, str]] = []
        raw_defects = data.get("defects")
        if isinstance(raw_defects, list):
            for entry in raw_defects:
                if not isinstance(entry, dict):
                    continue
                axis = entry.get("axis")
                defect = entry.get("defect")
                if (
                    axis not in RUBRIC_AXES
                    or not isinstance(defect, str)
                    or not defect.strip()
                ):
                    continue
                item = {"axis": axis, "defect": defect.strip()}
                repair = entry.get("repair")
                if isinstance(repair, str) and repair.strip():
                    item["repair"] = repair.strip()
                defects.append(item)
        return {"scores": scores, "defects": defects}
    return {}


def defects_to_notes(
    scores: Dict[str, int], defects: List[Dict[str, str]], max_notes: int = 6
) -> List[str]:
    """Compile rubric defects into repair-prompt notes (actionable, never vibes)."""
    notes: List[str] = []
    for entry in defects:
        axis = entry.get("axis", "?")
        score = scores.get(axis, "?")
        text = f"[{axis} {score}/5] {entry.get('defect', '').strip()}"
        repair = (
            entry.get("repair", "").strip()
            if isinstance(entry.get("repair"), str)
            else ""
        )
        if repair:
            text += f" → repair: {repair}"
        notes.append(text)
        if len(notes) >= max_notes:
            break
    return notes


def _failure_context(failed_rules: Optional[List[Dict[str, Any]]]) -> str:
    if not failed_rules:
        return ""
    lines = []
    for rule in failed_rules:
        detail = rule.get("detail") or ""
        lines.append(f"- [{rule.get('id', rule.get('type'))}] {detail}".strip())
    return (
        "\nThe automated QA just reported these failures — look for visual evidence of them "
        "(spawn overlaps, missing ground, unreachable props):\n" + "\n".join(lines)
    )


def _critique_call(
    client: LlmClient,
    prompt: str,
    image_bytes: bytes,
    model: Optional[str],
    max_tokens: int,
    mime: str = "image/png",
) -> VisionResult:
    """
    One critique call with a single self-healing retry: reasoning models can
    exhaust a small budget and return empty content (finish_reason="length"), so
    that specific outcome is retried with a larger budget before giving up.
    """
    response = client.chat_with_image(
        prompt, image_bytes, mime=mime, model=model, max_tokens=max_tokens
    )
    prompt_tokens = response.prompt_tokens
    completion_tokens = response.completion_tokens
    latency = response.latency_seconds
    detail = ""

    if not response.text.strip() and response.finish_reason == "length":
        retry_budget = min(max_tokens * 2, VISION_RETRY_MAX_TOKENS)
        retry = client.chat_with_image(
            prompt, image_bytes, mime=mime, model=model, max_tokens=retry_budget
        )
        prompt_tokens += retry.prompt_tokens
        completion_tokens += retry.completion_tokens
        latency += retry.latency_seconds
        detail = f"first vision attempt truncated at {max_tokens} tokens; retried at {retry_budget}"
        response = retry

    result = VisionResult(
        notes=parse_critique(response.text),
        model=response.model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_seconds=latency,
        detail=detail,
    )
    # Rubric layer: when the response carries axis scores, attach them as
    # calibration evidence and compile defects into repair notes. Scores never
    # gate — see module docstring.
    rubric = parse_rubric(response.text)
    if rubric:
        result.rubric_scores = rubric["scores"]
        result.rubric_defects = rubric["defects"]
        result.notes = defects_to_notes(rubric["scores"], rubric["defects"])
    if not response.text.strip():
        result.error = f"vision model returned no content (finish_reason={response.finish_reason or 'unknown'})"
    return result


def make_layout_critique(
    client: LlmClient,
    model: Optional[str] = None,
    max_notes: int = 6,
) -> Callable[..., VisionResult]:
    """Build a `(scene, failed_rules) -> VisionResult` critique backed by the vision route."""

    def critique(
        scene: Dict[str, Any],
        failed_rules: Optional[List[Dict[str, Any]]] = None,
    ) -> VisionResult:
        png = render_layout_png(scene)
        prompt = CRITIQUE_PROMPT + _failure_context(failed_rules)
        result = _critique_call(
            client,
            prompt,
            png,
            model or DEFAULT_VISION_MODEL,
            DEFAULT_VISION_MAX_TOKENS,
        )
        result.notes = result.notes[:max_notes]
        return result

    return critique


def critique_frame(
    client: LlmClient,
    frame_bytes: bytes,
    mime: str = "image/png",
    model: Optional[str] = None,
    max_notes: int = 6,
    failed_rules: Optional[List[Dict[str, Any]]] = None,
) -> VisionResult:
    """Critique an actual rendered frame (studio screenshot / emulator readback)."""
    prompt = CRITIQUE_PROMPT + _failure_context(failed_rules)
    result = _critique_call(
        client,
        prompt,
        frame_bytes,
        model or DEFAULT_VISION_MODEL,
        DEFAULT_VISION_MAX_TOKENS,
        mime=mime,
    )
    result.notes = result.notes[:max_notes]
    return result


def critique_frame_rubric(
    client: LlmClient,
    frame_bytes: bytes,
    mime: str = "image/png",
    model: Optional[str] = None,
    max_notes: int = 6,
    failed_rules: Optional[List[Dict[str, Any]]] = None,
) -> VisionResult:
    """Score a gameplay frame on the 4-axis rubric (calibration evidence only).

    The returned notes are repair-actionable defect strings; rubric_scores holds
    the raw axis scores for calibration logging. Never gates — enforcement runs
    on the deterministic proxies (`aesthetic.evaluate_visual_rule`).
    """
    prompt = FRAME_RUBRIC_PROMPT + _failure_context(failed_rules)
    result = _critique_call(
        client,
        prompt,
        frame_bytes,
        model or DEFAULT_VISION_MODEL,
        DEFAULT_VISION_MAX_TOKENS,
        mime=mime,
    )
    result.notes = result.notes[:max_notes]
    return result


def make_frame_critique(
    client: LlmClient,
    model: Optional[str] = None,
    max_notes: int = 6,
) -> Callable[..., VisionResult]:
    """Build a `(scene, failed_rules) -> VisionResult` rubric critique over A.1 frames."""
    from harness.loop.frame_preview import render_frame_png

    def critique(
        scene: Dict[str, Any],
        failed_rules: Optional[List[Dict[str, Any]]] = None,
    ) -> VisionResult:
        png = render_frame_png(scene)
        return critique_frame_rubric(
            client,
            png,
            model=model or DEFAULT_VISION_MODEL,
            max_notes=max_notes,
            failed_rules=failed_rules,
        )

    return critique
