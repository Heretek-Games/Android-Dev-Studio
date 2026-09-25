"""
Vision critique for the iterate-until-green loop.

Sends an image of the current scene to the multimodal model route and turns the
response into short, actionable notes for the repair prompt. The image is either
the deterministic top-down layout preview (`scene_preview.render_layout_png`) or
any rendered frame (studio screenshot / emulator frame readback) supplied by the
caller — the critique logic is identical.

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

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


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
