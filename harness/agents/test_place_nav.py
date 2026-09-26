"""Place-resolution tests through the real QA runner (engine Scene.places).

Drives harness/agents/qa_scenario_runner.mjs via subprocess: string nav
targets resolve through spec.places, and nav_arrived rules pass for
place-named destinations.

Run from the repository root:
    python3 -m unittest harness.agents.test_place_nav
"""

import json
import unittest


def run_nav(spec):
    from harness.agents.test_traversal_audit import run_scenario

    return run_scenario(spec, extra_args=("--frames", "600"))


def base_spec(**over):
    spec = {
        "name": "PlaceNav",
        "goal": "place resolution",
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
                "name": "Rover",
                "shape": "box",
                "size": [1, 1, 1],
                "position": [2, 0.5, 0],
                "color": "#fbbf24",
                "physics": "none",
                "nav": {"target": [16, 0], "speed": 6},
            },
        ],
        "rules": [
            {"id": "arrive", "type": "nav_arrived", "target": "Rover"},
        ],
    }
    spec.update(over)
    return spec


class PlaceNavTests(unittest.TestCase):
    def test_coordinate_target_still_arrives(self):
        proc = run_nav(base_spec())
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)

    def test_place_name_target_arrives(self):
        spec = base_spec()
        spec["places"] = [{"name": "far corner", "position": [16, 0.5, 0], "radius": 2}]
        spec["gameObjects"][1]["nav"] = {"target": "far corner", "speed": 6}
        proc = run_nav(spec)
        self.assertEqual(proc.returncode, 0, proc.stderr[:300])
        report = json.loads(proc.stdout)
        self.assertEqual(report.get("verdict"), "SUCCEEDED", report)

    def test_unknown_place_fails_loudly(self):
        spec = base_spec()
        spec["gameObjects"][1]["nav"] = {"target": "nowhere", "speed": 6}
        proc = run_nav(spec)
        combined = proc.stdout + proc.stderr
        self.assertIn("nowhere", combined)


if __name__ == "__main__":
    unittest.main()
