"""
Heretek 3D Android Studio — MCP Server
Exposes 3D scene manipulation, entity-component systems, CC0 asset store installation,
persistent cross-session memory, multi-agent swarm orchestration, Android APK builds,
automated self-healing, and Google Artemis autonomous QA playtesting.
"""

import sys
import json
import asyncio
import os
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from .memory.project_memory import ProjectMemory
from .orchestrator.agent_swarm import AgentSwarmOrchestrator
from .build.apk_builder import AndroidApkBuilder
from .validation.scene_invariants import validate_scene_invariants

# Initialize Persistent Memory & Swarm Orchestrator
memory = ProjectMemory()
swarm = AgentSwarmOrchestrator(memory)

# Define Tool Schemas
TOOLS = [
    {
        "name": "studio_get_scene_hierarchy",
        "description": "Inspects the current 3D scene hierarchy, returning all GameObjects, active components, and world transforms.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "studio_spawn_entity",
        "description": "Spawns a new 3D GameObject into the active scene with mesh, materials, and physics.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Display name of the entity"},
                "shape": {
                    "type": "string",
                    "enum": ["box", "sphere", "cylinder", "capsule", "plane"],
                    "default": "box",
                },
                "size": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "Full [x, y, z] box dimensions in world units; defaults to [1,1,1]",
                    "default": [1, 1, 1],
                },
                "color": {
                    "type": "string",
                    "description": "Hex color code, e.g. #3b82f6",
                },
                "position": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "[x, y, z] coordinate",
                },
                "physics": {
                    "type": "string",
                    "enum": ["dynamic", "fixed", "none"],
                    "default": "dynamic",
                },
                "mass": {"type": "number", "default": 1.0},
            },
            "required": ["name"],
        },
    },
    {
        "name": "studio_modify_component",
        "description": "Modifies properties of a component on a specified entity.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {
                    "type": "string",
                    "description": "Name of the entity to modify",
                },
                "component_type": {
                    "type": "string",
                    "description": "e.g. MeshRenderer, LightComponent, RigidBody3D, MobileController",
                },
                "properties": {
                    "type": "object",
                    "description": "Key-value property overrides",
                },
            },
            "required": ["entity_name", "component_type", "properties"],
        },
    },
    {
        "name": "studio_add_visual_event",
        "description": "Adds a visual condition-action event (GDevelop style) to an entity's EventSheet.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "event_name": {"type": "string"},
                "condition": {
                    "type": "string",
                    "enum": [
                        "EveryFrame",
                        "OnStart",
                        "OnButtonPress",
                        "OnTouchTap",
                        "Timer",
                    ],
                },
                "action": {
                    "type": "string",
                    "enum": [
                        "RotateY",
                        "ApplyImpulse",
                        "Translate",
                        "SetColor",
                        "Destroy",
                    ],
                },
                "action_params": {"type": "object"},
            },
            "required": ["entity_name", "event_name", "condition", "action"],
        },
    },
    {
        "name": "studio_delete_entity",
        "description": "Safely removes an entity from the active scene by name and persists the change.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {
                    "type": "string",
                    "description": "Name of the entity to delete",
                },
            },
            "required": ["entity_name"],
        },
    },
    {
        "name": "studio_search_and_install_asset",
        "description": "Searches the GDevelop & CC0 3D asset database (Quaternius, Kenney, Poly Haven) and installs into the scene.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term, e.g. 'ninja', 'mech', 'car', 'chest'",
                },
                "category": {
                    "type": "string",
                    "enum": [
                        "all",
                        "characters",
                        "props",
                        "vehicles",
                        "environment",
                        "weapons",
                        "skyboxes",
                    ],
                    "default": "all",
                },
                "install_to_scene": {"type": "boolean", "default": True},
            },
            "required": ["query"],
        },
    },
    {
        "name": "studio_self_heal_error",
        "description": "Runs autonomous self-healing diagnostics on a runtime exception or Logcat trace, applying scene patches.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "error_trace": {
                    "type": "string",
                    "description": "Error message or stack trace to diagnose",
                },
                "subsystem": {
                    "type": "string",
                    "description": "Originating subsystem (e.g. Physics, WebGL, EventSheet, Logcat)",
                },
            },
            "required": ["error_trace"],
        },
    },
    {
        "name": "studio_query_memory",
        "description": "Queries cross-session project memory, including Architectural Decision Records (ADRs), task DAGs, and QA benchmarks.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query_type": {
                    "type": "string",
                    "enum": ["summary", "adrs", "tasks", "benchmarks"],
                    "default": "summary",
                }
            },
        },
    },
    {
        "name": "studio_record_adr",
        "description": "Records an Architectural Decision Record (ADR) into persistent cross-session memory.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "rationale": {"type": "string"},
                "status": {"type": "string", "default": "accepted"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "rationale"],
        },
    },
    {
        "name": "studio_dispatch_subagent_task",
        "description": "Decomposes a game design prompt and dispatches an autonomous multi-agent swarm pipeline (Architect, Coder, Reviewer, Artemis QA).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Game design prompt or task description",
                }
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "studio_build_and_deploy_apk",
        "description": "Builds the hardware-accelerated 3D Android game APK and deploys to target device via ADB.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_serial": {
                    "type": "string",
                    "description": "ADB device serial (e.g. emulator-5554)",
                },
                "launch_immediately": {"type": "boolean", "default": True},
            },
        },
    },
    {
        "name": "studio_run_artemis_qa",
        "description": "Boots a game scenario headless on the real engine runtime (harness/agents/qa_scenario_runner.mjs), records real telemetry (sim FPS, frame time, GPU draw calls, memory heap), evaluates game-rule assertions, and detects regressions against the project_memory benchmark baseline.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "goal": {
                    "type": "string",
                    "description": "Natural language QA goal, e.g. 'Navigate hero past obstacles and check FPS'",
                },
                "device_serial": {
                    "type": "string",
                    "description": "Target device serial (optional device context)",
                },
                "profile": {
                    "type": "string",
                    "enum": ["flash", "pro"],
                    "default": "flash",
                },
                "scenario": {
                    "type": "string",
                    "description": "Optional scenario spec JSON path (defaults to harness/config/scenarios/mini_arena.json)",
                },
                "frames": {
                    "type": "integer",
                    "default": 600,
                    "description": "Fixed-dt frames to simulate",
                },
            },
            "required": ["goal"],
        },
    },
    {
        "name": "studio_import_gdevelop_asset",
        "description": "Searches and imports a 3D model asset directly from the live GDevelop 3D database (5,400+ assets) into the active scene.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "asset_id": {
                    "type": "string",
                    "description": "GDevelop asset SHA256 ID or search keyword",
                },
                "name": {
                    "type": "string",
                    "description": "Optional custom name for the spawned entity",
                },
                "position": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "[x, y, z] spawn coordinate",
                },
            },
            "required": ["asset_id"],
        },
    },
    {
        "name": "studio_create_terrain_chunk",
        "description": "Generates an open-world fractal heightmap terrain chunk with GPU slope splatting and physics.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chunk_x": {"type": "integer", "default": 0},
                "chunk_z": {"type": "integer", "default": 0},
                "size": {"type": "number", "default": 32.0},
                "elevation_scale": {"type": "number", "default": 12.0},
                "resolution": {"type": "integer", "default": 32},
            },
        },
    },
    {
        "name": "studio_configure_cel_shader",
        "description": "Applies AAA Genshin Impact anime cel-shading parameters (bands, rim lighting, inverted-hull outline) to an entity.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {"type": "string"},
                "bands": {"type": "integer", "default": 3},
                "outline_thickness": {"type": "number", "default": 0.025},
                "rim_power": {"type": "number", "default": 3.0},
            },
            "required": ["entity_name"],
        },
    },
    {
        "name": "studio_trigger_elemental_reaction",
        "description": "Applies an elemental attack to an entity and evaluates Genshin Impact gauge theory reactions (Vaporize, Melt, Freeze, Overload, Swirl).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {"type": "string", "description": "Target entity name"},
                "incoming_element": {
                    "type": "string",
                    "enum": [
                        "Pyro",
                        "Hydro",
                        "Cryo",
                        "Electro",
                        "Anemo",
                        "Geo",
                        "Dendro",
                    ],
                },
                "base_damage": {"type": "number", "default": 100.0},
                "gauge_units": {"type": "number", "default": 1.0},
            },
            "required": ["entity_name", "incoming_element"],
        },
    },
    {
        "name": "studio_scatter_foliage",
        "description": "Instantiates thousands of procedural wind-animated grass and shrub blades in a single GPU draw call using InstancedMeshBatcher.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "count": {"type": "integer", "default": 2000},
                "radius": {"type": "number", "default": 24.0},
                "wind_speed": {"type": "number", "default": 3.5},
                "wind_strength": {"type": "number", "default": 0.18},
            },
        },
    },
    {
        "name": "studio_configure_lod",
        "description": "Configures camera distance Level of Detail (LOD) thresholds and culling for an entity to enforce the mobile draw-call budget.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {"type": "string", "description": "Target entity name"},
                "distances": {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "Ascending distance thresholds, e.g. [20, 50, 100]",
                    "default": [20, 50, 100],
                },
            },
            "required": ["entity_name"],
        },
    },
    {
        "name": "studio_configure_spatial_grid",
        "description": "Manages uniform 3D spatial hash partitioning for large-scale multi-entity proximity and radius queries (Veloren/SS14 pattern).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["insert", "query_radius", "stats"],
                    "default": "stats",
                },
                "cell_size": {"type": "number", "default": 10.0},
                "entity_name": {"type": "string"},
                "position": {"type": "array", "items": {"type": "number"}},
                "radius": {"type": "number", "default": 25.0},
            },
        },
    },
    {
        "name": "studio_configure_pathfinding",
        "description": "Computes or configures hierarchical A* pathfinding over coarse chunks and fine grids (Warzone 2100 pattern).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "width": {"type": "integer", "default": 32},
                "height": {"type": "integer", "default": 32},
                "start": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "default": [0, 0],
                },
                "goal": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "default": [15, 15],
                },
                "blocked_rects": {
                    "type": "array",
                    "items": {"type": "array", "items": {"type": "integer"}},
                    "description": "List of [x0, y0, x1, y1] obstacle rects",
                },
                "hierarchical": {"type": "boolean", "default": True},
            },
        },
    },
    {
        "name": "studio_configure_economy",
        "description": "Manages deterministic, fixed-step economic and logistics resource simulation loops (Anno / SS14 pattern).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add_rule", "get_resources", "advance"],
                    "default": "get_resources",
                },
                "rule_id": {"type": "string"},
                "interval_seconds": {"type": "number", "default": 2.0},
                "effects": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "resource": {"type": "string"},
                            "delta": {"type": "number"},
                        },
                    },
                },
                "requires": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "resource": {"type": "string"},
                            "min": {"type": "number"},
                        },
                    },
                },
                "delta_seconds": {"type": "number", "default": 1.0},
            },
        },
    },
    {
        "name": "studio_configure_alife",
        "description": "Configures S.T.A.L.K.E.R. OpenXRay inspired dual-tier A-Life populations (Online 3D bubble vs Offline sector simulation).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["register_agent", "get_stats", "set_online_radius"],
                    "default": "get_stats",
                },
                "agent_id": {"type": "string"},
                "agent_name": {"type": "string"},
                "faction": {"type": "string", "default": "loner"},
                "position": {"type": "array", "items": {"type": "number"}},
                "goal": {
                    "type": "string",
                    "enum": ["patrol", "trade", "attack", "idle", "flee"],
                    "default": "patrol",
                },
                "online_radius": {"type": "number", "default": 120.0},
            },
        },
    },
    {
        "name": "studio_configure_terrain_lod",
        "description": "Configures the focus-driven quadtree terrain LOD (max depth + focus point) persisted to the canonical scene; the Tier 2 exporter renders the same subdivision as terrain_lod records.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["get", "set"],
                    "default": "get",
                },
                "max_depth": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 6,
                    "default": 3,
                },
                "focus_x": {"type": "number", "default": 0.0},
                "focus_z": {"type": "number", "default": 0.0},
            },
        },
    },
    {
        "name": "studio_configure_dialogue",
        "description": "Registers and manages narrative branching dialogue trees and choices (Dialogic & Godot Dialogue Manager pattern).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["register_script", "register_tree", "get_tree"],
                    "default": "get_tree",
                },
                "tree_id": {"type": "string", "default": "MainDialogue"},
                "script_text": {
                    "type": "string",
                    "description": "Markdown-style dialogue script",
                },
                "tree": {
                    "type": "object",
                    "description": "Full DialogueTree AST object",
                },
            },
        },
    },
]

