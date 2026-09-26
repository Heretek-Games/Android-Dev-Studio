"""Unit tests for VLM calibration logging (hermetic).

Run from the repository root:
    python3 -m unittest harness.loop.test_calibration
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.calibration import (  # noqa: E402
    compare_rubric,
    extract_proxy_scores,
    extract_vlm_scores,
    promotion_readiness,
)
from harness.loop.iterate_loop import IterateLoop  # noqa: E402
from harness.loop.llm_client import LlmResponse  # noqa: E402
from harness.loop.vision import VisionResult  # noqa: E402
from harness.memory.project_memory import ProjectMemory  # noqa: E402


class CompareTests(unittest.TestCase):
    def test_full_agreement(self):
        result = compare_rubric(
            {"composition": 4, "readability": 3},
            {"composition": 4, "readability": 3},
        )
        self.assertEqual(result["compared"], 2)
        self.assertEqual(result["agreed"], 2)
        self.assertEqual(result["agreementRate"], 1.0)
        self.assertEqual(result["meanAbsDelta"], 0.0)

    def test_one_step_wobble_agrees(self):
        result = compare_rubric({"composition": 4}, {"composition": 3})
        self.assertTrue(result["axes"]["composition"]["agree"])
        self.assertEqual(result["axes"]["composition"]["delta"], -1)

    def test_two_step_disagrees(self):
        result = compare_rubric({"composition": 5}, {"composition": 2})
        self.assertFalse(result["axes"]["composition"]["agree"])

    def test_partial_axis_overlap(self):
        result = compare_rubric(
            {"composition": 4, "readability": 3}, {"composition": 4}
        )
        self.assertEqual(result["compared"], 1)

    def test_garbage_scores_skipped(self):
        result = compare_rubric({"composition": "high"}, {"composition": 4})
        self.assertEqual(result["compared"], 0)
        self.assertEqual(result["agreementRate"], 0.0)

    def test_empty_is_zero(self):
        self.assertEqual(compare_rubric({}, {})["compared"], 0)


class PromotionTests(unittest.TestCase):
    def test_ready_axis(self):
        ready = promotion_readiness(
            {"perAxis": {"composition": {"samples": 25, "agreementRate": 0.88}}}
        )
        self.assertTrue(ready["composition"]["ready"])
        self.assertEqual(ready["composition"]["needed"], 0)

    def test_not_ready_without_samples(self):
        ready = promotion_readiness(
            {"perAxis": {"composition": {"samples": 5, "agreementRate": 1.0}}}
        )
        self.assertFalse(ready["composition"]["ready"])
        self.assertEqual(ready["composition"]["needed"], 15)

    def test_not_ready_without_agreement(self):
        ready = promotion_readiness(
            {"perAxis": {"readability": {"samples": 40, "agreementRate": 0.5}}}
        )
        self.assertFalse(ready["readability"]["ready"])


class MemoryTests(unittest.TestCase):
    def test_record_and_summarize(self):
        memory = ProjectMemory(db_path=":memory:")
        self.assertEqual(memory.calibration_summary(), {"perAxis": {}, "samples": 0})
        written = memory.record_calibration(
            "run-iter1",
            compare_rubric(
                {"composition": 4, "readability": 3},
                {"composition": 5, "readability": 1},
            ),
        )
        self.assertEqual(written, 2)
        summary = memory.calibration_summary()
        self.assertEqual(summary["samples"], 2)
        self.assertEqual(summary["perAxis"]["composition"]["agreementRate"], 1.0)
        self.assertEqual(summary["perAxis"]["readability"]["agreementRate"], 0.0)

    def test_malformed_rows_ignored(self):
        memory = ProjectMemory(db_path=":memory:")
        self.assertEqual(memory.record_calibration("x", {}), 0)
        self.assertEqual(memory.record_calibration("x", {"axes": {"a": "junk"}}), 0)


class ExtractTests(unittest.TestCase):
    def test_extractors(self):
        record = {
            "visual": [{"scores": {"composition": 4}}],
            "vision": {"rubricScores": {"composition": 5, "junk": "x"}},
        }
        self.assertEqual(extract_proxy_scores(record), {"composition": 4})
        self.assertEqual(extract_vlm_scores(record), {"composition": 5})

    def test_missing_layers_are_none(self):
        self.assertIsNone(extract_proxy_scores({}))
        self.assertIsNone(extract_vlm_scores({"vision": {}}))
        self.assertIsNone(extract_vlm_scores({"vision": {"rubricScores": {}}}))


class LoopCalibrationTests(unittest.TestCase):
    def test_sweep_logs_samples(self):
        memory = ProjectMemory(db_path=":memory:")
        calls = {"n": 0}

        class FakeClient:
            def chat(self, messages, model=None, max_tokens=8000):
                return LlmResponse(
                    text=json.dumps({"summary": "t", "actions": []}),
                    model="fake",
                    prompt_tokens=1,
                    completion_tokens=1,
                )

        def fake_qa(path, frames, out):
            calls["n"] += 1
            if calls["n"] == 1:
                return {
                    "verdict": "FAILED",
                    "passed": 0,
                    "total": 1,
                    "rules": [
                        {
                            "id": "r1",
                            "type": "object_count",
                            "pass": False,
                            "detail": "empty",
                        }
                    ],
                    "metrics": {},
                }
            return {
                "verdict": "SUCCEEDED",
                "passed": 1,
                "total": 1,
                "rules": [{"id": "r1", "type": "object_count", "pass": True}],
                "metrics": {},
            }

        def fake_vision(scene, failed_rules):
            return VisionResult(
                notes=["[composition 4/5] fine"],
                rubric_scores={"composition": 4, "readability": 3},
                rubric_defects=[],
                model="fake",
            )

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "calibration test",
                [{"id": "v", "type": "visual_quality_min", "minScore": 1}],
                FakeClient(),
                qa_runner=fake_qa,
                max_iterations=2,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
                vision_critique=fake_vision,
                taste_store=memory,
            )
            result = loop.run()
        # Repair phase (iteration 2) carries vision + visual → one sample set.
        summary = memory.calibration_summary()
        self.assertGreaterEqual(summary["samples"], 2)
        self.assertIn("composition", summary["perAxis"])
        cal_records = [r for r in result.iterations if "calibration" in r]
        self.assertTrue(cal_records)

    def test_store_without_calibration_support_is_safe(self):
        class FakeClient:
            def chat(self, messages, model=None, max_tokens=8000):
                return LlmResponse(
                    text=json.dumps({"summary": "t", "actions": []}),
                    model="fake",
                    prompt_tokens=1,
                    completion_tokens=1,
                )

        def fake_qa(path, frames, out):
            return {
                "verdict": "SUCCEEDED",
                "passed": 1,
                "total": 1,
                "rules": [],
                "metrics": {},
            }

        class BareStore:
            def query_taste(self, genre, limit=3):
                return []

            def record_taste(self, entry):
                return 1

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            loop = IterateLoop(
                "bare store",
                [],
                FakeClient(),
                qa_runner=fake_qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
                taste_store=BareStore(),
            )
            self.assertEqual(loop.run().verdict, "green")


if __name__ == "__main__":
    unittest.main()
