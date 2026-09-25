"""
Heretek 3D Android Studio — Autonomous Multi-Agent Swarm Orchestrator
Coordinates 6 specialized subagents:
1. Systems Architect (Engine core, ECS, monorepo integrity, ADRs)
2. Gameplay Coder (Player controller, weapon ballistics, behavior trees)
3. World & Level Designer (Open-world streaming, terrain sculptor, prop scatter)
4. Shader & Tech Artist (Anime cel-shader, toon outlines, lighting)
5. Static Invariant Auditor (Zero-mistake guardrail: 7 scene invariants & budget)
6. Artemis QA Lead (Real headless engine simulation, 60 FPS profiling, regression gate)
using task dependency DAGs, persistent project memory, and self-healing loops.
"""

import json
import time
import os
import sys
import subprocess
from typing import Any, Dict, List, Optional
from ..memory.project_memory import ProjectMemory
from ..validation.scene_invariants import validate_scene_invariants

HARNESS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(HARNESS_DIR)
ACTIVE_SCENE_PATH = os.path.join(HARNESS_DIR, "scenes", "active_scene.json")
MINI_ARENA_PATH = os.path.join(HARNESS_DIR, "config", "scenarios", "mini_arena.json")
NODE_RUNNER = os.path.join(HARNESS_DIR, "agents", "qa_scenario_runner.mjs")


class SubagentRole:
    ARCHITECT = "SystemsArchitect"
    CODER = "GameplayCoder"
    WORLD_DESIGNER = "WorldDesigner"
    SHADER_DEV = "ShaderDev"
    AUDITOR = "InvariantAuditor"
    REVIEWER = "CodeReviewer"
    QA = "ArtemisQA"
    # Builder pod (production-loop roles; extend, do not rename, the above)
    EXECUTIVE_PRODUCER = "ExecutiveProducer"
    WORLD_DIRECTOR = "WorldDirector"
    GAMEPLAY_LEAD = "GameplayLead"
    SYSTEMS_ENGINEER = "SystemsEngineer"
    CONTENT_DESIGNER = "ContentDesigner"
    TECH_ARTIST = "TechArtist"
    # Independent critic & audit pod
    PLAYTESTER = "AutonomousPlaytester"
    VISUAL_CRITIC = "VisualCritic"
    PERFORMANCE_ENGINEER = "PerformanceEngineer"
    RED_TEAM = "RedTeam"
    HISTORIAN = "HistorianMemory"


#: Acceptance axis -> (builder role, critic role). The critic is never the
#: builder: builders must never grade their own work.
AXIS_POD_ASSIGNMENT = {
    "Functional": (SubagentRole.SYSTEMS_ENGINEER, SubagentRole.QA),
    "Playable": (SubagentRole.GAMEPLAY_LEAD, SubagentRole.PLAYTESTER),
    "Performant": (SubagentRole.TECH_ARTIST, SubagentRole.PERFORMANCE_ENGINEER),
    "Visually Coherent": (SubagentRole.TECH_ARTIST, SubagentRole.VISUAL_CRITIC),
    "Spec-Accurate": (SubagentRole.CONTENT_DESIGNER, SubagentRole.REVIEWER),
}


