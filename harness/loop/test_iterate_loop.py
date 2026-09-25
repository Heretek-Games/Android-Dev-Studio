"""Unit tests for the iterate-until-green orchestrator (fake LLM + fake QA).

Run from the repository root:
    python3 -m unittest harness.loop.test_iterate_loop
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.iterate_loop import IterateLoop, parse_actions  # noqa: E402
from harness.loop.llm_client import LlmError, LlmResponse  # noqa: E402

RULES = [
    {"id": "player_exists", "type": "entity_exists", "target": "Player Hero"},
    {"id": "budget", "type": "draw_call_budget", "maxDrawCalls": 100},
]


def llm_response(payload, tokens=100):
    return LlmResponse(
        text=json.dumps(payload) if not isinstance(payload, str) else payload,
        model="fake-model",
        prompt_tokens=tokens,
        completion_tokens=tokens // 2,
        latency_seconds=0.01,
        finish_reason="stop",
    )


def qa_report(passed: bool, failed_detail: str = "not found"):
    return {
        "verdict": "SUCCEEDED" if passed else "FAILED",
        "passed": 2 if passed else 1,
        "total": 2,
        "rules": [
            {
                "id": "player_exists",
                "type": "entity_exists",
                "pass": passed,
                "detail": failed_detail if not passed else 'found "Player Hero"',
            },
            {
                "id": "budget",
                "type": "draw_call_budget",
                "pass": True,
                "detail": "3/100",
            },
        ],
        "metrics": {"avgFrameTimeMs": 0.3, "drawCallEstimate": 3, "objectCount": 2},
    }


class FakeClient:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def chat(self, messages, model=None, max_tokens=4000, temperature=0.4):
        self.calls.append(messages)
        if not self.script:
            raise AssertionError("client called more times than scripted")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeQaRunner:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __call__(self, scenario_path, frames, out_path):
        self.calls.append({"scenario": str(scenario_path), "frames": frames})
        if not self.script:
            raise AssertionError("qa runner called more times than scripted")
        return self.script.pop(0)


class LoopTests(unittest.TestCase):
    def _loop(self, tmp, client, qa, **kwargs):
        return IterateLoop(
            "Build a mini arena",
            RULES,
            client,
            qa_runner=qa,
            work_scene_path=Path(tmp) / "work_scene.json",
            runs_dir=Path(tmp) / "runs",
            **kwargs,
        )

    def test_converges_in_two_iterations(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [
                    llm_response(
                        {
                            "summary": "arena base",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Ground",
                                    "shape": "plane",
                                    "size": [20, 1, 20],
                                    "position": [0, -0.5, 0],
                                    "physics": "fixed",
                                }
                            ],
                        },
                        tokens=100,
                    ),
                    llm_response(
                        {
                            "summary": "add player",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Player Hero",
                                    "shape": "capsule",
                                    "position": [0, 1.5, 0],
                                    "physics": "dynamic",
                                }
                            ],
                        },
                        tokens=200,
                    ),
                ]
            )
            qa = FakeQaRunner([qa_report(False), qa_report(True)])
            loop = self._loop(tmp, client, qa, max_iterations=4)
            result = loop.run()

        self.assertEqual(result.verdict, "green")
        self.assertEqual(len(result.iterations), 2)
        self.assertEqual(result.iterations[0]["phase"], "generate")
        self.assertEqual(result.iterations[1]["phase"], "repair")
        self.assertEqual(result.iterations[0]["qa"]["verdict"], "FAILED")
        self.assertEqual(result.iterations[1]["qa"]["verdict"], "SUCCEEDED")
        self.assertEqual(result.total_tokens, 450)  # 150 + 300
        self.assertEqual(len(qa.calls), 2)
        # The repair prompt must contain the failing rule detail.
        repair_user = client.calls[1][1]["content"]
        self.assertIn("player_exists", repair_user)
        self.assertIn("not found", repair_user)

    def test_budget_exhaustion_is_unresolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [llm_response({"summary": "x", "actions": []}, tokens=50)] * 3
            )
            qa = FakeQaRunner([qa_report(False)] * 3)
            loop = self._loop(tmp, client, qa, max_iterations=2)
            result = loop.run()

        self.assertEqual(result.verdict, "unresolved")
        self.assertEqual(len(result.iterations), 2)

    def test_gate_violation_skips_qa_and_feeds_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [
                    llm_response(
                        {
                            "summary": "bad",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Ground",
                                    "shape": "box",
                                    "size": [20, 1, 20],
                                    "position": [0, -0.5, 0],
                                    "physics": "fixed",
                                },
                                # Buried dynamic collider: the applier accepts it, the gate's
                                # non-penetration invariant rejects it.
                                {
                                    "type": "spawn",
                                    "name": "Buried",
                                    "shape": "box",
                                    "size": [1, 1, 1],
                                    "position": [0, -0.5, 0],
                                    "physics": "dynamic",
                                },
                            ],
                        }
                    ),
                    llm_response(
                        {
                            "summary": "fixed",
                            "actions": [
                                {"type": "delete", "target": "Buried"},
                                {
                                    "type": "spawn",
                                    "name": "Player Hero",
                                    "position": [0, 1.5, 0],
                                    "physics": "dynamic",
                                },
                            ],
                        }
                    ),
                ]
            )
            qa = FakeQaRunner([qa_report(True)])
            loop = self._loop(tmp, client, qa, max_iterations=3)
            result = loop.run()

        self.assertEqual(result.verdict, "green")
        self.assertEqual(
            len(qa.calls), 1, "QA must be skipped while the gate is violated"
        )
        self.assertEqual(result.iterations[0]["gate"]["valid"], False)
        self.assertEqual(result.iterations[0]["qa"]["verdict"], "skipped")
        # The repair prompt must contain the invariant violation.
        repair_user = client.calls[1][1]["content"]
        self.assertIn("COLLIDER_PENETRATION_AT_SPAWN", repair_user)

    def test_llm_error_sets_error_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient([LlmError("upstream down", attempts=3)])
            qa = FakeQaRunner([])
            loop = self._loop(tmp, client, qa)
            result = loop.run()

        self.assertEqual(result.verdict, "error")
        self.assertIn("upstream down", result.error or "")
        self.assertEqual(len(qa.calls), 0)

    def test_token_budget_stops_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [llm_response({"summary": "x", "actions": []}, tokens=500)] * 2
            )
            qa = FakeQaRunner([qa_report(False)])
            loop = self._loop(tmp, client, qa, max_iterations=5, max_total_tokens=100)
            result = loop.run()

        self.assertEqual(result.verdict, "unresolved")
        self.assertEqual(len(result.iterations), 1)
        self.assertIn("token budget", result.error or "")

    def test_run_log_and_markdown_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [
                    llm_response(
                        {
                            "summary": "ok",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Player Hero",
                                    "position": [0, 1.5, 0],
                                    "physics": "dynamic",
                                }
                            ],
                        }
                    )
                ]
            )
            qa = FakeQaRunner([qa_report(True)])
            loop = self._loop(tmp, client, qa)
            result = loop.run()

            log = json.loads(Path(result.run_log_path).read_text())
            md_exists = Path(result.markdown_path).exists()
            work_scene = json.loads(loop.work_scene_path.read_text())

        self.assertEqual(log["verdict"], "green")
        self.assertEqual(len(log["iterations"]), 1)
        self.assertTrue(md_exists)
        self.assertEqual(work_scene["rules"], RULES)
        self.assertEqual(work_scene["gameObjects"][0]["name"], "Player Hero")

    def test_vision_notes_reach_repair_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [
                    llm_response({"summary": "x", "actions": []}),
                    llm_response(
                        {
                            "summary": "ok",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Player Hero",
                                    "position": [0, 1.5, 0],
                                    "physics": "dynamic",
                                }
                            ],
                        }
                    ),
                ]
            )
            qa = FakeQaRunner([qa_report(False), qa_report(True)])
            loop = self._loop(
                tmp,
                client,
                qa,
                vision_critique=lambda scene, failed_rules: [
                    "player is missing from the layout"
                ],
            )
            result = loop.run()

        self.assertEqual(result.verdict, "green")
        self.assertIn(
            "player is missing from the layout", client.calls[1][1]["content"]
        )
        self.assertEqual(
            result.iterations[1]["visionNotes"], ["player is missing from the layout"]
        )

    def test_vision_result_telemetry_counts_toward_totals(self):
        from harness.loop.vision import VisionResult

        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(
                [
                    llm_response({"summary": "x", "actions": []}),
                    llm_response(
                        {
                            "summary": "ok",
                            "actions": [
                                {
                                    "type": "spawn",
                                    "name": "Player Hero",
                                    "position": [0, 1.5, 0],
                                    "physics": "dynamic",
                                }
                            ],
                        }
                    ),
                ]
            )
            qa = FakeQaRunner([qa_report(False), qa_report(True)])
            loop = self._loop(
                tmp,
                client,
                qa,
                vision_critique=lambda scene, failed_rules: VisionResult(
                    notes=["Issue: ground is missing"],
                    model="auto/best-vision",
                    prompt_tokens=900,
                    completion_tokens=100,
                    latency_seconds=2.5,
                ),
            )
            result = loop.run()

        # 150 + 150 LLM tokens + 1000 vision tokens
        self.assertEqual(result.total_tokens, 1300)
        vision = result.iterations[1]["vision"]
        self.assertEqual(vision["totalTokens"], 1000)
        self.assertEqual(vision["model"], "auto/best-vision")
        self.assertEqual(
            result.iterations[1]["visionNotes"], ["Issue: ground is missing"]
        )


class ParseTests(unittest.TestCase):
    def test_codeblock(self):
        summary, actions, strategy, error = parse_actions(
            '```json\n{"summary":"s","actions":[{"type":"spawn"}]}\n```'
        )
        self.assertEqual(strategy, "codeblock")
        self.assertEqual(len(actions), 1)
        self.assertIsNone(error)

    def test_raw(self):
        summary, actions, strategy, _ = parse_actions('{"summary":"s","actions":[]}')
        self.assertEqual(strategy, "raw")
        self.assertEqual(actions, [])

    def test_salvaged_from_truncated(self):
        truncated = '{"summary":"s","actions":[{"type":"spawn","name":"A"},{"type":"spawn","name":"B"'
        summary, actions, strategy, error = parse_actions(truncated)
        self.assertEqual(strategy, "salvaged")
        self.assertEqual(len(actions), 1)
        self.assertIn("salvaged", error or "")

    def test_failed(self):
        summary, actions, strategy, error = parse_actions("no json here at all")
        self.assertEqual(strategy, "failed")
        self.assertEqual(actions, [])
        self.assertIsNotNone(error)


if __name__ == "__main__":
    unittest.main()
