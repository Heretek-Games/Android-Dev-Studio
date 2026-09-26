"""Scene-parity invariant (Phase 1.1): HarnessSceneAdapter === qa_scenario_runner.

Builds the SAME spec through both paths and asserts the SAME static scene
graph (object names, per-object sorted component type lists, counts):

  - studio adapter:  app/src/services/HarnessSceneAdapter.buildEngineScene
    via app/src/services/dumpAdapterGraph.ts
  - headless QA:     harness/agents/qa_scenario_runner.mjs :: buildScene
    via app/src/services/dumpRunnerGraph.mjs (loads the runner source as
    text and imports buildScene through a data: URL, since the runner
    executes main() on import and cannot be imported directly)

The test compares the STATIC scene graph both builders produce, not runtime
state.

Documented semantic gaps (verified by manual gap probes, NOT silently
ignored):

  Runner-only static systems (the adapter does not build them; parity specs
  must not use them — enforced by test_parity_specs_use_shared_vocabulary):
    kind "camera" -> CameraComponent (adapter falls back to MeshRenderer),
    modelUrl -> ModelRenderer (+ license expando), cel -> AnimeCelShader,
    behaviors[] -> Tween/TopDownMovement/... components,
    particle -> ParticleSystem, foliage -> FoliageInstancer, anim -> AnimFSM,
    timeline -> TimelineLite, cine -> CineCamera, destruct -> Destructible,
    streamer -> WorldStreamer (which eagerly spawns TerrainChunk_* children
    at build time, so streamer specs also differ in object counts).

  Runner-only runtime systems (applied post-build in setupGame/setupQuest,
  never part of the static graph on either side): wave-spawned enemies
  (MeshRenderer + Health/Hurtbox + EnemyAI + Telegraph), the MeleeHitbox
  attached to the player, and quest polling (no components).

  Adapter-verified shared vocabulary (locked by test_parity_subset_extended):
  mesh/light kinds, physics + mass, controller, weapon, health, ai,
  elemental (Track E.6 innate-aura path), vehicle (wheels REQUIRED — both
  builders construct VehicleController, which throws without wheels),
  events, daynight rigs bound by name after all objects exist.

Run from the repository root:
    python3 -m unittest harness.agents.test_scene_parity
"""

import difflib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER_DUMP = REPO_ROOT / "app" / "src" / "services" / "dumpRunnerGraph.mjs"
ADAPTER_DUMP = REPO_ROOT / "app" / "src" / "services" / "dumpAdapterGraph.ts"
TIDE_CINDER = REPO_ROOT / "harness" / "config" / "scenarios" / "tide_cinder.json"

# Runner-only static spec keys: present in qa_scenario_runner.buildScene but
# not in HarnessSceneAdapter.buildEngineScene. Parity specs must avoid them.
RUNNER_ONLY_KEYS = frozenset(
    {
        "modelUrl",
        "cel",
        "behaviors",
        "particle",
        "foliage",
        "anim",
        "timeline",
        "cine",
        "destruct",
        "streamer",
    }
)

# Extended parity probe: every adapter-supported field beyond the tide_cinder
# subset (elemental auras, vehicle/weapon/ai/events, a day/night rig hosted
# on a mesh object rather than a light).
PARITY_PROBE_SPEC = {
    "name": "parity_probe",
    "goal": "parity subset probe",
    "gameObjects": [
        {
            "name": "Floor",
            "shape": "box",
            "size": [20, 1, 20],
            "position": [0, -0.5, 0],
            "color": "#222222",
            "physics": "fixed",
        },
        {
            "name": "Hero",
            "shape": "capsule",
            "size": [1, 1.5, 1],
            "position": [0, 1.5, 0],
            "color": "#38bdf8",
            "physics": "dynamic",
            "controller": True,
            "health": {"maxHealth": 100, "destroyOnDeath": False},
            "elemental": {"aura": "Hydro", "maxHealth": 100},
            "events": [
                {
                    "id": "spin",
                    "conditions": [{"type": "EveryFrame"}],
                    "actions": [{"type": "Spin", "speed": 1.0}],
                }
            ],
        },
        {
            "name": "Rover",
            "shape": "box",
            "size": [2, 1, 4],
            "position": [5, 1, 0],
            "color": "#ef4444",
            "physics": "dynamic",
            "vehicle": {
                "throttle": 0.5,
                "wheels": [
                    {"offset": [-0.8, 0, 1.2]},
                    {"offset": [0.8, 0, 1.2]},
                    {"offset": [-0.8, 0, -1.2]},
                    {"offset": [0.8, 0, -1.2]},
                ],
            },
            "weapon": {"damage": 10, "fireRate": 1.0},
            "ai": {"targetName": "Hero"},
        },
        {
            "name": "Sun",
            "kind": "light",
            "lightType": "directional",
            "color": "#ffffff",
            "intensity": 2.0,
            "position": [10, 30, 8],
        },
        {
            "name": "Sky",
            "kind": "light",
            "lightType": "ambient",
            "color": "#93c5fd",
            "intensity": 0.5,
            "position": [0, 10, 6],
        },
        {
            "name": "Rig",
            "shape": "box",
            "size": [1, 1, 1],
            "position": [0, 1, 5],
            "color": "#00ff00",
            "daynight": {
                "dayLengthSeconds": 240,
                "startTimeOfDay": 0.3,
                "sun": "Sun",
                "ambient": "Sky",
            },
        },
    ],
}


