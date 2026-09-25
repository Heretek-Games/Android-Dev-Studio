# Agent & Developer Operating Manual: Heretek 3D Android Studio

Welcome to **Heretek 3D Android Studio**—an in-house desktop game development studio and AI harness tailored for developing, testing, and deploying 3D Android games.

This document is the single source of truth for AI agents (Antigravity, Claude Code, Codex, Cursor) and human engineers working in this codebase.

---

## 🏗️ Architectural Overview

The repository is structured as a TypeScript monorepo with dedicated engine, application, template, and harness layers:

```
Android-Dev-Studio/
├── engine/                           # @heretek/engine: Core 3D Game Engine
│   ├── src/core/                     # Transform, Component, GameObject, Scene, EngineContext
│   ├── src/components/               # MeshRenderer, LightComponent, CameraComponent, RigidBody3D, Collider3D, MobileController
│   ├── src/events/                   # EventSheet visual condition-action interpreter (GDevelop style)
│   ├── src/physics/                  # Rapier3D WASM physics world integration (raycasts w/ normals)
│   ├── src/input/                    # Mobile touch joysticks, buttons, and desktop WASD mapping
│   ├── src/vehicles/                 # VehicleController (Rapier raycast vehicle: suspension, steering, brake)
│   ├── src/ai/                       # BehaviorTree, ALifeSimulator (two-tier), TrafficSystem (ambient traffic/pedestrians)
│   ├── src/spatial/                  # SpatialGrid 3D hash (proximity/radius/AABB queries)
│   ├── src/navigation/               # GridPathfinder + NavGrid (hierarchical A*)
│   ├── src/simulation/               # EconomyTick (fixed-step, frame-rate independent)
│   ├── src/terrain/                  # TerrainChunk, WorldStreamer, HierarchicalStreamingCells (urban clustering + budget-aware draw distance)
│   ├── src/rendering/                # InstancedMeshBatcher, FoliageInstancer, LODManager, DecalDispatcher
│   ├── src/dialogue/                 # DialogueManager (visual nodes, gated choices, script DSL)
│   └── src/combat/, src/weapons/     # Elemental matrix + ballistic WeaponController (hit events)
│
├── app/                              # Desktop Studio UI (Vite + React 18 + TailwindCSS)
│   ├── src/components/               # Viewport3D, Hierarchy, Inspector, EventSheetEditor, AssetBrowser, AIHarnessDock, ArtemisQADock, DeviceBar
│   ├── src/state/                    # StudioState context & provider
│   ├── src/services/                 # AiHarnessService (live LLM client) & GDevelopAssetService
│   └── vite.config.ts                # Dev server config & /api/llm secure proxy
│
├── templates/
│   └── android-container/            # High-performance Android Gradle Template (Tier 1)
│       ├── app/src/main/
│       │   ├── AndroidManifest.xml   # Fullscreen landscape, OpenGL ES 3.0, vibration
│       │   ├── java/                 # MainActivity.kt (Hardware-accelerated WebView, WebViewAssetLoader, AndroidBridge)
│       │   └── assets/game/          # Bundled webgame container with touch HUD
│       └── build.gradle
│
└── harness/                          # AI Harness, Artemis QA & Studio MCP Server
    ├── agents/artemis_qa_runner.py   # Google Artemis autonomous mobile playtesting runner
    ├── mcp_server.py                 # Studio Model Context Protocol server (JSON-RPC stdio)
    └── config/artemis_game_rules.md  # Autonomous QA behavioral guidelines
```

---

## 🛠️ Toolchains & Essential Commands

### Prerequisites
- **Node.js**: v18+ or v20+ (`node -v`, `npm -v`)
- **Python**: 3.10+ (`python3 --version`)
- **Android SDK / ADB**: In `$ANDROID_HOME/platform-tools/adb`
- **OpenCode**: Installed at `/home/linuxbrew/.linuxbrew/bin/opencode`

### Build & Verification Commands