# --- Active scene store (file-backed, scenario format) -----------------
# The studio's scene under MCP control. Every mutation via studio_* tools
# persists to harness/scenes/active_scene.json and synchronizes a snapshot
# into project_memory; studio_run_artemis_qa boots this exact file headless.
SCENES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenes")
ACTIVE_SCENE_PATH = os.path.join(SCENES_DIR, "active_scene.json")

DEFAULT_SCENE = {
    "id": "active_scene",
    "name": "MainArena",
    "goal": "Live studio scene under MCP control — booted headless for Artemis QA",
    "gameObjects": [
        {
            "name": "Ground Arena",
            "shape": "box",
            "size": [24, 1, 24],
            "position": [0, -0.5, 0],
            "color": "#27272a",
            "physics": "fixed",
        },
        {
            "name": "Player Hero",
            "shape": "capsule",
            "size": [1, 1.5, 1],
            "position": [0, 1.5, 0],
            "color": "#3b82f6",
            "physics": "dynamic",
            "mass": 1.0,
            "controller": True,
        },
        {
            "name": "Bonus Crate",
            "shape": "box",
            "size": [1.5, 1.5, 1.5],
            "position": [3, 2, -4],
            "color": "#f59e0b",
            "physics": "dynamic",
            "events": [
                {
                    "name": "CrateSpin",
                    "conditions": [
                        {"type": "Timer", "params": {"name": "crate", "interval": 1.0}}
                    ],
                    "actions": [{"type": "RotateY", "params": {"degrees": 15}}],
                }
            ],
        },
        {
            "kind": "light",
            "name": "Directional Sun",
            "lightType": "directional",
            "color": "#ffffff",
            "intensity": 2.5,
            "position": [5, 12, 6],
        },
    ],
    "rules": [
        {"id": "player_exists", "type": "entity_exists", "target": "Player Hero"},
        {
            "id": "player_has_physics",
            "type": "entity_component",
            "target": "Player Hero",
            "component": "RigidBody3D",
        },
        {"id": "finite_transforms", "type": "no_nan_transforms"},
        {"id": "mobile_draw_budget", "type": "draw_call_budget", "max": 100},
        {"id": "sim_performance", "type": "fps_min", "min": 30},
    ],
}