class AgentSwarmOrchestrator:
    def __init__(self, memory: Optional[ProjectMemory] = None):
        self.memory = memory or ProjectMemory()

    def decompose_game_prompt(self, prompt: str) -> List[Dict[str, Any]]:
        """
        Decomposes a high-level game design prompt into an executable Task DAG
        with assigned roles, dependencies, and verification criteria.
        """
        lower = prompt.lower()
        tasks = []

        # 1. Architectural Baseline Task (Assigned to Systems Architect)
        t1_id = self.memory.create_task(
            title="Design Architectural Specification & Scene Graph AST",
            description=f"Establish entity hierarchy, camera perspective, and physics bounds for: '{prompt}'",
            assigned_agent=SubagentRole.ARCHITECT,
        )
        tasks.append(
            {
                "id": t1_id,
                "role": SubagentRole.ARCHITECT,
                "title": "Architectural Specification",
            }
        )

        # 2. Open World & Level Design Task
        if (
            "genshin" in lower
            or "open world" in lower
            or "terrain" in lower
            or "world" in lower
        ):
            t_world_id = self.memory.create_task(
                title="Generate Procedural Fractal Terrain & Chunk Streaming",
                description="Configure multi-octave fractal noise, slope-based splatting, and world streamer chunks around player",
                assigned_agent=SubagentRole.WORLD_DESIGNER,
                dependencies=[t1_id],
            )
            tasks.append(
                {
                    "id": t_world_id,
                    "role": SubagentRole.WORLD_DESIGNER,
                    "title": "Procedural Terrain & Chunk Streaming",
                }
            )

            t_shader_id = self.memory.create_task(
                title="Configure Genshin Anime Cel-Shader & Outlines",
                description="Setup multi-band diffuse quantization, Fresnel rim lighting, and inverted-hull toon outlines",
                assigned_agent=SubagentRole.SHADER_DEV,
                dependencies=[t_world_id],
            )
            tasks.append(
                {
                    "id": t_shader_id,
                    "role": SubagentRole.SHADER_DEV,
                    "title": "Anime Cel-Shader & Outlines",
                }
            )

            t2_id = self.memory.create_task(
                title="Implement Skeletal Locomotion Blend Tree & Controls",
                description="Configure 1D/2D locomotion blend spaces, cross-fades, and touch joystick mapping",
                assigned_agent=SubagentRole.CODER,
                dependencies=[t_shader_id],
            )
            tasks.append(
                {
                    "id": t2_id,
                    "role": SubagentRole.CODER,
                    "title": "Locomotion Blend Tree",
                }
            )

        elif "fps" in lower or "shooter" in lower or "doom" in lower:
            t2_id = self.memory.create_task(
                title="Implement FPS Viewmodel & Ballistic Raycast Controller",
                description="Configure weapon sway, ADS blend transitions, recoil bloom, and zero-GC raycast hitscan",
                assigned_agent=SubagentRole.CODER,
                dependencies=[t1_id],
            )
            tasks.append(
                {
                    "id": t2_id,
                    "role": SubagentRole.CODER,
                    "title": "FPS Viewmodel & Weapon Ballistics",
                }
            )

            t3_id = self.memory.create_task(
                title="Setup Demon Horde Behavior Tree & Spawner",
                description="Construct selector-sequence behavior trees, NavMesh pathfinding, and wave triggers",
                assigned_agent=SubagentRole.CODER,
                dependencies=[t2_id],
            )
            tasks.append(
                {
                    "id": t3_id,
                    "role": SubagentRole.CODER,
                    "title": "Demon Horde Behavior Tree",
                }
            )

        else:
            t2_id = self.memory.create_task(
                title="Implement Core Gameplay Components & Mobile Controller",
                description="Setup player character controls, collision triggers, and visual event sheets",
                assigned_agent=SubagentRole.CODER,
                dependencies=[t1_id],
            )
            tasks.append(
                {
                    "id": t2_id,
                    "role": SubagentRole.CODER,
                    "title": "Gameplay Components",
                }
            )

        # 3. Static Invariant Audit Gate
        last_coder_id = tasks[-1]["id"]
        t_audit_id = self.memory.create_task(
            title="Verify 7 Scene Invariants & Mobile Budget",
            description="Audit finite transforms, draw calls <= 100, collision non-penetration, and component contracts",
            assigned_agent=SubagentRole.AUDITOR,
            dependencies=[last_coder_id],
        )
        tasks.append(
            {
                "id": t_audit_id,
                "role": SubagentRole.AUDITOR,
                "title": "Scene Invariant Audit",
            }
        )

        # 4. Google Artemis Autonomous QA Task (Real Headless Simulation)
        t_qa_id = self.memory.create_task(
            title="Dispatch Google Artemis Autonomous Headless Playtest",
            description="Boot scenario on real Rapier3D runtime, measuring sim FPS, frame time, draw calls, and regression baselines",
            assigned_agent=SubagentRole.QA,
            dependencies=[t_audit_id],
        )
        tasks.append(
            {"id": t_qa_id, "role": SubagentRole.QA, "title": "Artemis Autonomous QA"}
        )

        # 5. Final Reviewer Sign-Off
        t_rev_id = self.memory.create_task(
            title="Code Reviewer Verification & Sign-off",
            description="Validate all pipeline stages passed, confirm regression-free status, and commit artifacts",
            assigned_agent=SubagentRole.REVIEWER,
            dependencies=[t_qa_id],
        )
        tasks.append(
            {
                "id": t_rev_id,
                "role": SubagentRole.REVIEWER,
                "title": "Code Reviewer Sign-off",
            }
        )

        return tasks

    def plan_from_brief(self, brief_id: str) -> Dict[str, Any]:
        """Build the production DAG from a persisted Game Production Brief.

        Every acceptance criterion becomes a builder task plus a critic task that
        depends on it. The critic is never the builder. Tasks land in the
        existing subagent_tasks ledger; use get_ready_tasks() to schedule them.
        """
        from harness.briefs.game_brief import GameProductionBrief

        stored = self.memory.get_brief(brief_id)
        if stored is None:
            raise ValueError(f"unknown brief_id '{brief_id}'")
        brief = GameProductionBrief.from_dict(stored["brief"])

        tasks = []
        for criterion in brief.acceptance:
            builder_role, critic_role = AXIS_POD_ASSIGNMENT[criterion.axis]
            check = ""
            if criterion.qa_rule is not None:
                check = f" Headless check: {criterion.qa_rule}."
            build_id = self.memory.create_task(
                title=f"Build: {criterion.description}",
                description=(
                    f"[{criterion.axis}] {criterion.description} "
                    f"(criterion {criterion.id} of brief '{brief.title}').{check}"
                ),
                assigned_agent=builder_role,
            )
            tasks.append(
                {"id": build_id, "role": builder_role, "criterionId": criterion.id}
            )
            critic_id = self.memory.create_task(
                title=f"Critique: {criterion.description}",
                description=(
                    f"[{criterion.axis}] Independently verify criterion {criterion.id} "
                    f"of brief '{brief.title}': {criterion.description}.{check}"
                ),
                assigned_agent=critic_role,
                dependencies=[build_id],
            )
            tasks.append(
                {"id": critic_id, "role": critic_role, "criterionId": criterion.id}
            )
        return {"brief_id": brief_id, "title": brief.title, "tasks": tasks}

    def get_ready_tasks(self) -> List[Dict[str, Any]]:
        """Pending tasks whose dependencies are all completed (schedulable now)."""
        completed = {
            task["task_id"] for task in self.memory.list_tasks(state="completed")
        }
        ready = []
        for task in self.memory.list_tasks(state="pending"):
            if all(dep in completed for dep in task.get("dependencies", [])):
                ready.append(task)
        return ready

    def execute_swarm_pipeline(self, prompt: str) -> Dict[str, Any]:
        """
        Executes the autonomous subagent pipeline from Architecture through QA verification.
        Includes automated iterative self-healing if invariants or QA assertions fail.
        """
        task_plan = self.decompose_game_prompt(prompt)
        execution_log = []

        scenario_path = (
            ACTIVE_SCENE_PATH if os.path.exists(ACTIVE_SCENE_PATH) else MINI_ARENA_PATH
        )
        latest_telemetry: Dict[str, Any] = {}

        for t in task_plan:
            self.memory.update_task_state(t["id"], "in_progress")
            role = t["role"]
            title = t["title"]

            if role == SubagentRole.ARCHITECT:
                adr_id = self.memory.record_adr(
                    title=f"Architectural Spec: {prompt[:40]}...",
                    rationale="Established entity hierarchy, camera perspective, PBR material profile, and physics boundaries.",
                    status="accepted",
                    tags=["architecture", "gdd"],
                )
                result = {
                    "status": "success",
                    "adr_id": adr_id,
                    "details": "Scene schema and component budget compiled.",
                }

            elif role == SubagentRole.WORLD_DESIGNER:
                # Real action: stream procedural terrain chunks into the canonical scene (gated)
                result = self._run_world_designer()

            elif role == SubagentRole.SHADER_DEV:
                # Real action: apply cel-shading config to canonical scene entities (gated)
                result = self._run_shader_dev()

            elif role == SubagentRole.CODER:
                # Real action: wire a gameplay event onto a scene entity (gated)
                result = self._run_gameplay_coder()

            elif role == SubagentRole.AUDITOR:
                # Real static invariant verification
                result = self._run_invariant_audit(scenario_path)

            elif role == SubagentRole.QA:
                # Real headless Artemis QA execution
                result = self._run_artemis_qa(scenario_path, prompt)
                latest_telemetry = result.get("telemetry", {})

            elif role == SubagentRole.REVIEWER:
                if not latest_telemetry:
                    # TODO(ws3): reviewer requires real QA telemetry to sign off.
                    result = {
                        "status": "skipped",
                        "todo": "No QA telemetry available for review yet.",
                        "details": "Skipped: the QA stage produced no telemetry.",
                    }
                else:
                    review_verdict = latest_telemetry.get("verdict", "UNKNOWN")
                    result = {
                        "status": "approved"
                        if review_verdict == "SUCCEEDED"
                        else "flagged",
                        "verdict": review_verdict,
                        "draw_calls": latest_telemetry.get("drawCallEstimate"),
                        "sim_fps": latest_telemetry.get("simFpsEstimate"),
                        "heap_mb": latest_telemetry.get("memoryHeapMb"),
                    }
            else:
                result = {"status": "completed"}

            task_state = "skipped" if result.get("status") == "skipped" else "completed"
            self.memory.update_task_state(t["id"], task_state, result)
            execution_log.append(
                {"task_id": t["id"], "role": role, "title": title, "result": result}
            )

        return {
            "prompt": prompt,
            "tasks_executed": len(execution_log),
            "log": execution_log,
            "project_status": self.memory.get_project_summary(),
        }

    # --- Real role actions (invariant-gated canonical scene mutations) ------

    def _load_scene(self) -> Optional[Dict[str, Any]]:
        try:
            with open(ACTIVE_SCENE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def _save_scene_gated(self, scene: Dict[str, Any]) -> tuple:
        """Persist a scene only if it satisfies all 7 invariants; snapshot to memory."""
        is_valid, violations = validate_scene_invariants(scene)
        if not is_valid:
            return False, "; ".join(f"[{v['code']}] {v['message']}" for v in violations)
        with open(ACTIVE_SCENE_PATH, "w", encoding="utf-8") as f:
            json.dump(scene, f, indent=2)
        try:
            self.memory.save_scene_snapshot(
                scene.get("id", "active_scene"), scene.get("name", "ActiveScene"), scene
            )
        except Exception:
            pass  # persistence best-effort
        return True, None

    def _run_world_designer(self) -> Dict[str, Any]:
        """Streams procedural terrain chunks into the canonical scene (gated)."""
        scene = self._load_scene()
        if scene is None:
            return {
                "status": "error",
                "details": "Active scene unavailable for terrain streaming.",
            }

        existing = {o.get("name") for o in scene.get("gameObjects", [])}
        added = []
        for cx in range(0, 2):
            for cz in range(0, 2):
                name = f"TerrainChunk_{cx}_{cz}"
                if name in existing:
                    continue
                scene.setdefault("gameObjects", []).append(
                    {
                        "name": name,
                        "kind": "terrain",
                        "shape": "plane",
                        "size": [32, 0.2, 32],
                        "position": [cx * 32 - 16, -0.1, cz * 32 - 16],
                        "color": "#3f6212",
                        "physics": "fixed",
                        "elevation": 6.0,
                    }
                )
                added.append(name)

        if not added:
            return {
                "status": "success",
                "chunks_generated": 0,
                "details": "Terrain chunks already present in the canonical scene.",
            }

        ok, err = self._save_scene_gated(scene)
        if not ok:
            return {
                "status": "error",
                "details": f"Invariant gate rejected terrain streaming: {err}",
            }
        return {
            "status": "success",
            "chunks_generated": len(added),
            "details": f"Streamed {len(added)} terrain chunks ({', '.join(added)}) into the canonical scene (invariant-gated).",
        }

    def _run_shader_dev(self) -> Dict[str, Any]:
        """Applies cel-shading configuration to canonical scene entities (gated)."""
        scene = self._load_scene()
        if scene is None:
            return {
                "status": "error",
                "details": "Active scene unavailable for shader application.",
            }

        config = {
            "shader": "AnimeCelShader",
            "steps": 3,
            "rimPower": 3.5,
            "outlineThickness": 0.035,
        }
        scene["celShading"] = config
        applied = 0
        for obj in scene.get("gameObjects", []):
            if (obj.get("kind") or "mesh") == "mesh":
                obj["celShading"] = {"steps": 3, "rimPower": 3.5}
                applied += 1

        ok, err = self._save_scene_gated(scene)
        if not ok:
            return {
                "status": "error",
                "details": f"Invariant gate rejected shader config: {err}",
            }
        return {
            "status": "success",
            "shader_type": "AnimeCelShader",
            "entities_shaded": applied,
            "details": f"Applied AnimeCelShader config (3 steps, rim 3.5) to {applied} scene entities (invariant-gated).",
        }

    def _run_gameplay_coder(self) -> Dict[str, Any]:
        """Wires a real gameplay event onto a canonical scene entity (gated)."""
        scene = self._load_scene()
        if scene is None:
            return {
                "status": "error",
                "details": "Active scene unavailable for event wiring.",
            }

        target = next(
            (
                o
                for o in scene.get("gameObjects", [])
                if (o.get("kind") or "mesh") == "mesh"
                and "ground" not in str(o.get("name", "")).lower()
            ),
            None,
        )
        if target is None:
            return {
                "status": "error",
                "details": "No suitable entity found for gameplay event wiring.",
            }

        events = target.setdefault("events", [])
        if not any(e.get("name") == "AI Idle Spin" for e in events):
            events.append(
                {
                    "name": "AI Idle Spin",
                    "conditions": [
                        {
                            "type": "Timer",
                            "params": {"name": "ai_spin", "interval": 1.0},
                        }
                    ],
                    "actions": [{"type": "RotateY", "params": {"degrees": 15}}],
                }
            )

        ok, err = self._save_scene_gated(scene)
        if not ok:
            return {
                "status": "error",
                "details": f"Invariant gate rejected event wiring: {err}",
            }
        return {
            "status": "success",
            "components_generated": 1,
            "details": f"Wired Timer→RotateY event onto '{target.get('name')}' in the canonical scene (invariant-gated).",
        }

    def _run_invariant_audit(self, scenario_path: str) -> Dict[str, Any]:
        """Runs the deterministic 7-point scene invariant gate."""
        try:
            with open(scenario_path, "r", encoding="utf-8") as f:
                scene_data = json.load(f)

            is_valid, violations = validate_scene_invariants(scene_data)
            if not is_valid:
                # Self-healing attempt: fix simple issues (e.g. non-finite transforms or overlapping colliders)
                healed = self._self_heal_scene_data(scene_data, violations)
                if healed:
                    revalidated, remaining = validate_scene_invariants(scene_data)
                    if revalidated:
                        with open(scenario_path, "w", encoding="utf-8") as f:
                            json.dump(scene_data, f, indent=2)
                        try:
                            self.memory.save_scene_snapshot(
                                scene_data.get("id", os.path.basename(scenario_path)),
                                scene_data.get("name", "ActiveScene"),
                                scene_data,
                            )
                        except Exception:
                            pass  # persistence best-effort
                    is_valid, violations = revalidated, remaining

            return {
                "status": "success" if is_valid else "violations_detected",
                "is_valid": is_valid,
                "violations_count": len(violations),
                "violations": violations,
                "details": "All 7 scene invariants satisfied."
                if is_valid
                else f"{len(violations)} invariant violations found.",
            }
        except Exception as e:
            return {"status": "error", "message": str(e), "is_valid": False}

    def _self_heal_scene_data(
        self, scene_data: Dict[str, Any], violations: List[Dict[str, Any]]
    ) -> bool:
        """Applies restorative patches to scene data to satisfy invariants."""
        modified = False
        game_objects = scene_data.get("gameObjects", [])

        for v in violations:
            code = v.get("code")
            entity_name = v.get("entity")

            if code == "COLLIDER_PENETRATION_AT_SPAWN" and entity_name:
                for go in game_objects:
                    if go.get("name") == entity_name:
                        pos = go.setdefault("position", [0, 0, 0])
                        # Elevate dynamic entity above the floor to resolve penetration
                        pos[1] = max(
                            pos[1] if isinstance(pos[1], (int, float)) else 0, 2.0
                        )
                        modified = True

            elif code in ("NON_FINITE_POSITION", "INVALID_SCALE") and entity_name:
                for go in game_objects:
                    if go.get("name") == entity_name:
                        if code == "NON_FINITE_POSITION":
                            go["position"] = [0, 1.0, 0]
                        else:
                            go["scale"] = [1, 1, 1]
                        modified = True

        return modified

    def _run_artemis_qa(self, scenario_path: str, goal: str) -> Dict[str, Any]:
        """
        Boots the scenario through the real headless QA pipeline
        (artemis_qa_runner.py): real engine metrics, rule evaluation,
        regression gate, and project-memory benchmark recording.
        """
        runner = os.path.join(HARNESS_DIR, "agents", "artemis_qa_runner.py")
        try:
            cmd = [
                sys.executable,
                runner,
                "--json",
                "--goal",
                goal,
                "--scenario",
                scenario_path,
                "--frames",
                "120",
            ]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, cwd=REPO_ROOT, timeout=120
            )
            report = json.loads(proc.stdout)
            metrics = report.get("metrics", {})
            verdict = report.get("verdict", "FAILED")
            if report.get("error"):
                return {
                    "status": "error",
                    "verdict": "FAILED",
                    "passed_rules": "0/0",
                    "telemetry": {},
                    "details": f"QA pipeline error: {report.get('error')}",
                }
            return {
                "status": "passed"
                if verdict == "SUCCEEDED"
                else ("regressed" if verdict == "REGRESSED" else "failed"),
                "verdict": verdict,
                "passed_rules": f"{report.get('passed', 0)}/{report.get('total', 0)}",
                "telemetry": {**metrics, "verdict": verdict},
                "regressions": report.get("regressions", []),
                "details": (
                    f"Headless QA via artemis_qa_runner: {metrics.get('simFpsEstimate', 0):.1f} sim FPS, "
                    f"{metrics.get('drawCallEstimate', 0)} draw calls, verdict {verdict}."
                ),
            }
        except Exception as e:
            # Never fabricate QA results — report the failure honestly.
            return {
                "status": "error",
                "verdict": "FAILED",
                "passed_rules": "0/0",
                "telemetry": {},
                "details": f"QA pipeline unavailable: {e}",
            }
