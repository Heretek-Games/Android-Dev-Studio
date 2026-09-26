"""Quest-chain gate through the real QA runner (Track E.4 gate).

Branching keeper dialogue (Hydro blessing) -> dungeon waves -> Cinder
Tyrant boss with live telegraphs -> engine.Quest completes all 5 stages.
Negative control (blessing refused path forced by reordering choices) must
stall the chain at the blessing stage — proving stage progression follows
dialogue, not wall-clock.

Run from the repository root:
    python3 -m unittest harness.agents.test_quest_chain
"""

import copy
import json
import unittest

from harness.agents.test_traversal_audit import run_scenario

SCENARIO = "harness/config/scenarios/quest_chain.json"


def load_spec():
    with open(SCENARIO, encoding="utf-8") as fh:
        return json.load(fh)


class QuestChainTests(unittest.TestCase):
    def test_quest_chain_runs_green(self):
        proc = run_scenario(load_spec(), extra_args=("--frames", "600"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        self.assertTrue(by_id["quest_done"]["pass"], by_id["quest_done"])
        self.assertTrue(
            by_id["boss_telegraphs_live"]["pass"], by_id["boss_telegraphs_live"]
        )

    def test_refused_blessing_stalls_the_chain(self):
        spec = copy.deepcopy(load_spec())
        greet = spec["dialogues"]["DungeonKeeper"]["nodes"]["greet"]
        greet["choices"] = list(reversed(greet["choices"]))
        proc = run_scenario(spec, extra_args=("--frames", "600"))
        report = json.loads(proc.stdout)
        by_id = {r["id"]: r for r in report.get("rules", [])}
        # The runner takes the first choice: refusal emits no blessing event.
        self.assertFalse(by_id["blessing_fired"]["pass"], by_id["blessing_fired"])
        self.assertFalse(by_id["quest_done"]["pass"], by_id["quest_done"])

    def test_empty_quest_fails_stage_rule_explicitly(self):
        spec = copy.deepcopy(load_spec())
        spec.pop("quest", None)
        proc = run_scenario(spec, extra_args=("--frames", "120"))
        report = json.loads(proc.stdout)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["id"] == "quest_stages" for r in failed), report)


if __name__ == "__main__":
    unittest.main()
