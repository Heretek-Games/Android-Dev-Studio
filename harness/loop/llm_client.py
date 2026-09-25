"""
OpenAI-compatible LLM client for the autonomous iterate-until-green loop.

Reads credentials from the repository's `.env.prod` (`LLM_API`, `LLM_API_KEY`,
`LLM_API_MODEL`) with environment-variable overrides, and captures per-call
telemetry (prompt/completion tokens, latency, finish reason, retry attempts) so
the loop can record cost/latency per iteration.

The transport is injectable, which keeps the unit tests hermetic (no network).
"""

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_ENV_PATH = REPO_ROOT / ".env.prod"

#: Preferred model route for the vision critique (the endpoint exposes
#: `auto/best-vision`; `auto/vision` and `auto/multimodal` are also valid).
DEFAULT_VISION_MODEL = "auto/best-vision"

Transport = Callable[[str, Dict[str, str], bytes, float], Tuple[int, str]]


class LlmError(RuntimeError):
    """Raised when a chat completion cannot be obtained after retries."""

    def __init__(
        self, message: str, attempts: int = 0, last_status: Optional[int] = None
    ):
        super().__init__(message)
        self.attempts = attempts
        self.last_status = last_status


@dataclass
class LlmResponse:
    """One chat completion plus the telemetry the loop records."""

    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_seconds: float = 0.0
    finish_reason: str = ""
    attempts: int = 1
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def parse_env_file(path: Path) -> Dict[str, str]:
    """Parse a simple KEY=VALUE .env file (ignores blanks and comments)."""
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, _, value = trimmed.partition("=")
        values[key.strip()] = value.strip()
    return values


def _default_transport(
    url: str, headers: Dict[str, str], body: bytes, timeout: float
) -> Tuple[int, str]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8")
    except (
        urllib.error.HTTPError
    ) as error:  # pragma: no cover - exercised via injected transport
        return error.code, error.read().decode("utf-8", errors="replace")


class LlmClient:
    """Minimal OpenAI-compatible chat client with retry + telemetry."""

    def __init__(
        self,
        api: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        env_path: Optional[Path] = None,
        transport: Optional[Transport] = None,
        timeout: float = 180.0,
        max_retries: int = 2,
    ):
        env = parse_env_file(env_path or DEFAULT_ENV_PATH)
        self.api = (
            api or os.environ.get("LLM_API") or env.get("LLM_API") or ""
        ).rstrip("/")
        self.api_key = (
            api_key or os.environ.get("LLM_API_KEY") or env.get("LLM_API_KEY") or ""
        )
        self.model = (
            model or os.environ.get("LLM_API_MODEL") or env.get("LLM_API_MODEL") or ""
        )
        self.transport: Transport = transport or _default_transport
        self.timeout = timeout
        self.max_retries = max_retries
        if not self.api or not self.api_key:
            raise LlmError(
                "LLM_API / LLM_API_KEY not configured (.env.prod or environment)"
            )

    # ------------------------------------------------------------------ chat
    def chat(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: int = 4000,
        temperature: float = 0.4,
    ) -> LlmResponse:
        """Send a chat completion request and return the response + telemetry."""
        payload = {
            "model": model or self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        return self._post(payload)

    def chat_with_image(
        self,
        prompt: str,
        image_bytes: bytes,
        mime: str = "image/png",
        model: Optional[str] = None,
        max_tokens: int = 2000,
        temperature: float = 0.2,
    ) -> LlmResponse:
        """Send a text+image message (OpenAI vision content parts)."""
        data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ]
        return self.chat(
            messages,
            model=model or DEFAULT_VISION_MODEL,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    # ------------------------------------------------------------- internals
    def _post(self, payload: Dict[str, Any]) -> LlmResponse:
        url = f"{self.api}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = json.dumps(payload).encode("utf-8")

        attempts = 0
        last_status: Optional[int] = None
        last_error: str = ""
        started = time.monotonic()
        while attempts <= self.max_retries:
            attempts += 1
            try:
                status, text = self.transport(url, headers, body, self.timeout)
            except Exception as error:  # network-level failure -> retry
                last_error = f"{type(error).__name__}: {error}"
                if attempts > self.max_retries:
                    break
                time.sleep(0.5 * (2 ** (attempts - 1)))
                continue

            last_status = status
            if status == 200:
                latency = time.monotonic() - started
                return self._parse(text, payload.get("model", ""), latency, attempts)
            last_error = f"HTTP {status}: {text[:300]}"
            retryable = status >= 500 or status == 429
            if not retryable or attempts > self.max_retries:
                break
            time.sleep(0.5 * (2 ** (attempts - 1)))

        raise LlmError(
            f"chat completion failed after {attempts} attempt(s): {last_error}",
            attempts=attempts,
            last_status=last_status,
        )

    @staticmethod
    def _parse(text: str, model: str, latency: float, attempts: int) -> LlmResponse:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise LlmError(
                f"LLM returned invalid JSON: {error}: {text[:200]}", attempts=attempts
            ) from error

        choices = data.get("choices") or []
        if not choices:
            raise LlmError(
                f"LLM response has no choices: {text[:200]}", attempts=attempts
            )
        message = choices[0].get("message") or {}
        usage = data.get("usage") or {}
        return LlmResponse(
            text=message.get("content") or "",
            model=data.get("model") or model,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            latency_seconds=latency,
            finish_reason=str(choices[0].get("finish_reason") or ""),
            attempts=attempts,
            raw=data,
        )
