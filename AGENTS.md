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
│   ├── src/physics/                  # Rapier3D WASM physics world integration
│   └── src/input/                    # Mobile touch joysticks, buttons, and desktop WASD mapping
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
External coding agents can interact with the live studio session via 23 JSON-RPC tools with **zero-mistake transactional invariant verification**.
Scene-mutating tools run the 7-point Scene Invariant Gate (`harness/validation/scene_invariants.py`), persist to `harness/scenes/active_scene.json` (scenario format),
and synchronize a snapshot into `project_memory.py` on every change; the QA tool
boots that exact file headless on the real engine runtime.
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
  1. Finite Transforms (no NaN, null, or Infinity)
  2. Mobile Draw Budget (unbatched meshes <= 100)
  3. Collision Non-Penetration at Spawn (dynamic bodies cannot intersect fixed geometry)
  4. Entity Identity Uniqueness
  5. Component Contract Integrity
  6. Event Target Integrity
  7. Physics Velocity Caps (<= 200 m/s)
- `save_active_scene_transactional`: Automatically rolls back scene modifications if any invariant fails, returning structured feedback to the calling agent.

### Headless QA Pipeline (`harness/agents/`)
- `qa_scenario_runner.mjs`: Node runner that builds a scenario spec into a real `Scene`, initializes Rapier3D WASM physics, steps the `EngineContext` for N fixed-dt frames, and emits a JSON report (metrics + per-rule pass/fail).
- `artemis_qa_runner.py`: Orchestrator — invokes the Node runner, compares metrics against the persisted baseline (FPS drop >20%, frame time rise >20%, draw calls rise >25%, heap rise >30% ⇒ `REGRESSED`), records benchmarks into `project_memory.sqlite`, and writes `harness/artemis_report.json`.
- Scenario specs live in `harness/config/scenarios/`; the live MCP-controlled scene is `harness/scenes/active_scene.json`.

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