def dump_graph(script, spec_path):
    """Run a dump script on a spec file; return the canonical graph."""
    proc = subprocess.run(
        ["node", str(script), "--scenario", str(spec_path)],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        timeout=120,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"{script.name} failed (exit {proc.returncode}):\n"
            f"STDOUT: {proc.stdout[-2000:]}\nSTDERR: {proc.stderr[-2000:]}"
        )
    return json.loads(proc.stdout)


def write_temp_spec(spec):
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    json.dump(spec, tmp)
    tmp.close()
    return Path(tmp.name)


def assert_same_graph(testcase, runner_graph, adapter_graph, label):
    testcase.assertEqual(
        [n["name"] for n in adapter_graph],
        [n["name"] for n in runner_graph],
        f"{label}: object names differ",
    )
    testcase.assertEqual(
        len(adapter_graph),
        len(runner_graph),
        f"{label}: object counts differ "
        f"(runner={len(runner_graph)}, adapter={len(adapter_graph)})",
    )
    for run_node, ad_node in zip(runner_graph, adapter_graph):
        testcase.assertEqual(
            ad_node["components"],
            run_node["components"],
            f"{label}: components differ on {run_node['name']!r} "
            f"(runner={run_node['components']}, adapter={ad_node['components']})",
        )
    diff = list(
        difflib.unified_diff(
            json.dumps(runner_graph, indent=1, sort_keys=True).splitlines(),
            json.dumps(adapter_graph, indent=1, sort_keys=True).splitlines(),
            fromfile="runner",
            tofile="adapter",
            lineterm="",
        )
    )
    testcase.assertEqual([], diff, f"{label}: graphs differ:\n" + "\n".join(diff))


class SceneParityTests(unittest.TestCase):
    def test_tide_cinder_parity(self):
        """tide_cinder.json builds the same static graph via both paths."""
        runner_graph = dump_graph(RUNNER_DUMP, TIDE_CINDER)
        adapter_graph = dump_graph(ADAPTER_DUMP, TIDE_CINDER)
        self.assertTrue(runner_graph, "runner graph is empty")
        assert_same_graph(self, runner_graph, adapter_graph, "tide_cinder")

    def test_parity_subset_extended(self):
        """Shared vocabulary beyond tide_cinder stays identical both ways.

        Locks elemental auras, vehicle/weapon/ai/events, and a mesh-hosted
        day/night rig — the fields the adapter added for Tracks E.2/E.6.
        """
        path = write_temp_spec(PARITY_PROBE_SPEC)
        try:
            runner_graph = dump_graph(RUNNER_DUMP, path)
            adapter_graph = dump_graph(ADAPTER_DUMP, path)
        finally:
            path.unlink(missing_ok=True)
        assert_same_graph(self, runner_graph, adapter_graph, "parity_probe")
        by_name = {n["name"]: n["components"] for n in adapter_graph}
        self.assertIn("ElementalReactionComponent", by_name["Hero"])
        self.assertIn("VehicleController", by_name["Rover"])
        self.assertIn("WeaponController", by_name["Rover"])
        self.assertIn("EnemyAI", by_name["Rover"])
        self.assertIn("EventSheet", by_name["Hero"])
        self.assertIn("DayNightCycle", by_name["Rig"])

    def test_parity_specs_use_shared_vocabulary(self):
        """Machine-checked gap documentation: parity specs avoid runner-only keys.

        If a runner-only system (camera, modelUrl, cel, behaviors, particle,
        foliage, anim, timeline, cine, destruct, streamer) ever enters a
        parity spec, this fails loudly instead of letting the invariant
        silently cover a known divergence.
        """
        specs = {
            "tide_cinder": json.loads(TIDE_CINDER.read_text(encoding="utf-8")),
            "parity_probe": PARITY_PROBE_SPEC,
        }
        for label, spec in specs.items():
            for obj in spec.get("gameObjects", []):
                self.assertNotEqual(
                    obj.get("kind"),
                    "camera",
                    f"{label}: object {obj.get('name')!r} uses camera kind (runner-only)",
                )
                stray = RUNNER_ONLY_KEYS.intersection(obj.keys())
                self.assertEqual(
                    set(),
                    set(stray),
                    f"{label}: object {obj.get('name')!r} uses runner-only "
                    f"keys {sorted(stray)}",
                )

    def test_no_hidden_build_children(self):
        """Neither builder spawns hidden children for parity specs.

        Object counts equal the spec's gameObjects length on both sides
        (contrast: a WorldStreamer spec eagerly spawns TerrainChunk_*
        children in the runner — one reason streamer is runner-only).
        """
        specs = {
            "tide_cinder": TIDE_CINDER,
            "parity_probe": write_temp_spec(PARITY_PROBE_SPEC),
        }
        try:
            for label, path in specs.items():
                expected = len(
                    json.loads(Path(path).read_text(encoding="utf-8"))["gameObjects"]
                )
                for script in (RUNNER_DUMP, ADAPTER_DUMP):
                    graph = dump_graph(script, path)
                    self.assertEqual(
                        expected,
                        len(graph),
                        f"{label} via {script.name}: expected {expected} "
                        f"objects, got {len(graph)}",
                    )
        finally:
            specs["parity_probe"].unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