```bash
# 1. Install dependencies across all monorepo workspaces
npm install

# 2. Build the core 3D engine (TypeScript tsc)
npm --workspace=engine run build

# 3. Run engine unit tests (Node.js test runner)
npm test

# 4. Build desktop studio production bundle (Vite)
npm --workspace=app run build

# 5. Build entire project and verify all test suites
npm test && npm run build

# 6. Launch Desktop Studio local development server
npm run dev
# Server runs at: http://localhost:3000
```

---

## 🤖 AI Harness & LLM Endpoint Configuration

Live LLM settings are loaded from `.env.prod`:
- **`LLM_API`**: `https://llm.heretek.one/v1`
- **`LLM_API_KEY`**: `sk-d992...`
- **`LLM_API_MODEL`**: `mimotp/mimo-v2.6-flash` (reasoning model with thought tokens and action schema generation)

The Vite dev server proxies `/api/llm` to `https://llm.heretek.one/v1`, keeping credentials securely managed.

### Studio MCP Tools (`harness/mcp_server.py`)
External coding agents can interact with the live studio session via 23 JSON-RPC tools, with every
scene-mutating tool running the **unit-tested 7-point Scene Invariant Gate**
(`harness/validation/scene_invariants.py`) transactionally. Mutations persist to
`harness/scenes/active_scene.json` (canonical scene) and synchronize a snapshot into
`project_memory.py` on every change; `studio_run_artemis_qa` boots that exact file headless on the
real engine runtime. The Studio UI writes through the same gate via `POST /api/scene`.
1. `studio_get_scene_hierarchy`: Inspect active GameObjects, components, and transforms.
2. `studio_spawn_entity`: Spawn 3D meshes (box, sphere, capsule, etc.) with Rapier3D physics.
3. `studio_modify_component`: Live-tune materials, velocities, light intensity, or controller speed.
4. `studio_add_visual_event`: Wire GDevelop condition-action rules into entity EventSheets.
5. `studio_delete_entity`: Safely remove an entity by name and persist the change.
6. `studio_search_and_install_asset`: Search CC0 3D models (Quaternius, Kenney, Poly Haven) and instantiate to scene.
7. `studio_self_heal_error`: Run autonomous diagnosis and apply corrective restorative patches to corrupted scenes.
8. `studio_build_and_deploy_apk`: Package and launch the hardware-accelerated WebView container on Android.
9. `studio_run_artemis_qa`: Boot the active scene headless (real Rapier3D + EventSheet runtime), evaluate game-rule assertions, record real telemetry (sim FPS, frame time, GPU draw-call estimate, memory heap), and detect regressions against the `project_memory` baseline.
10. `studio_configure_lod`: Configure camera-distance LOD thresholds and enforce mobile draw budget.
11. `studio_configure_spatial_grid`: Query or configure uniform 3D spatial hash partitions (Veloren / SS14 pattern).
12. `studio_configure_pathfinding`: Build navigation grids, obstacle rects, and compute hierarchical A* paths.
13. `studio_configure_economy`: Add deterministic fixed-step economic and logistics resource simulation rules.
14. `studio_configure_alife`: Configure S.T.A.L.K.E.R. OpenXRay inspired dual-tier A-Life populations.
15. `studio_configure_dialogue`: Register and manage branching narrative dialogue trees and scripts.
16. `studio_configure_cel_shader`: Apply Genshin-style anime cel-shading parameters and inverted-hull toon outlines.
17. `studio_trigger_elemental_reaction`: Evaluate Genshin elemental reactions (Vaporize, Melt, Freeze, Overload, Swirl).
18. `studio_scatter_foliage`: Scatter wind-animated foliage in a single GPU draw call.
19. `studio_import_gdevelop_asset`: Import assets directly from GDevelop asset database.
20. `studio_create_terrain_chunk`: Generate fractal heightmap terrain chunks with elevation sampling.
21. `studio_query_memory`: Query ADRs, task DAGs, and QA benchmarks from cross-session memory.
22. `studio_record_adr`: Record an Architectural Decision Record into persistent memory.
23. `studio_dispatch_subagent_task`: Decompose game design prompt and dispatch multi-agent swarm pipeline.

