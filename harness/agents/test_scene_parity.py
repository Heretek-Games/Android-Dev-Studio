"""Scene-parity invariant (Phase 1.1): HarnessSceneAdapter === qa_scenario_runner.

Builds the SAME spec through both paths and asserts the SAME static scene
graph (object names, per-object sorted component type lists, counts,
transforms, and normalized build-time parameters):

  - studio adapter:  app/src/services/HarnessSceneAdapter.buildEngineScene
    via app/src/services/dumpAdapterGraph.ts
  - headless QA:     harness/agents/qa_scenario_runner.mjs :: buildScene
    via app/src/services/dumpRunnerGraph.mjs (loads the runner source as
    text and imports buildScene through a data: URL, since the runner
    executes main() on import and cannot be imported directly)

Both dumpers import the SINGLE shared canonicalizer
(app/src/services/sceneGraphCanonical.ts), so the compared form cannot drift
between dumpers. The canonical form covers transforms (position/rotation)
plus a normalized per-component parameter subset both builders preserve
verbatim (mesh shape/size/color, collider shape/size, body type/mass, light
type/color/intensity, weapon/health/ai/vehicle/elemental configs, event
condition/action type sequences, day/night timing). The test compares the
STATIC scene graph both builders produce, not runtime state.

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

  Parameter-level divergences (verified against both builders' sources; the
  canonicalizer EXCLUDES these and parity specs must not set them — enforced
  by test_parity_specs_use_shared_vocabulary, so the suite can never silently
  pass over a real builder difference):
    roughness / metallic / metalness — the runner honors them
      (defaults 0.4/0.0); the adapter hardcodes roughness 0.4 and omits
      metalness, keeping the engine default 0.1 (differs even when unset).
    controllerOptions — the runner forwards them to MobileController; the
      adapter always builds a default MobileController().
    scale — the adapter applies objSpec.scale; the runner ignores it.
    collider plane/torus shapes — the adapter remaps them to box (engine
      ColliderShape has no plane/torus); the runner passes them verbatim.
      Unlike the exclusions above, the canonicalizer NORMALIZES this
      (normalizeColliderShape, plane|torus -> box on both sides) because the
      Rapier init switch resolves unknown shapes to the box cuboid on both
      paths — effective physics agrees. The parity probe carries plane- and
      torus-shaped slabs to lock the rule in.
    event ids — the runner injects qa_ev_${i} fallbacks while the adapter
      stores raw spec events verbatim; the canonicalizer therefore uses the
      runner's qa_ev_${i} scheme for missing ids (see sceneGraphCanonical),
      so id-less specs agree instead of skewing. The probe carries one
      id-less event to lock the alignment in.

  Adapter-verified shared vocabulary (locked by test_parity_subset_extended):
  mesh/light kinds, physics + mass, controller, weapon, health, ai,
  elemental (Track E.6 innate-aura path), vehicle (wheels REQUIRED — both
  builders construct VehicleController, which throws without wheels),
  events, daynight rigs bound by name after all objects exist.

RUNNER_ONLY_KEYS maintenance story: when a builder gains a new spec-key
branch, update the census below and the matching set in this file:
  - runner-side branch (objSpec.<key> in qa_scenario_runner.buildScene) with
    no adapter equivalent -> add <key> to RUNNER_ONLY_KEYS;
  - adapter-side branch (obj.<key> in HarnessSceneAdapter.buildEngineScene)
    with no runner equivalent -> document it here and forbid it in parity
    specs (divergent) or extend the canonicalizer (shared);
  - shared branch -> add <key> to SHARED_PARAM_KEYS and cover its parameters
    in sceneGraphCanonical.componentParams.
test_runner_branches_are_accounted mechanizes this: it re-extracts every
objSpec.<key> / obj.<key> access from both build functions and fails loudly
on any key outside RUNNER_ONLY_KEYS + SHARED_PARAM_KEYS + DIVERGENT_KEYS.
Manual fallback (same census by eye):
  grep -o 'objSpec\\.[A-Za-z_]*' harness/agents/qa_scenario_runner.mjs | sort -u
  grep -o '\\bobj\\.[A-Za-z_]*' app/src/services/HarnessSceneAdapter.ts | sort -u

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
# cameraOptions/license ride the camera/modelUrl branches (no adapter
# equivalent); the rest each build a runner-only component (see docstring).
RUNNER_ONLY_KEYS = frozenset(
    {
        "modelUrl",
        "license",
        "cameraOptions",
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

# Shared parameter vocabulary: spec keys both builders honor verbatim (or via
# the single documented normalizeColliderShape rule for plane/torus collider
# shapes). The canonicalizer covers these in componentParams; extend this set
# (and the canonicalizer) when a new shared branch lands in both builders.
SHARED_PARAM_KEYS = frozenset(
    {
        "name",
        "kind",
        "position",
        "rotation",
        "shape",
        "size",
        "color",
        "lightType",
        "intensity",
        "physics",
        "mass",
        "controller",
        "weapon",
        "health",
        "ai",
        "elemental",
        "vehicle",
        "events",
        "daynight",
    }
)

# Known-divergent spec keys (see docstring): honored by one builder, dropped
# or ignored by the other. The canonicalizer deliberately EXCLUDES them and
# parity specs must NOT set them (enforced below) — extending this set is how
# a newly found divergence stays loud instead of going silent.
DIVERGENT_KEYS = frozenset(
    {
        "roughness",
        "metallic",
        "metalness",
        "controllerOptions",
        "scale",
    }
)

# Extended parity probe: every adapter-supported field beyond the tide_cinder
# subset (elemental auras, vehicle/weapon/ai/events, a day/night rig hosted
# on a mesh object rather than a light), plus parameter-coverage choices that
# prove pass-through rather than default-agreement: non-default health,
# elemental, mass, day/night timing, a rotated object, plane- and
# torus-shaped slabs that lock in the normalizeColliderShape rule (adapter
# remaps plane|torus colliders to box; the canonicalizer applies the remap
# both sides), and one id-less event that locks in the qa_ev_${i} fallback
# alignment (runner injects it, adapter stores raw, canonicalizer mirrors
# the runner scheme). Values here must stay inside the shared vocabulary —
# no RUNNER_ONLY_KEYS, no DIVERGENT_KEYS (enforced below).
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
            "name": "Mat",
            "shape": "plane",
            "size": [4, 0.2, 4],
            "position": [-6, 0.1, 3],
            "color": "#facc15",
            "physics": "fixed",
        },
        {
            "name": "Donut",
            "shape": "torus",
            "size": [2, 0.6, 2],
            "position": [6, 0.3, -3],
            "color": "#f472b6",
            "physics": "fixed",
        },
        {
            "name": "Hero",
            "shape": "capsule",
            "size": [1, 1.5, 1],
            "position": [0, 1.5, 0],
            "color": "#38bdf8",
            "physics": "dynamic",
            "mass": 2.0,
            "controller": True,
            "health": {"maxHealth": 150, "destroyOnDeath": False},
            "elemental": {"aura": "Hydro", "maxHealth": 120},
            "events": [
                {
                    "id": "spin",
                    "conditions": [{"type": "EveryFrame"}],
                    "actions": [{"type": "Spin", "speed": 1.0}],
                },
                {
                    # No id: exercises the qa_ev_${i} fallback alignment
                    # (runner injects qa_ev_1, canonicalizer mirrors it).
                    "conditions": [{"type": "EveryFrame"}],
                    "actions": [{"type": "Spin", "speed": 0.5}],
                }
            ],
        },
        {
            "name": "Rover",
            "shape": "box",
            "size": [2, 1, 4],
            "position": [5, 1, 0],
            "rotation": [0, 0.5, 0],
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
                "dayLengthSeconds": 120,
                "startTimeOfDay": 0.6,
                "sun": "Sun",
                "ambient": "Sky",
            },
        },
    ],
}


# Shared spec registry: every parity spec lives here exactly once. The
# hygiene test (test_parity_specs_use_shared_vocabulary) and the
# hidden-children test iterate it, so registering a new parity spec is a
# one-line addition here instead of another hardcoded dict per test.
def _load_tide_cinder_spec():
    return json.loads(TIDE_CINDER.read_text(encoding="utf-8"))


SPEC_REGISTRY = {
    "tide_cinder": _load_tide_cinder_spec,
    "parity_probe": lambda: PARITY_PROBE_SPEC,
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
        day/night rig — the fields the adapter added for Tracks E.2/E.6 —
        down to PARAMETER level (non-default values prove pass-through, not
        default-agreement), plus the plane/torus-collider normalization rule
        and the qa_ev_${i} event-id fallback alignment.
        """
        path = write_temp_spec(PARITY_PROBE_SPEC)
        try:
            runner_graph = dump_graph(RUNNER_DUMP, path)
            adapter_graph = dump_graph(ADAPTER_DUMP, path)
        finally:
            path.unlink(missing_ok=True)
        assert_same_graph(self, runner_graph, adapter_graph, "parity_probe")
        by_name = {n["name"]: n for n in adapter_graph}
        self.assertIn("ElementalReactionComponent", by_name["Hero"]["components"])
        self.assertIn("VehicleController", by_name["Rover"]["components"])
        self.assertIn("WeaponController", by_name["Rover"]["components"])
        self.assertIn("EnemyAI", by_name["Rover"]["components"])
        self.assertIn("EventSheet", by_name["Hero"]["components"])
        self.assertIn("DayNightCycle", by_name["Rig"]["components"])
        # Parameter coverage: non-default values survived both builders.
        hero = by_name["Hero"]["params"]
        self.assertEqual(150, hero["HealthComponent"]["maxHealth"])
        self.assertEqual(120, hero["ElementalReactionComponent"]["maxHealth"])
        self.assertEqual("Hydro", hero["ElementalReactionComponent"]["aura"])
        self.assertEqual(2.0, by_name["Hero"]["params"]["RigidBody3D"]["mass"])
        rover = by_name["Rover"]["params"]
        self.assertEqual([5, 1, 0], by_name["Rover"]["transform"]["position"])
        self.assertEqual([0, 0.5, 0], by_name["Rover"]["transform"]["rotation"])
        self.assertEqual(10, rover["WeaponController"]["damage"])
        self.assertEqual(1.0, rover["WeaponController"]["fireRate"])
        self.assertEqual("Hero", rover["EnemyAI"]["targetName"])
        self.assertEqual(0.5, rover["VehicleController"]["throttle"])
        self.assertEqual(4, rover["VehicleController"]["wheels"])
        self.assertEqual(
            [
                {"id": "spin", "conditions": ["EveryFrame"], "actions": ["Spin"]},
                {"id": "qa_ev_1", "conditions": ["EveryFrame"], "actions": ["Spin"]},
            ],
            hero["EventSheet"]["events"],
        )
        self.assertEqual(120, by_name["Rig"]["params"]["DayNightCycle"]["dayLengthSeconds"])
        self.assertEqual(0.6, by_name["Rig"]["params"]["DayNightCycle"]["timeOfDay"])
        # Collider normalization: plane AND torus slabs simulate boxes.
        mat = by_name["Mat"]["params"]
        self.assertEqual("plane", mat["MeshRenderer"]["shape"])
        self.assertEqual("box", mat["Collider3D"]["shape"])
        donut = by_name["Donut"]["params"]
        self.assertEqual("torus", donut["MeshRenderer"]["shape"])
        self.assertEqual("box", donut["Collider3D"]["shape"])

    def test_parity_specs_use_shared_vocabulary(self):
        """Machine-checked gap documentation: parity specs avoid runner-only keys.

        If a runner-only system (camera, modelUrl, cel, behaviors, particle,
        foliage, anim, timeline, cine, destruct, streamer) ever enters a
        parity spec, this fails loudly instead of letting the invariant
        silently cover a known divergence. The same holds for DIVERGENT_KEYS
        (roughness/metallic/metalness/controllerOptions/scale): the
        canonicalizer deliberately excludes them, so a spec that sets one
        would PASS while the builders differ — this test closes that hole by
        forbidding them in parity specs outright.
        """
        specs = {label: load() for label, load in SPEC_REGISTRY.items()}
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
                divergent = DIVERGENT_KEYS.intersection(obj.keys())
                self.assertEqual(
                    set(),
                    set(divergent),
                    f"{label}: object {obj.get('name')!r} uses divergent "
                    f"keys {sorted(divergent)} (excluded from the canonical "
                    f"form — see module docstring)",
                )

    def test_runner_branches_are_accounted(self):
        """Mechanical RUNNER_ONLY_KEYS maintenance check (see module docstring).

        Re-extracts every objSpec.<key> access from the runner's buildScene
        and every obj.<key> access (+ cast-form }).<key>) from the adapter's
        buildEngineScene, and fails loudly on any key outside
        RUNNER_ONLY_KEYS + SHARED_PARAM_KEYS + DIVERGENT_KEYS. A new builder
        branch without a census entry breaks here — add it to the right set
        (runner-only, shared + canonicalizer coverage, or divergent +
        spec-hygiene) instead of letting the invariant silently narrow.
        """
        import re

        allowed = RUNNER_ONLY_KEYS | SHARED_PARAM_KEYS | DIVERGENT_KEYS
        runner_src = (REPO_ROOT / "harness" / "agents" / "qa_scenario_runner.mjs").read_text(
            encoding="utf-8"
        )
        start = runner_src.index("function buildScene")
        end = runner_src.index("function addElementalComponent")
        self.assertLess(start, end, "runner buildScene/addElementalComponent markers moved")
        runner_keys = set(re.findall(r"objSpec\.([A-Za-z_]+)", runner_src[start:end]))
        self.assertEqual(
            set(),
            runner_keys - allowed,
            "unaccounted objSpec.* keys in qa_scenario_runner.buildScene — "
            "classify them (RUNNER_ONLY/SHARED/DIVERGENT) per the docstring",
        )
        adapter_src = (
            REPO_ROOT / "app" / "src" / "services" / "HarnessSceneAdapter.ts"
        ).read_text(encoding="utf-8")
        astart = adapter_src.index("function buildEngineScene")
        aend = adapter_src.index("function estimateDrawCalls")
        self.assertLess(astart, aend, "adapter buildEngineScene markers moved")
        adapter_body = adapter_src[astart:aend]
        adapter_keys = set(re.findall(r"\bobj\.([A-Za-z_]+)", adapter_body)) | set(
            re.findall(r"\}\)\.([A-Za-z_]+)", adapter_body)
        )
        self.assertEqual(
            set(),
            adapter_keys - allowed,
            "unaccounted obj.* keys in HarnessSceneAdapter.buildEngineScene — "
            "classify them (SHARED/DIVERGENT) per the docstring",
        )

    def test_no_hidden_build_children(self):
        """Neither builder spawns hidden children for parity specs.

        Object counts equal the spec's gameObjects length on both sides
        (contrast: a WorldStreamer spec eagerly spawns TerrainChunk_*
        children in the runner — one reason streamer is runner-only).
        """
        specs = {
            label: write_temp_spec(load()) for label, load in SPEC_REGISTRY.items()
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
            for path in specs.values():
                path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
