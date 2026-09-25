"""Unit tests for brief-driven production DAG planning in the swarm orchestrator.

Uses an isolated temp SQLite file per test — never touches the real
project_memory.sqlite. No network, no engine build.

Run from the repository root:
    python3 -m unittest harness.orchestrator.test_agent_swarm
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from harness.memory.project_memory import ProjectMemory  # noqa: E402
from harness.orchestrator.agent_swarm import (  # noqa: E402
    AXIS_POD_ASSIGNMENT,
    AgentSwarmOrchestrator,
    SubagentRole,
)


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
            {"id": "player", "axis": "Functional", "description": "player exists"},
            {"id": "sunset", "axis": "Visually Coherent", "description": "sunset look"},
        ],
    }
    data.update(overrides)
    return data


class PlanFromBriefTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ProjectMemory(db_path=str(Path(self.tmp.name) / "memory.sqlite"))
        self.swarm = AgentSwarmOrchestrator(memory=self.memory)
        self.brief_id = self.memory.record_brief(minimal_brief())

    def tearDown(self):
        self.tmp.cleanup()

    def test_each_criterion_gets_builder_plus_critic(self):
        plan = self.swarm.plan_from_brief(self.brief_id)
        self.assertEqual(plan["brief_id"], self.brief_id)
        self.assertEqual(plan["title"], "Test Game")
        self.assertEqual(len(plan["tasks"]), 4)  # 2 criteria x (build + critique)
        by_criterion = {}
        for task in plan["tasks"]:
            by_criterion.setdefault(task["criterionId"], []).append(task["role"])
        self.assertEqual(
            by_criterion["player"], [SubagentRole.SYSTEMS_ENGINEER, SubagentRole.QA]
        )
        self.assertEqual(
            by_criterion["sunset"],
            [SubagentRole.TECH_ARTIST, SubagentRole.VISUAL_CRITIC],
        )

    def test_critic_task_depends_on_its_builder_task(self):
        plan = self.swarm.plan_from_brief(self.brief_id)
        build_ids = {
            t["id"] for t in plan["tasks"] if "Critique" not in self._title(t["id"])
        }
        for task_id in build_ids:
            stored = next(
                t for t in self.memory.list_tasks() if t["task_id"] == task_id
            )
            self.assertEqual(stored["dependencies"], [])
        critic_tasks = [t for t in self.memory.list_tasks() if t["dependencies"]]
        self.assertEqual(len(critic_tasks), 2)
        for critic in critic_tasks:
            self.assertEqual(len(critic["dependencies"]), 1)
            self.assertIn(critic["dependencies"][0], build_ids)

    def _title(self, task_id):
        stored = next(t for t in self.memory.list_tasks() if t["task_id"] == task_id)
        return stored["title"]

    def test_builders_never_grade_their_own_work(self):
        for axis, (builder, critic) in AXIS_POD_ASSIGNMENT.items():
            self.assertNotEqual(builder, critic, f"axis {axis}")

    def test_unknown_brief_raises(self):
        with self.assertRaises(ValueError):
            self.swarm.plan_from_brief("brief_nope")


class ReadyTaskSchedulingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.memory = ProjectMemory(db_path=str(Path(self.tmp.name) / "memory.sqlite"))
        self.swarm = AgentSwarmOrchestrator(memory=self.memory)
        self.brief_id = self.memory.record_brief(minimal_brief())

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_dependency_free_tasks_are_ready_first(self):
        self.swarm.plan_from_brief(self.brief_id)
        ready = self.swarm.get_ready_tasks()
        self.assertEqual(len(ready), 2)  # the two builder tasks
        self.assertTrue(all(t["dependencies"] == [] for t in ready))

    def test_completing_a_builder_unblocks_its_critic(self):
        self.swarm.plan_from_brief(self.brief_id)
        ready = self.swarm.get_ready_tasks()
        first_builder = ready[0]
        self.memory.update_task_state(
            first_builder["task_id"], "completed", {"ok": True}
        )
        ready = self.swarm.get_ready_tasks()
        ready_ids = {t["task_id"] for t in ready}
        # The other builder (still pending, no deps) plus the unblocked critic.
        self.assertEqual(len(ready), 2)
        critic_tasks = [t for t in ready if t["dependencies"]]
        self.assertEqual(len(critic_tasks), 1)
        self.assertEqual(critic_tasks[0]["dependencies"], [first_builder["task_id"]])

    def test_failed_builder_does_not_unblock_its_critic(self):
        self.swarm.plan_from_brief(self.brief_id)
        ready = self.swarm.get_ready_tasks()
        self.memory.update_task_state(ready[0]["task_id"], "failed", {"error": "boom"})
        ready = self.swarm.get_ready_tasks()
        # One builder pending + the other builder's critic still blocked = 1 ready.
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0]["dependencies"], [])


if __name__ == "__main__":
    unittest.main()