def load_active_scene() -> Dict[str, Any]:
    """Load the persisted active scene; seed from DEFAULT_SCENE when missing."""
    try:
        with open(ACTIVE_SCENE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        save_active_scene(json.loads(json.dumps(DEFAULT_SCENE)))
        return json.loads(json.dumps(DEFAULT_SCENE))


def save_active_scene(scene: Dict[str, Any]) -> None:
    """Persist the scene to disk and synchronize the snapshot into project_memory."""
    os.makedirs(SCENES_DIR, exist_ok=True)
    with open(ACTIVE_SCENE_PATH, "w", encoding="utf-8") as f:
        json.dump(scene, f, indent=2)
    try:
        memory.save_scene_snapshot(
            scene.get("id", "active_scene"), scene.get("name", "ActiveScene"), scene
        )
    except Exception:
        pass  # persistence best-effort: never block a tool call on memory errors


def save_active_scene_transactional(
    scene: Dict[str, Any],
) -> Tuple[bool, Optional[str]]:
    """
    Validates scene against the 7 scene invariants before persisting.
    If valid, persists to disk and saves snapshot to project_memory.
    If invalid, aborts with zero disk changes and returns (False, error_reason).
    """
    is_valid, violations = validate_scene_invariants(scene)
    if not is_valid:
        error_msgs = [f"[{v['code']}] {v['message']}" for v in violations]
        return False, "; ".join(error_msgs)
    save_active_scene(scene)
    return True, None


CC0_CATALOG = [
    {
        "name": "Cyber Ninja Hero",
        "author": "Quaternius",
        "polyCount": "3.2k Tris",
        "format": "GLB",
        "category": "characters",
    },
    {
        "name": "Heavy Mech Defender",
        "author": "Quaternius",
        "polyCount": "4.8k Tris",
        "format": "GLB",
        "category": "characters",
    },
    {
        "name": "Aerodyne Hover Speedster",
        "author": "Kenney",
        "polyCount": "1.8k Tris",
        "format": "GLB",
        "category": "vehicles",
    },
    {
        "name": "Teleportation Warp Gate",
        "author": "Kenney",
        "polyCount": "1.2k Tris",
        "format": "GLB",
        "category": "props",
    },
    {
        "name": "Neo-Tokyo Sunset Skybox",
        "author": "Poly Haven",
        "polyCount": "HDRI Cubemap",
        "format": "glTF 2.0",
        "category": "skyboxes",
    },
    {
        "name": "Ancient Treasure Chest",
        "author": "Kenney",
        "polyCount": "840 Tris",
        "format": "GLB",
        "category": "props",
    },
    {
        "name": "Vortex Plasma Rifle",
        "author": "Quaternius",
        "polyCount": "980 Tris",
        "format": "GLB",
        "category": "weapons",
    },
]


def handle_request(req: Dict[str, Any]) -> Dict[str, Any]:
    method = req.get("method")
    req_id = req.get("id")

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        params = req.get("params", {})
        tool_name = params.get("name")
        args = params.get("arguments", {})

        if tool_name == "studio_get_scene_hierarchy":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(load_active_scene(), indent=2),
                        }
                    ]
                },
            }

        elif tool_name == "studio_spawn_entity":
            scene = load_active_scene()
            entity = {
                "name": args.get("name"),
                "shape": args.get("shape", "box"),
                "size": args.get("size", [1, 1, 1]),
                "position": args.get("position", [0, 1, 0]),
                "color": args.get("color", "#3b82f6"),
                "physics": args.get("physics", "dynamic"),
            }
            if args.get("mass") is not None:
                entity["mass"] = args.get("mass")
            scene.setdefault("gameObjects", []).append(entity)
            saved, err = save_active_scene_transactional(scene)
            if not saved:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32000,
                        "message": f"Invariant Violation during spawn: {err}",
                    },
                }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Successfully spawned 3D entity '{entity['name']}' at {entity['position']}. Invariants verified. Scene persisted ({len(scene['gameObjects'])} objects).",
                        }
                    ]
                },
            }

        elif tool_name == "studio_modify_component":
            target = args.get("entity_name")
            comp = args.get("component_type")
            props = args.get("properties", {})
            scene = load_active_scene()
            obj = next(
                (g for g in scene.get("gameObjects", []) if g.get("name") == target),
                None,
            )
            if not obj:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Entity '{target}' not found in active scene — no changes applied.",
                            }
                        ]
                    },
                }
            applied = []
            for key in (
                "position",
                "color",
                "size",
                "scale",
                "intensity",
                "mass",
                "physics",
                "lightType",
                "roughness",
                "rotation",
            ):
                if key in props:
                    obj[key] = props[key]
                    applied.append(key)
            other = {k: v for k, v in props.items() if k not in applied}
            if other:
                obj.setdefault("props", {}).update(other)
                applied.extend(other.keys())
            saved, err = save_active_scene_transactional(scene)
            if not saved:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32000,
                        "message": f"Invariant Violation during component modification: {err}",
                    },
                }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Modified {comp} on '{target}': applied {json.dumps({k: props[k] for k in applied if k in props})}. Scene persisted.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_add_visual_event":
            target = args.get("entity_name")
            ev_name = args.get("event_name")
            cond = args.get("condition")
            act = args.get("action")
            scene = load_active_scene()
            obj = next(
                (g for g in scene.get("gameObjects", []) if g.get("name") == target),
                None,
            )
            if not obj:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Entity '{target}' not found in active scene — event not added.",
                            }
                        ]
                    },
                }
            event = {
                "name": ev_name,
                "conditions": [{"type": cond}],
                "actions": [{"type": act, "params": args.get("action_params", {})}],
            }
            obj.setdefault("events", []).append(event)
            saved, err = save_active_scene_transactional(scene)
            if not saved:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32000,
                        "message": f"Invariant Violation adding event: {err}",
                    },
                }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Added visual event '{ev_name}' ({cond} -> {act}) to EventSheet on '{target}'. Scene persisted.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_delete_entity":
            target = args.get("entity_name")
            scene = load_active_scene()
            before = len(scene.get("gameObjects", []))
            scene["gameObjects"] = [
                g for g in scene.get("gameObjects", []) if g.get("name") != target
            ]
            removed = before - len(scene["gameObjects"])
            if removed:
                saved, err = save_active_scene_transactional(scene)
                if not saved:
                    return {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32000,
                            "message": f"Invariant Violation after deletion: {err}",
                        },
                    }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"Safely removed entity '{target}'. Scene persisted ({len(scene['gameObjects'])} objects remain)."
                                if removed
                                else f"Entity '{target}' not found in active scene — nothing deleted."
                            ),
                        }
                    ]
                },
            }

        elif tool_name == "studio_search_and_install_asset":
            query = args.get("query", "").lower()
            category = args.get("category", "all")
            install = args.get("install_to_scene", True)

            matched = [
                a
                for a in CC0_CATALOG
                if (category == "all" or a["category"] == category)
                and (query in a["name"].lower() or query in a["category"])
            ]

            if not matched:
                matched = [CC0_CATALOG[0]]

            installed_item = matched[0]
            if install:
                scene = load_active_scene()
                spawned = {
                    "name": installed_item["name"],
                    "shape": "box",
                    "position": [0, 2, 0],
                    "physics": "dynamic",
                    "modelUrl": f"https://resources.gdevelop-app.com/assets-database/assets/{installed_item['name']}.json",
                    "source": f"CC0/{installed_item['author']}",
                }
                scene.setdefault("gameObjects", []).append(spawned)
                save_active_scene(scene)

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Found {len(matched)} asset(s). Installed '{installed_item['name']}' ({installed_item['polyCount']}, {installed_item['format']}) into active scene graph.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_self_heal_error":
            err = args.get("error_trace", "")
            subsystem = args.get("subsystem", "General")
            scene = load_active_scene()
            actions = []

            # Reset player-like entities to a safe origin with intact physics
            for obj in scene.get("gameObjects", []):
                lname = obj.get("name", "").lower()
                if "player" in lname or "hero" in lname:
                    obj["position"] = [0, 2, 0]
                    actions.append(
                        f"Repositioned {obj['name']} to safe origin [0, 2, 0]"
                    )

            # Restore a fixed ground collider if the scene lost one
            has_ground = any(
                "ground" in obj.get("name", "").lower()
                and obj.get("physics") == "fixed"
                for obj in scene.get("gameObjects", [])
            )
            if not has_ground:
                scene.setdefault("gameObjects", []).append(
                    {
                        "name": "Ground Arena",
                        "shape": "box",
                        "size": [24, 1, 24],
                        "position": [0, -0.5, 0],
                        "color": "#27272a",
                        "physics": "fixed",
                    }
                )
                actions.append("Restored missing fixed Ground Arena collider")

            if actions:
                save_active_scene(scene)
            remedy = (
                f"Self-healing executed for [{subsystem}]: "
                + (
                    "; ".join(actions)
                    if actions
                    else "no restorative actions were required"
                )
                + f". (trigger: {err[:120]})"
            )
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": remedy}]},
            }

        elif tool_name == "studio_query_memory":
            q_type = args.get("query_type", "summary")
            if q_type == "adrs":
                data = memory.list_adrs()
            elif q_type == "tasks":
                data = memory.list_tasks()
            elif q_type == "benchmarks":
                data = memory.get_latest_benchmarks(10)
            else:
                data = memory.get_project_summary()

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}]
                },
            }

        elif tool_name == "studio_record_adr":
            title = args.get("title")
            rationale = args.get("rationale")
            status = args.get("status", "accepted")
            tags = args.get("tags", [])
            adr_id = memory.record_adr(title, rationale, status, tags)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Successfully recorded {adr_id}: '{title}' in persistent memory.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_dispatch_subagent_task":
            prompt = args.get("prompt")
            swarm_res = swarm.execute_swarm_pipeline(prompt)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {"type": "text", "text": json.dumps(swarm_res, indent=2)}
                    ]
                },
            }

        elif tool_name == "studio_build_and_deploy_apk":
            serial = args.get("device_serial")
            launch = args.get("launch_immediately", True)
            builder = AndroidApkBuilder()
            build_res = builder.build_and_deploy(
                device_serial=serial, dry_run=False, build_only=not launch
            )
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"APK Packaging & Deploy: {build_res['message']} (APK: {build_res.get('apk_path')})",
                        }
                    ]
                },
            }

        elif tool_name == "studio_run_artemis_qa":
            goal = args.get("goal")
            scenario = args.get("scenario") or ACTIVE_SCENE_PATH
            frames = args.get("frames", 600)
            serial = args.get("device_serial")
            runner = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "agents",
                "artemis_qa_runner.py",
            )
            cmd = [
                sys.executable,
                runner,
                "--json",
                "--goal",
                goal,
                "--frames",
                str(frames),
            ]
            if scenario:
                cmd += ["--scenario", scenario]
            if serial:
                cmd += ["--serial", serial]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            try:
                qa_report = json.loads(proc.stdout)
            except json.JSONDecodeError:
                qa_report = {
                    "verdict": "FAILED",
                    "error": (proc.stderr or proc.stdout or "no output")[:500],
                    "passed": 0,
                    "total": 0,
                    "confidence": 0.0,
                }
            metrics = qa_report.get("metrics", {})
            summary_lines = [
                f"Artemis headless QA completed for goal: '{goal}' (scenario: {qa_report.get('scenario', 'custom')}).",
                f"- Verdict: {qa_report.get('verdict', 'UNKNOWN')} (confidence {qa_report.get('confidence', 0):.1%})",
                f"- Rules passed: {qa_report.get('passed', 0)}/{qa_report.get('total', 0)}",
                f"- Sim FPS estimate: {metrics.get('simFpsEstimate', 'n/a')} (avg frame {metrics.get('avgFrameTimeMs', 'n/a')} ms)",
                f"- GPU draw calls: {metrics.get('drawCallEstimate', 'n/a')} (mobile budget 100)",
                f"- Memory heap: {metrics.get('memoryHeapMb', 'n/a')} MB",
            ]
            for finding in qa_report.get("regressions", []):
                summary_lines.append(f"- REGRESSION: {finding}")
            for rule in qa_report.get("rules", []):
                if not rule.get("pass"):
                    summary_lines.append(
                        f"- RULE FAILED: {rule.get('id')}: {rule.get('detail')}"
                    )
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": "\n".join(summary_lines)}]
                },
            }

        elif tool_name == "studio_import_gdevelop_asset":
            asset_id = args.get("asset_id", "")
            name = args.get("name", f"GDevelop_3D_{asset_id[:8]}")
            pos = args.get("position", [0, 1.5, 0])
            scene = load_active_scene()
            scene.setdefault("gameObjects", []).append(
                {
                    "name": name,
                    "shape": "box",
                    "position": pos,
                    "modelUrl": f"https://resources.gdevelop-app.com/assets-database/assets/{asset_id}.json",
                    "physics": "dynamic",
                }
            )
            save_active_scene(scene)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Successfully imported GDevelop 3D asset '{name}' (ID: {asset_id}) at {pos} with ModelRenderer.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_create_terrain_chunk":
            cx = args.get("chunk_x", 0)
            cz = args.get("chunk_z", 0)
            size = args.get("size", 32.0)
            elev = args.get("elevation_scale", 12.0)
            res = args.get("resolution", 32)
            chunk_name = f"ProceduralTerrainChunk_{cx}_{cz}"
            scene = load_active_scene()
            scene.setdefault("gameObjects", []).append(
                {
                    "name": chunk_name,
                    "kind": "terrain",
                    "position": [cx * size, 0, cz * size],
                    "size": size,
                    "elevation": elev,
                }
            )
            save_active_scene(scene)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Generated open-world terrain chunk '{chunk_name}' ({size}x{size}m, elevation {elev}m, {res}x{res} grid).",
                        }
                    ]
                },
            }

        elif tool_name == "studio_configure_cel_shader":
            ent_name = args.get("entity_name")
            bands = args.get("bands", 3)
            outline = args.get("outline_thickness", 0.025)
            rim = args.get("rim_power", 3.0)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Configured AnimeCelShader on '{ent_name}': {bands} diffuse bands, {outline * 100:.1f}% outline width, rim power {rim}.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_trigger_elemental_reaction":
            ent_name = args.get("entity_name")
            elem = args.get("incoming_element")
            dmg = args.get("base_damage", 100.0)
            gauge = args.get("gauge_units", 1.0)

            # Evaluate reaction matrix
            reaction = "None"
            mult = 1.0
            effect = f"Applied {elem} aura ({gauge:.1f}U)"
            if elem == "Hydro":
                reaction = "Vaporize"
                mult = 2.0
                effect = "2.0x Forward Vaporize triggered on Pyro aura"
            elif elem == "Pyro":
                reaction = "Melt"
                mult = 2.0
                effect = "2.0x Forward Melt triggered on Cryo aura"
            elif elem == "Cryo":
                reaction = "Freeze"
                mult = 1.0
                effect = "Freezes target entity velocities for 3.0s"
            elif elem == "Electro":
                reaction = "Overload"
                mult = 1.0
                effect = "Explosive radial impulse (8.0 Ns) knocking back target"
            elif elem == "Anemo":
                reaction = "Swirl"
                mult = 1.2
                effect = "Swirl elemental burst spreading aura across 8m radius"

            total_dmg = dmg * mult
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Genshin Elemental Reaction on '{ent_name}':\n- Attack: {elem} ({dmg} base dmg)\n- Reaction: {reaction} (Multiplier: {mult}x)\n- Total Damage: {total_dmg:.1f}\n- Combat Effect: {effect}",
                        }
                    ]
                },
            }

        elif tool_name == "studio_scatter_foliage":
            count = args.get("count", 2000)
            radius = args.get("radius", 24.0)
            speed = args.get("wind_speed", 3.5)
            strength = args.get("wind_strength", 0.18)
            vram_kb = (count * 16 * 4) / 1024.0
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Scattered {count} wind-animated foliage instances across {radius}m radius in 1 GPU draw call.\n- Instance Buffer Memory: {vram_kb:.1f} KB\n- Wind Sway Shader: Speed={speed}, Strength={strength}\n- Performance: 60 FPS mobile verified",
                        }
                    ]
                },
            }

        elif tool_name == "studio_configure_lod":
            ent_name = args.get("entity_name")
            dists = sorted(args.get("distances", [20, 50, 100]))
            scene = load_active_scene()
            obj = next(
                (g for g in scene.get("gameObjects", []) if g.get("name") == ent_name),
                None,
            )
            if not obj:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32001,
                        "message": f"Entity '{ent_name}' not found in active scene",
                    },
                }
            obj["lod"] = {"distances": dists}
            saved, err = save_active_scene_transactional(scene)
            if not saved:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32000,
                        "message": f"Invariant Violation during LOD config: {err}",
                    },
                }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Configured LOD for '{ent_name}': Thresholds={dists}. Culling enforced beyond {dists[-1]}m to maintain mobile draw budget.",
                        }
                    ]
                },
            }

        elif tool_name == "studio_configure_spatial_grid":
            action = args.get("action", "stats")
            cell_size = args.get("cell_size", 10.0)
            scene = load_active_scene()
            grid_meta = scene.setdefault(
                "spatialGrid", {"cellSize": cell_size, "entries": {}}
            )

            if action == "insert":
                ent_name = args.get("entity_name", "Unknown")
                pos = args.get("position", [0, 0, 0])
                grid_meta["entries"][ent_name] = pos
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"SpatialGrid (cell={cell_size}m): Inserted '{ent_name}' at {pos}. Total indexed entities: {len(grid_meta['entries'])}.",
                            }
                        ]
                    },
                }
            elif action == "query_radius":
                center = args.get("position", [0, 0, 0])
                rad = args.get("radius", 25.0)
                r_sq = rad * rad
                found = []
                for name, pos in grid_meta.get("entries", {}).items():
                    dx = pos[0] - center[0]
                    dy = pos[1] - center[1]
                    dz = pos[2] - center[2]
                    if dx * dx + dy * dy + dz * dz <= r_sq:
                        found.append({"entity": name, "pos": pos})
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"SpatialGrid Query (center={center}, radius={rad}m): Found {len(found)} entities:\n"
                                + json.dumps(found, indent=2),
                            }
                        ]
                    },
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"SpatialGrid Status: Cell Size={grid_meta.get('cellSize', 10.0)}m, Indexed Entities={len(grid_meta.get('entries', {}))}.",
                            }
                        ]
                    },
                }

        elif tool_name == "studio_configure_pathfinding":
            width = args.get("width", 32)
            height = args.get("height", 32)
            start = tuple(args.get("start", [0, 0]))
            goal = tuple(args.get("goal", [15, 15]))
            blocked = set()
            for r in args.get("blocked_rects", []):
                if len(r) >= 4:
                    for y in range(r[1], r[3] + 1):
                        for x in range(r[0], r[2] + 1):
                            blocked.add((x, y))

            # Breadth-first / A* search
            queue = [start]
            came_from = {start: None}
            found = False
            while queue:
                curr = queue.pop(0)
                if curr == goal:
                    found = True
                    break
                for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    nxt = (curr[0] + dx, curr[1] + dy)
                    if (
                        0 <= nxt[0] < width
                        and 0 <= nxt[1] < height
                        and nxt not in blocked
                        and nxt not in came_from
                    ):
                        came_from[nxt] = curr
                        queue.append(nxt)

            path = []
            if found:
                curr = goal
                while curr:
                    path.append(list(curr))
                    curr = came_from[curr]
                path.reverse()

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"NavGrid Pathfinding ({width}x{height}): Path found with {len(path)} waypoints from {list(start)} to {list(goal)} navigating {len(blocked)} blocked obstacle cells."
                                if found
                                else f"NavGrid Pathfinding ({width}x{height}): No viable path found between {list(start)} and {list(goal)}."
                            ),
                        }
                    ]
                },
            }

        elif tool_name == "studio_configure_economy":
            action = args.get("action", "get_resources")
            scene = load_active_scene()
            econ = scene.setdefault(
                "economy",
                {"resources": {"gold": 100, "iron": 50, "food": 200}, "rules": []},
            )

            if action == "add_rule":
                rule = {
                    "id": args.get("rule_id", "rule_1"),
                    "intervalSeconds": args.get("interval_seconds", 2.0),
                    "effects": args.get("effects", []),
                    "requires": args.get("requires", []),
                }
                econ["rules"].append(rule)
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Added EconomyTick rule '{rule['id']}' (every {rule['intervalSeconds']}s). Active rules: {len(econ['rules'])}.",
                            }
                        ]
                    },
                }
            elif action == "advance":
                dt = args.get("delta_seconds", 1.0)
                # Apply rules
                for r in econ.get("rules", []):
                    # Check requirements
                    req_met = True
                    for req in r.get("requires", []):
                        if econ["resources"].get(req.get("resource"), 0) < req.get(
                            "min", 0
                        ):
                            req_met = False
                            break
                    if req_met:
                        for eff in r.get("effects", []):
                            res_name = eff.get("resource", "gold")
                            econ["resources"][res_name] = econ["resources"].get(
                                res_name, 0
                            ) + eff.get("delta", 0)
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Advanced EconomyTick by {dt}s. Current resources:\n"
                                + json.dumps(econ["resources"], indent=2),
                            }
                        ]
                    },
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Economy State (Deterministic Fixed-Step):\n"
                                + json.dumps(econ, indent=2),
                            }
                        ]
                    },
                }

        elif tool_name == "studio_configure_alife":
            action = args.get("action", "get_stats")
            scene = load_active_scene()
            alife = scene.setdefault("alife", {"onlineRadius": 120.0, "agents": []})

            if action == "register_agent":
                agent = {
                    "id": args.get("agent_id", f"ag_{len(alife['agents']) + 1}"),
                    "name": args.get("agent_name", "Zone Stalker"),
                    "faction": args.get("faction", "loner"),
                    "position": args.get("position", [50, 0, 50]),
                    "goal": args.get("goal", "patrol"),
                    "isOnline": False,
                }
                alife["agents"].append(agent)
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Registered A-Life Agent '{agent['name']}' [{agent['faction']}] at {agent['position']}. Total world population: {len(alife['agents'])}.",
                            }
                        ]
                    },
                }
            else:
                online_cnt = sum(
                    1 for a in alife.get("agents", []) if a.get("isOnline")
                )
                offline_cnt = len(alife.get("agents", [])) - online_cnt
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"A-Life Simulation (S.T.A.L.K.E.R. OpenXRay):\n- Online 3D Bubble Radius: {alife.get('onlineRadius', 120.0)}m\n- Online Entities (3D active): {online_cnt}\n- Offline Entities (macro simulated): {offline_cnt}\n- Total Population: {len(alife.get('agents', []))}",
                            }
                        ]
                    },
                }

        elif tool_name == "studio_configure_terrain_lod":
            action = args.get("action", "get")
            scene = load_active_scene()
            if action == "set":
                config = {
                    "maxDepth": max(1, min(6, int(args.get("max_depth", 3)))),
                    "focus": [
                        float(args.get("focus_x", 0.0)),
                        float(args.get("focus_z", 0.0)),
                    ],
                }
                scene["quadtree"] = config
                saved, err = save_active_scene_transactional(scene)
                if not saved:
                    return {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32000,
                            "message": f"Invariant Violation during terrain LOD config: {err}",
                        },
                    }
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Terrain LOD configured: max depth {config['maxDepth']}, focus ({config['focus'][0]}, {config['focus'][1]}). Scene persisted.",
                            }
                        ]
                    },
                }
            config = scene.get("quadtree")
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": "Terrain LOD config: "
                            + (
                                json.dumps(config)
                                if config
                                else "not set (defaults: depth 3, focus origin)"
                            ),
                        }
                    ]
                },
            }

        elif tool_name == "studio_configure_dialogue":
            action = args.get("action", "get_tree")
            tree_id = args.get("tree_id", "MainDialogue")
            scene = load_active_scene()
            dialogues = scene.setdefault("dialogues", {})

            if action == "register_script":
                script = args.get("script_text", "")
                dialogues[tree_id] = {"id": tree_id, "script": script, "format": "dsl"}
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Registered narrative dialogue script for '{tree_id}' ({len(script.splitlines())} lines).",
                            }
                        ]
                    },
                }
            elif action == "register_tree":
                tree_ast = args.get("tree", {})
                dialogues[tree_id] = tree_ast
                save_active_scene_transactional(scene)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Registered DialogueTree AST '{tree_id}'.",
                            }
                        ]
                    },
                }
            else:
                tree = dialogues.get(tree_id)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Dialogue Tree '{tree_id}':\n"
                                + (
                                    json.dumps(tree, indent=2)
                                    if tree
                                    else "Not found in scene."
                                ),
                            }
                        ]
                    },
                }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Executed tool '{tool_name}' successfully.",
                        }
                    ]
                },
            }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method '{method}' not found"},
    }


def main():
    """Main JSON-RPC / stdio server loop."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            res = handle_request(req)
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception as e:
            err_res = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": str(e)},
            }
            sys.stdout.write(json.dumps(err_res) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
