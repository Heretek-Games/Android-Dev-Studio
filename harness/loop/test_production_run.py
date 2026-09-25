"""Unit tests for the production-run orchestrator (fully hermetic fakes).

Run from the repository root:
    python3 -m unittest harness.loop.test_production_run
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.loop.production_run import ProductionRun  # noqa: E402
from harness.memory.project_memory import ProjectMemory  # noqa: E402
from harness.orchestrator.agent_swarm import AgentSwarmOrchestrator  # noqa: E402


def minimal_brief(**overrides):
    data = {
        "title": "Test Game",
        "fantasy": {"genre": "action-rpg", "loop": "explore and fight"},
        "experience": {"beats": ["first victory"], "inputs": ["touch"]},
        "world": {"areaKm2": 0.25, "biomes": ["meadow"], "streamingRadiusM": 120},
        "systems": {
            "components": ["HealthComponent"],
            "saveSchema": {"slot": "string"},
        },
        "lookdev": {"palette": ["green"], "lighting": "stylized"},
        "acceptance": [
            {
                "id": "player",
                "axis": "Functional",
                "description": "player exists",
                "qaRule": {"type": "entity_exists", "target": "Player"},
            },
            {
                "id": "budget",
                "axis": "Performant",
                "description": "within budget",
                "qaRule": {"type": "draw_call_budget", "max": 100},
            },
            {"id": "vibe", "axis": "Visually Coherent", "description": "sunset look"},
        ],
    }
    data.update(overrides)
    return data


class FakeLoopResult:
    def __init__(self, verdict, rules, total_tokens=100, error=None):
        self.verdict = verdict
        self.final_report = {"rules": rules}
        self.total_tokens = total_tokens
        self.error = error


class FakeLoop:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def run(self):
        self.calls.append(True)
        return self.result


def passing_rules():
    return [
        {"id": "player", "pass": True},
        {"id": "budget", "pass": True},
    ]


class ProductionRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ProjectMemory(db_path=str(Path(self.tmp.name) / "memory.sqlite"))
        self.swarm = AgentSwarmOrchestrator(memory=self.memory)
        self.brief_id = self.memory.record_brief(minimal_brief())

    def tearDown(self):
        self.tmp.cleanup()

    def make_run(self, loop_result):
        return ProductionRun(
            self.memory, self.swarm, lambda goal, rules: FakeLoop(loop_result)
        )

    def test_green_run_verifies_automatable_criteria(self):
        run = self.make_run(FakeLoopResult("green", passing_rules()))
        verdict = run.run(self.brief_id)
        self.assertEqual(verdict.verdict, "green")
        self.assertEqual(verdict.brief_title, "Test Game")
        states = {c["id"]: c["state"] for c in verdict.criteria}
        self.assertEqual(
            states,
            {"player": "verified", "budget": "verified", "vibe": "needs-critic-review"},
        )
        self.assertEqual(verdict.scope_reduction_candidates, ["vibe"])
        self.assertEqual(verdict.defect_report, [])

    def test_failed_rules_produce_defects_not_false_success(self):
        rules = [{"id": "player", "pass": False}, {"id": "budget", "pass": True}]
        run = self.make_run(FakeLoopResult("unresolved", rules))
        verdict = run.run(self.brief_id)
        self.assertEqual(verdict.verdict, "failed")
        self.assertTrue(any("player" in d for d in verdict.defect_report))
        states = {c["id"]: c["state"] for c in verdict.criteria}
        self.assertEqual(states["player"], "failed")

    def test_dag_task_states_reflect_the_outcome(self):
        run = self.make_run(FakeLoopResult("green", passing_rules()))
        run.run(self.brief_id)
        states = {t["title"]: t["state"] for t in self.memory.list_tasks()}
        self.assertTrue(all(s == "completed" for s in states.values()))
        self.assertEqual(len(states), 6)  # 3 criteria x (build + critique)

        run2 = self.make_run(FakeLoopResult("unresolved", []))
        # New plan on the same memory: fresh tasks start pending.
        verdict2 = run2.run(self.brief_id)
        self.assertEqual(verdict2.verdict, "failed")
        failed_states = [
            t["state"] for t in self.memory.list_tasks() if t["state"] == "failed"
        ]
        self.assertEqual(len(failed_states), 6)

    def test_loop_factory_receives_compiled_rules(self):
        seen = {}

        def factory(goal, rules):
            seen["goal"] = goal
            seen["rules"] = rules
            return FakeLoop(FakeLoopResult("green", passing_rules()))

        ProductionRun(self.memory, self.swarm, factory).run(self.brief_id)
        self.assertEqual(seen["goal"], "Test Game")
        self.assertEqual(len(seen["rules"]), 2)
        self.assertEqual({r["id"] for r in seen["rules"]}, {"player", "budget"})

    def test_loop_exception_is_an_error_not_a_verdict(self):
        def boom(goal, rules):
            raise RuntimeError("no LLM today")

        run = ProductionRun(self.memory, self.swarm, boom)
        verdict = run.run(self.brief_id)
        self.assertEqual(verdict.verdict, "error")
        self.assertIn("no LLM today", verdict.error or "")

    def test_unknown_brief_is_an_error(self):
        run = self.make_run(FakeLoopResult("green", passing_rules()))
        verdict = run.run("brief_nope")
        self.assertEqual(verdict.verdict, "error")


if __name__ == "__main__":
    unittest.main()