### Deterministic Zero-Mistake Guardrails (`harness/validation/`)
- `scene_invariants.py`: Enforces 7 hard invariants before any mutation is saved:
  1. Finite Transforms (no NaN, Infinity, or invalid vectors in position/rotation/scale)
  2. Mobile Draw Budget (unbatched mesh/model/terrain draws <= 100; `batched` instances excluded)
  3. Collision Non-Penetration at Spawn (dynamic colliders cannot intersect fixed geometry)
  4. Entity Identity Uniqueness (non-empty, unique names)
  5. Component Contract Integrity (shapes, sizes, physics types, light types, masses)
  6. Event Integrity (well-formed conditions/actions of supported types + cross-entity target existence)
  7. Physics Velocity Caps (linear <= 200 m/s, angular <= 100 rad/s)
- Validates the canonical flat scene-store schema and normalizes engine-exported nested
  `transform`/`components` dumps before checking, so both formats share one gate.
- `save_active_scene_transactional`: automatically rolls back any rejected mutation, returning
  structured feedback to the calling agent. **Rollback is unit-tested and E2E-proven**: duplicate-name,
  buried-collider, and invalid-shape spawns are rejected with the scene file byte-identical
  (md5-verified), while valid mutations + delete round-trips restore the same checksum.
- Tests: `python3 -m unittest harness.validation.test_scene_invariants` (24 cases: positive scene,
  one negative per invariant, schema normalization, input immutability).

### Studio ↔ Harness Scene Bridge (`/api/scene`)
- The canonical scene is `harness/scenes/active_scene.json` (source of truth for the studio and agents).
- `GET /api/scene` reads it; `POST /api/scene` writes through the same transactional invariant gate
  and memory snapshot as MCP tools (`harness/agents/scene_store_cli.py` backs the route).
- `app/src/services/SceneStore.ts` performs **read-modify-write against the authoritative file** on
  every mutation, so a studio save can never clobber external (MCP/CLI/agent) changes; invariant
  rejections surface as HTTP 409 + a visible error banner in the docks.
- `app/src/services/HarnessSceneAdapter.ts` builds real engine `Scene` objects from the spec
  (mirroring `qa_scenario_runner.mjs` semantics) plus draw-call estimates, scene bounds, and
  tall-fixed-obstacle footprints for in-studio subsystem analysis.

### Functional Studio Docks (verified in chrome-devtools)
- **Large-Scale World & Sim** (`app/src/components/LargeScaleWorldDock.tsx`): LOD (real `LODManager`
  with the live viewport camera; save per-entity `lod` configs), Spatial Hash (real `SpatialGrid` with
  radius queries), Hierarchical A* (real `NavGrid` from scene geometry with node-expansion stats and
  path-marker spawning), Economy (one persistent deterministic `EconomyTick`), A-Life (real two-tier
  `ALifeSimulator` promoting agents around the live camera).
- **Dialogue & Narrative** (`DialogueEditorDock.tsx`): trees persist to `scene.dialogues`
  (MCP `studio_configure_dialogue` compatible); preview runs the real `DialogueManager` with live
  variable-gated choices (`getAvailableChoices`, comparison operators) and narrative event dispatch.
- **Agent Swarm** (`AgentSwarmDock.tsx`): dispatches the real orchestrator via `POST /api/swarm/run`
  (`harness/agents/swarm_cli.py`); renders the real task DAG, invariant audit, Artemis QA telemetry,
  and ADRs/benchmarks from SQLite. All roles execute real invariant-gated actions: World Designer
  streams terrain chunks, Shader Dev applies cel-shading config, Gameplay Coder wires events —
  no fabricated results.

