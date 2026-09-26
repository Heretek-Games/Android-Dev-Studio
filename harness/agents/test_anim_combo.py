"""AnimFSM combo-chain tests through the real QA runner (Track E.1 gate).

A hero with an Idle/Attack1/Attack2 combo FSM is driven by scripted input
buttons routed to AnimFSM triggers (spec.animTriggers): attack at frame 5,
combo at frame 25 (inside the cancel window) must chain Attack1 -> Attack2
and resolve to Idle — 3 transitions, green.

Run from the repository root:
    python3 -m unittest harness.agents.test_anim_combo
"""

import json
import unittest

from harness.agents.test_traversal_audit import run_scenario


def combo_spec():
    return {
        "name": "ComboChain",
        "goal": "combo chain",
        "gameObjects": [
            {
                "name": "Ground",
                "shape": "box",
                "size": [30, 1, 30],
                "position": [0, -0.5, 0],
                "color": "#27272a",
                "physics": "fixed",
            },
            {
                "name": "Hero",
                "shape": "capsule",
                "size": [1, 1.5, 1],
                "position": [0, 1.5, 0],
                "color": "#3b82f6",
                "physics": "none",
                "anim": {
                    "states": {
                        "Idle": {"clip": "idle", "clipLength": 2.0},
                        "Attack1": {"clip": "attack1", "clipLength": 0.5},
                        "Attack2": {"clip": "attack2", "clipLength": 0.5},
                    },
                    "initial": "Idle",
                    "transitions": [
                        {
                            "from": "Idle",
                            "to": "Attack1",
                            "conditions": [{"param": "attack", "op": "trigger"}],
                        },
                        {
                            "from": "Attack1",
                            "to": "Attack2",
                            "exitTime": 0.4,
                            "conditions": [{"param": "combo", "op": "trigger"}],
                        },
                        {
                            "from": "Attack1",
                            "to": "Idle",
                            "exitTime": 1.0,
                            "conditions": [],
                        },
                        {
                            "from": "Attack2",
                            "to": "Idle",
                            "exitTime": 1.0,
                            "conditions": [],
                        },
                    ],
                },
            },
        ],
        "inputmap": {
            "actions": {
                "attack": {
                    "type": "button",
                    "bindings": [{"source": "key", "code": "J"}],
                },
                "combo": {
                    "type": "button",
                    "bindings": [{"source": "key", "code": "K"}],
                },
            }
        },
        "inputScript": [
            {"action": "attack", "value": True, "start": 5, "frames": 1},
            {"action": "combo", "value": True, "start": 25, "frames": 1},
        ],
        "animTriggers": [
            {"target": "Hero", "action": "attack", "trigger": "attack"},
            {"target": "Hero", "action": "combo", "trigger": "combo"},
        ],
        "rules": [
            {"id": "combo", "type": "anim_transitions_min", "target": "Hero", "min": 3},
            {
                "id": "settle",
                "type": "anim_state_is",
                "target": "Hero",
                "state": "Idle",
            },
        ],
    }


class AnimComboTests(unittest.TestCase):
    def test_combo_chain_runs_green(self):
        proc = run_scenario(combo_spec(), extra_args=("--frames", "120"))
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)

    def test_without_combo_input_chain_breaks(self):
        spec = combo_spec()
        spec["inputScript"] = [
            {"action": "attack", "value": True, "start": 5, "frames": 1}
        ]
        proc = run_scenario(spec, extra_args=("--frames", "120"))
        report = json.loads(proc.stdout)
        failed = [r for r in report.get("rules", []) if not r.get("pass")]
        self.assertTrue(any(r["type"] == "anim_transitions_min" for r in failed))


if __name__ == "__main__":
    unittest.main()
