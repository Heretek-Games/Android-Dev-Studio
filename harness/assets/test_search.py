"""Unit tests for bounded asset search + prompt injection (Track D.4).

Run from the repository root:
    python3 -m unittest harness.assets.test_search
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.assets.importer import import_asset  # noqa: E402
from harness.assets.search import format_asset_notes, search_assets  # noqa: E402
from harness.loop.prompts import generation_messages  # noqa: E402


def seed_assets(assets_dir):
    specs = [
        ("Knight Hero", "CC0-1.0", b"glTF-KNIGHT" + b"\x00" * 64),
        ("Goblin Archer", "CC-BY-4.0", b"glTF-GOBLIN" + b"\x00" * 64),
        ("Stone Pillar", "UNSPECIFIED", b"glTF-PILLAR" + b"\x00" * 64),
    ]
    uids = {}
    for name, license, data in specs:
        sidecar = import_asset(
            data, name=name, preset="mobile", assets_dir=assets_dir, license=license
        )
        uids[name] = sidecar["uid"]
    return uids


class SearchTests(unittest.TestCase):
    def test_query_matches_names(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            uids = seed_assets(assets_dir)
            hits = search_assets(assets_dir=assets_dir, query="knight hero")
            self.assertEqual([h["uid"] for h in hits], [uids["Knight Hero"]])
            self.assertEqual(hits[0]["license"], "CC0-1.0")

    def test_empty_query_lists_all_capped(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            seed_assets(assets_dir)
            hits = search_assets(assets_dir=assets_dir, limit=2)
            self.assertEqual(len(hits), 2)

    def test_license_filter(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            seed_assets(assets_dir)
            hits = search_assets(assets_dir=assets_dir, licenses=["CC0-1.0"])
            self.assertEqual({h["name"] for h in hits}, {"Knight Hero"})

    def test_no_match_is_empty(self):
        with tempfile.TemporaryDirectory() as assets_dir:
            seed_assets(assets_dir)
            self.assertEqual(
                search_assets(assets_dir=assets_dir, query="dragon fortress"), []
            )

    def test_missing_dir_is_empty(self):
        self.assertEqual(
            search_assets(assets_dir="/nonexistent-dir", query="knight"), []
        )

    def test_note_format(self):
        notes = format_asset_notes(
            [{"uid": "abc", "name": "Knight", "license": "CC0-1.0"}]
        )
        self.assertEqual(notes, ["uid://abc — Knight (CC0-1.0)"])


class PromptInjectionTests(unittest.TestCase):
    def test_asset_notes_reach_generation_prompt(self):
        messages = generation_messages(
            "goal", [], None, asset_notes=["uid://abc — Knight (CC0-1.0)"]
        )
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertIn("STORE ASSETS", user)
        self.assertIn("uid://abc", user)
        self.assertIn("never invent uids", user)

    def test_no_notes_no_section(self):
        messages = generation_messages("goal", [], None)
        user = next(m["content"] for m in messages if m["role"] == "user")
        self.assertNotIn("STORE ASSETS", user)


class LoopWiringTests(unittest.TestCase):
    def test_loop_injects_manifest_assets(self):
        import tempfile

        from harness.loop.iterate_loop import IterateLoop
        from harness.loop.llm_client import LlmResponse

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            assets_dir = str(tmp_path / "assets")
            seed_assets(assets_dir)

            seen = []

            class FakeClient:
                def chat(self, messages, model=None, max_tokens=8000):
                    seen.extend(messages)
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
                    "rules": [{"id": "r1", "type": "object_count", "pass": True}],
                    "metrics": {},
                }

            loop = IterateLoop(
                "knight quest",
                [{"id": "r1", "type": "object_count"}],
                FakeClient(),
                qa_runner=fake_qa,
                max_iterations=1,
                runs_dir=tmp_path,
                work_scene_path=tmp_path / "work.json",
                assets_dir=assets_dir,
            )
            self.assertEqual(loop.run().verdict, "green")
        user = " ".join(m.get("content", "") for m in seen if m.get("role") == "user")
        self.assertIn("STORE ASSETS", user)
        self.assertIn("Knight Hero", user)

    def test_no_assets_dir_stays_silent(self):
        from harness.loop.iterate_loop import IterateLoop

        loop = IterateLoop.__new__(IterateLoop)
        loop.assets_dir = ""
        loop.goal = "quest"
        self.assertEqual(loop._asset_notes(), [])


class LoopAssetGreenTests(unittest.TestCase):
    """D.3/D.4 gate: apply a model spawn, then pass real QA rules on it."""

    def test_applied_asset_passes_real_qa(self):
        import os
        import subprocess
        import tempfile
        from unittest import mock

        from harness.loop.action_applier import apply_actions

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            assets_dir = str(tmp_path / "assets")
            uids = seed_assets(assets_dir)
            ref = f"uid://{uids['Knight Hero']}"
            with mock.patch.dict(os.environ, {"HERETEK_ASSETS_DIR": assets_dir}):
                scene, result = apply_actions(
                    {
                        "gameObjects": [
                            {
                                "name": "Ground",
                                "shape": "box",
                                "size": [24, 1, 24],
                                "position": [0, -0.5, 0],
                                "color": "#27272a",
                                "physics": "fixed",
                            }
                        ]
                    },
                    [
                        {
                            "type": "spawn",
                            "name": "Knight",
                            "size": [1, 2, 1],
                            "position": [3, 1, 0],
                            "color": "#8b5cf6",
                            "physics": "none",
                            "model": ref,
                        }
                    ],
                )
            self.assertEqual(result.applied, 1)
            spec = {
                "name": "AssetGreen",
                "goal": "asset green",
                "gameObjects": scene["gameObjects"],
                "rules": [
                    {"id": "ac", "type": "asset_count", "min": 1},
                    {"id": "al", "type": "asset_license", "allow": ["CC0-1.0", "MIT"]},
                ],
            }
            scenario = tmp_path / "scenario.json"
            scenario.write_text(json.dumps(spec), encoding="utf-8")
            repo_root = Path(__file__).resolve().parents[2]
            proc = subprocess.run(
                [
                    "node",
                    "harness/agents/qa_scenario_runner.mjs",
                    "--scenario",
                    str(scenario),
                    "--frames",
                    "60",
                ],
                capture_output=True,
                text=True,
                cwd=str(repo_root),
                timeout=300,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr[:300])
            report = json.loads(proc.stdout)
            self.assertEqual(report.get("verdict"), "SUCCEEDED", report)


if __name__ == "__main__":
    unittest.main()