### Headless QA Pipeline (`harness/agents/`)
- `qa_scenario_runner.mjs`: Node runner that builds a scenario spec into a real `Scene`, initializes Rapier3D WASM physics, steps the `EngineContext` for N fixed-dt frames, and emits a JSON report (metrics + per-rule pass/fail). GameObjects support `vehicle` configs (Rapier raycast vehicle + throttle/steering/brake inputs) and `events`/`controller` components.
- Rule vocabulary: `entity_exists`, `entity_component`, `event_attached`, `object_count`, `transform_changes`, `transform_bounds`, `distance_traveled`, `speed_min`, `no_nan_transforms`, `draw_call_budget`, `fps_min`.
- `artemis_qa_runner.py`: Orchestrator — invokes the Node runner, compares metrics against the persisted baseline (FPS drop >20%, frame time rise >20%, draw calls rise >25%, heap rise >30% ⇒ `REGRESSED`), records benchmarks into `project_memory.sqlite`, and writes `harness/artemis_report.json`.
- Scenario specs live in `harness/config/scenarios/` (e.g. `mini_arena.json`, `driving_course.json`); the live MCP-controlled scene is `harness/scenes/active_scene.json`.

---

## 🧪 Testing Guidelines for Agents

### 1. Engine Core Automated Tests
Always execute unit tests before and after making changes to `@heretek/engine`:
```bash
npm test
```
Test files reside in `engine/src/**/*.test.ts` using `node:test` and `node:assert`.

### 2. WebUI Testing with `chrome-devtools` MCP
When testing frontend UI modifications:
1. Start the Vite server: `npm run dev`.
2. Use the lazy `chrome-devtools` MCP tools:
   - `navigate_page` to `http://localhost:3000`.
   - `list_console_messages` to verify zero WebGL or runtime uncaught exceptions.
   - `click` to test play mode buttons, tab switches, and entity selection.
   - `take_screenshot` to visually inspect rendered 3D meshes and gizmos.

### 3. Autonomous Game QA (real headless engine runs)
Boot a scenario on the real engine runtime (Rapier3D + EventSheet + fixed-dt frame
stepping) and get real telemetry plus rule evaluation:
```bash
# Live MCP-controlled scene (harness/scenes/active_scene.json)
python3 harness/agents/artemis_qa_runner.py --goal "Verify player physics and spin events"

# A named scenario spec
python3 harness/agents/artemis_qa_runner.py --goal "Mini arena QA" --scenario harness/config/scenarios/mini_arena.json --frames 600
```
- Verdicts: `SUCCEEDED` / `REGRESSED` (metrics worse than the same-scenario baseline:
  FPS −20%, frame time +20%, draw calls +25%, heap +30%) / `FAILED` (rule assertions).
- Reports: `harness/artemis_report.json`; benchmarks persist to `harness/project_memory.sqlite`
  (baselines are only compared within the same scenario).
- From the Studio UI: the Artemis dock calls `POST /api/qa/run` (Vite dev-server bridge in
  `app/vite.config.ts`) — never simulated telemetry.
- On-device touch automation still follows the **Dynamic-First, Coordinate-Fallback** locator
  pattern documented in [`harness/config/artemis_game_rules.md`](file:///home/john/Projects/Android-Dev-Studio/harness/config/artemis_game_rules.md).

### 4. OpenCode Delegation for Token Savings
To conserve subscription credits, Antigravity should delegate file generation, repetitive refactoring, and boilerplate implementation to OpenCode via `opencode-mcp` tools (`opencode_run`, `opencode_fire`, `opencode_review_changes`). Antigravity acts as the architect and reviewer.

---

## 📜 Coding Conventions & Invariants
- **TypeScript**: Strict mode enabled. Use explicit typings for public APIs and interfaces.
- **Component Lifecycle**: Every game component must inherit from `Component` and adhere to `awake()`, `start()`, `update(dt)`, `lateUpdate(dt)`, `onCollisionEnter()`, and `onDestroy()`.
- **Physics Coordinates**: Rapier3D positions and rotations must synchronize with `GameObject.transform`.
- **Documentation**: Preserve all existing comments and docstrings. Use standard GitHub markdown links with `file://` scheme when referencing files.
