"""Unit tests for the loop LLM client (hermetic: injected transport, no network).

Run from the repository root:
    python3 -m unittest harness.loop.test_llm_client
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.llm_client import (  # noqa: E402
    LlmClient,
    LlmError,
    LlmResponse,
    parse_env_file,
)

OK_BODY = json.dumps(
    {
        "model": "test-model",
        "choices": [
            {"message": {"content": '{"summary": "ok"}'}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 120, "completion_tokens": 45},
    }
)


class FakeTransport:
    """Records calls and replays a scripted list of (status, body) responses."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, url, headers, body, timeout):
        self.calls.append(
            {
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode()),
                "timeout": timeout,
            }
        )
        if not self.script:
            raise AssertionError("transport called more times than scripted")
        return self.script.pop(0)


def make_client(script, **kwargs):
    transport = FakeTransport(script)
    client = LlmClient(
        api="https://example.test/v1",
        api_key="sk-test",
        model="test-model",
        transport=transport,
        max_retries=kwargs.pop("max_retries", 2),
        **kwargs,
    )
    return client, transport


class ChatTests(unittest.TestCase):
    def test_parses_response_and_telemetry(self):
        client, transport = make_client([(200, OK_BODY)])
        response = client.chat(
            [{"role": "user", "content": "hi"}], max_tokens=123, temperature=0.1
        )

        self.assertIsInstance(response, LlmResponse)
        self.assertEqual(response.text, '{"summary": "ok"}')
        self.assertEqual(response.prompt_tokens, 120)
        self.assertEqual(response.completion_tokens, 45)
        self.assertEqual(response.total_tokens, 165)
        self.assertEqual(response.finish_reason, "stop")
        self.assertEqual(response.attempts, 1)
        self.assertGreaterEqual(response.latency_seconds, 0.0)

        call = transport.calls[0]
        self.assertEqual(call["url"], "https://example.test/v1/chat/completions")
        self.assertEqual(call["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(call["body"]["max_tokens"], 123)
        self.assertEqual(call["body"]["temperature"], 0.1)
        self.assertFalse(call["body"]["stream"])

    def test_retries_on_500_then_succeeds(self):
        client, transport = make_client([(500, "boom"), (200, OK_BODY)])
        response = client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(response.attempts, 2)
        self.assertEqual(len(transport.calls), 2)

    def test_no_retry_on_400(self):
        client, transport = make_client([(400, "bad request")])
        with self.assertRaises(LlmError) as ctx:
            client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(ctx.exception.attempts, 1)
        self.assertEqual(ctx.exception.last_status, 400)
        self.assertEqual(len(transport.calls), 1)

    def test_raises_after_persistent_failure(self):
        client, transport = make_client(
            [(503, "a"), (503, "b"), (503, "c")], max_retries=2
        )
        with self.assertRaises(LlmError) as ctx:
            client.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(ctx.exception.attempts, 3)
        self.assertEqual(len(transport.calls), 3)

    def test_invalid_json_body_raises(self):
        client, _ = make_client([(200, "not json")])
        with self.assertRaises(LlmError):
            client.chat([{"role": "user", "content": "hi"}])

    def test_missing_choices_raises(self):
        client, _ = make_client([(200, json.dumps({"choices": []}))])
        with self.assertRaises(LlmError):
            client.chat([{"role": "user", "content": "hi"}])


class VisionTests(unittest.TestCase):
    def test_chat_with_image_builds_data_url(self):
        client, transport = make_client([(200, OK_BODY)])
        response = client.chat_with_image(
            "describe", b"\x89PNG-bytes", mime="image/png"
        )
        self.assertEqual(response.text, '{"summary": "ok"}')

        call = transport.calls[0]
        self.assertEqual(call["body"]["model"], "auto/best-vision")
        content = call["body"]["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(content[1]["type"], "image_url")
        self.assertTrue(
            content[1]["image_url"]["url"].startswith("data:image/png;base64,")
        )


class EnvTests(unittest.TestCase):
    def test_parse_env_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.prod"
            path.write_text(
                "# comment\nLLM_API=https://example.test/v1\nLLM_API_KEY=sk-abc\n\nLLM_API_MODEL=test-model\n",
                encoding="utf-8",
            )
            values = parse_env_file(path)
        self.assertEqual(values["LLM_API"], "https://example.test/v1")
        self.assertEqual(values["LLM_API_KEY"], "sk-abc")
        self.assertEqual(values["LLM_API_MODEL"], "test-model")

    def test_explicit_args_override_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.prod"
            path.write_text(
                "LLM_API=https://file.test/v1\nLLM_API_KEY=sk-file\nLLM_API_MODEL=file-model\n"
            )
            client = LlmClient(
                api="https://arg.test/v1",
                api_key="sk-arg",
                model="arg-model",
                env_path=path,
                transport=FakeTransport([]),
            )
        self.assertEqual(client.api, "https://arg.test/v1")
        self.assertEqual(client.api_key, "sk-arg")
        self.assertEqual(client.model, "arg-model")

    def test_missing_credentials_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "missing.env"
            with self.assertRaises(LlmError):
                LlmClient(
                    api=None, api_key=None, env_path=path, transport=FakeTransport([])
                )


if __name__ == "__main__":
    unittest.main()
