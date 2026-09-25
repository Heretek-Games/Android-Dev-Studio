"""
Vision critique for the iterate-until-green loop.

Sends an image of the current scene to the multimodal model route and turns the
response into short, actionable notes for the repair prompt. The image is either
the deterministic top-down layout preview (`scene_preview.render_layout_png`) or
any rendered frame (studio screenshot / emulator frame readback) supplied by the
caller — the critique logic is identical.
"""

import json
import re
from typing import Any, Callable, Dict, List, Optional

from harness.loop.llm_client import DEFAULT_VISION_MODEL, LlmClient
from harness.loop.scene_preview import render_layout_png

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


def make_layout_critique(
    client: LlmClient,
    model: Optional[str] = None,
    max_notes: int = 6,
) -> Callable[[Dict[str, Any]], List[str]]:
    """Build a `scene -> notes` critique callable backed by the vision model route."""

    def critique(scene: Dict[str, Any]) -> List[str]:
        png = render_layout_png(scene)
        response = client.chat_with_image(
            CRITIQUE_PROMPT, png, model=model or DEFAULT_VISION_MODEL
        )
        return parse_critique(response.text)[:max_notes]

    return critique


def critique_frame(
    client: LlmClient,
    frame_bytes: bytes,
    mime: str = "image/png",
    model: Optional[str] = None,
    max_notes: int = 6,
) -> List[str]:
    """Critique an actual rendered frame (studio screenshot / emulator readback)."""
    response = client.chat_with_image(
        CRITIQUE_PROMPT, frame_bytes, mime=mime, model=model or DEFAULT_VISION_MODEL
    )
    return parse_critique(response.text)[:max_notes]
