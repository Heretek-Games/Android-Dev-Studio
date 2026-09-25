# Agent & Developer Operating Manual: Heretek 3D Android Studio

Welcome to **Heretek 3D Android Studio**—an in-house desktop game development studio and AI harness tailored for developing, testing, and deploying 3D Android games.

This document is the single source of truth for AI agents (Antigravity, Claude Code, Codex, Cursor) and human engineers working in this codebase.

---

## 📊 Project Status (last verified 2026-09-25)

All four genre milestone sets, the autonomous harness, and both Android containers are
implemented and verified:

- **Engine** — 301 tests / 61 suites green (`npm test`); every logic source file has a companion
  headless `.test.ts` (Zero Untested Code).
- **Harness** — 24 MCP tools behind the transactional 7-point invariant gate; Artemis QA with
  scenario-keyed regression baselines; 50 Python tests (invariants, exporter, apk_builder,
  cross-tier quadtree parity); an **autonomous iterate-until-green loop** (`harness/loop/`)
  that drives generated scenes to QA-verified green with vision critique, regression bisect,
  and a cost/latency dashboard (121 loop tests).
- **Containers** — both tiers assemble real debug APKs and deploy/launch on an attached device.
  Tier 2 is validated on an Android target (emulator): real swapchain, 3 instanced cubes +
  64 terrain LOD leaf draws, `VK_SUCCESS` acquire/submit/present at ~61.5 FPS, rendered output
  confirmed on-display and via in-renderer frame readback — see
  [`harness/runs/RUNS.md`](file:///home/john/Projects/Android-Dev-Studio/harness/runs/RUNS.md) (Run Block 2).
- **Native host checks** — 66 checks (scene loader, culling, terrain meshing/packing, Vulkan projection).
- **Playable slices** — `?play=1` (header **Game**) boots the arena run (menu → waves → HUD →
  win/lose → restart, audio, save/load, real weapon damage; on-device: Victory 200 points);
  `?play=driving` (header **Drive**) boots the driving sprint (auto-cruise vehicle, chase
  camera, distance HUD; on-device: Victory 120.7 m, all wheels grounded);
  `?play=dungeon` (header **Dungeon**) boots the dungeon run (keeper dialogue → Hydro
  blessing → elemental waves → win; QA 11/11 with 2 Vaporize reactions; on-device:
  dialogue + Victory 200 points, 2 kills);
  `?play=city` (header **City**) boots the city run (found the town by clicking plots,
  grow to the target population; QA 7/7; on-device: 3/3 placements, Victory Pop 6/6).

Known gaps and follow-up work are tracked as GitHub issues on
[`Heretek-Games/Android-Dev-Studio`](https://github.com/Heretek-Games/Android-Dev-Studio/issues):

| Issue | Area | Summary |
|-------|------|---------|
| [#1](https://github.com/Heretek-Games/Android-Dev-Studio/issues/1) | Tier 2 | Physical arm64 hardware validation (blocked: no device attached) |
| [#2](https://github.com/Heretek-Games/Android-Dev-Studio/issues/2) | Tier 2 | Terrain visual polish: LOD seams, biome splatting, native foliage wind |
| [#3](https://github.com/Heretek-Games/Android-Dev-Studio/issues/3) | Tier 2 | On-device validation of the 50k-instance compute-culling path |
| [#4](https://github.com/Heretek-Games/Android-Dev-Studio/issues/4) | Tier 1 | In-APK device/QA bridge (packaged studio shows "No device detected") |
| [#5](https://github.com/Heretek-Games/Android-Dev-Studio/issues/5) | Harness | ~~CI emulator smoke test~~ — **done**: `python3 harness/agents/emulator_smoke.py` (verified both tiers PASS) |
| [#6](https://github.com/Heretek-Games/Android-Dev-Studio/issues/6) | Tier 2 | Renderer hardening: per-frame semaphores, swapchain recreation, validation layers |

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
│   ├── src/terrain/                  # TerrainChunk, WorldStreamer, HierarchicalStreamingCells, QuadtreeTerrain (LOD blend + async loading)
│   ├── src/rendering/                # InstancedMeshBatcher, FoliageInstancer, LODManager, DecalDispatcher
│   ├── src/dialogue/                 # DialogueManager (visual nodes, gated choices, script DSL)
│   ├── src/audio/                    # AudioManager (spatial attenuation), AudioBackend/WebAudioBackend
│   ├── src/game/                     # GameFlow, GameSession, GameRuntime, WaveSpawner, DamageRouter, SaveSystem
│   ├── src/ui/                       # GameShell (menu/HUD/pause/win-lose/restart)
│   └── src/combat/, src/weapons/     # Elemental matrix + ballistic WeaponController (hit events)
│
├── app/                              # Desktop Studio UI (Vite + React 18 + TailwindCSS)
│   ├── src/components/               # Viewport3D, Hierarchy, Inspector, EventSheetEditor, AssetBrowser, AIHarnessDock, ArtemisQADock, DeviceBar
│   ├── src/state/                    # StudioState context & provider
│   ├── src/services/                 # AiHarnessService (live LLM client) & GDevelopAssetService
│   └── vite.config.ts                # Dev server config & /api/llm secure proxy
│
├── templates/
│   ├── android-container/            # High-performance Android Gradle Template (Tier 1)
│   │   ├── app/src/main/
│   │   │   ├── AndroidManifest.xml   # Fullscreen landscape, OpenGL ES 3.0, vibration
│   │   │   ├── java/                 # MainActivity.kt (Hardware-accelerated WebView, WebViewAssetLoader, AndroidBridge)
│   │   │   └── assets/game/          # Bundled webgame container with touch HUD
│   │   └── build.gradle
│   └── vulkan-container/             # Tier 2 native Vulkan container (NDK)
│       ├── app/src/main/cpp/         # scene_loader, culling, terrain_mesh (host-tested), vulkan_renderer/swapchain, JNI bridge
│       ├── app/src/main/assets/      # scene.native + SPIR-V shaders exported by harness/build/scene_exporter.py
│       └── app/build.gradle.kts      # externalNativeBuild (arm64-v8a production + x86_64 for emulator validation)
│
└── harness/                          # AI Harness, Artemis QA & Studio MCP Server
    ├── agents/artemis_qa_runner.py   # Google Artemis autonomous mobile playtesting runner
    ├── loop/                         # Autonomous iterate-until-green loop (generate -> QA -> repair)
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

# 7. Harness Python tests (invariants, scene exporter, packaging, cross-tier parity)
python3 -m unittest harness.validation.test_scene_invariants harness.validation.test_quadtree_parity \
  harness.build.test_scene_exporter harness.build.test_apk_builder

# 8. Native host checks (Tier 2 core: loader, culling, terrain meshing, projection)
cd templates/vulkan-container/app/src/main/cpp && \
  g++ -std=c++17 -Wall -Wextra scene_loader.cpp culling.cpp terrain_mesh.cpp tests/native_scene_test.cpp \
  -o /tmp/native_scene_test && /tmp/native_scene_test ../assets/scene.native

# 9. Package a container (real build; installs + launches when a device/emulator is attached)
python3 harness/build/apk_builder.py            # Tier 1 WebView container
python3 harness/build/apk_builder.py --tier2    # Tier 2 native Vulkan container
```

---

## 🤖 AI Harness & LLM Endpoint Configuration

Live LLM settings are loaded from `.env.prod`:
- **`LLM_API`**: `https://llm.heretek.one/v1`
- **`LLM_API_KEY`**: `sk-d992...`
- **`LLM_API_MODEL`**: `mimotp/mimo-v2.6-flash` (reasoning model with thought tokens and action schema generation)

The Vite dev server proxies `/api/llm` to `https://llm.heretek.one/v1`, keeping credentials securely managed.

### Studio MCP Tools (`harness/mcp_server.py`)
External coding agents can interact with the live studio session via 24 JSON-RPC tools, with every
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
8. `studio_build_and_deploy_apk`: Package and launch the hardware-accelerated WebView container on Android (`tier: 2` packages the native Vulkan container: scene export + NDK cross-compile).
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
24. `studio_configure_terrain_lod`: Get/set the focus-driven quadtree terrain LOD config (`scene.quadtree`), shared by the web engine and the Tier 2 native export.

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
- Cross-tier quadtree parity: `python3 -m unittest harness.validation.test_quadtree_parity` compares the
  TS `QuadtreeTerrain` leaves (via `harness/agents/quadtree_cli.mjs`) against the Python exporter's
  subdivision across 5 focus/depth cases (ids, bounds, depth, lod, blend).

### Autonomous Iterate-Until-Green Loop (`harness/loop/`)

The harness no longer stops at one-shot generation: the loop drives a scene to
**QA-verified green** autonomously.

```
LLM (generate | repair) -> parse actions -> apply -> 7-point invariant gate
    -> headless engine QA -> on failure: failing rules + telemetry + scene -> repair
    -> repeat until all acceptance rules pass or the budget is exhausted
```

```bash
# Drive the mini arena to green (live LLM + real engine QA)
python3 -m harness.loop.iterate_loop \
  --goal "Build a mini arena game: ground, player capsule with mobile controls, 6 pillars, 15 spinning coins, sunset light" \
  --scenario harness/config/scenarios/mini_arena.json --max-iterations 4

# Add the vision critique (top-down layout preview -> multimodal model -> repair notes)
python3 -m harness.loop.iterate_loop --goal "..." --scenario ... --vision

# Cost/latency dashboard over all runs
python3 -m harness.loop.report

# Regression bisect: first commit that breaks a scenario (git worktree + QA per step)
python3 -m harness.loop.regression_bisect --good <rev> --bad <rev> \
  --scenario harness/config/scenarios/mini_arena.json
```

- `llm_client.py` — OpenAI-compatible client (.env.prod), token/latency/retry telemetry,
  vision messages (`chat_with_image`).
- `action_applier.py` — pure spawn/light/modify/delete/event/game/dialogue/prefab applier over the flat scene
  schema (incl. `vehicle` with required wheels, `streamer`, and `biome` tags);
  malformed actions become explicit outcomes (repair input), never exceptions.
- `prompts.py` — generation + repair prompts; maps QA rule types onto schema fields
  (`physics` → RigidBody3D, `controller` → MobileController, events → EventSheet,
  `vehicle` → VehicleController, `streamer` → WorldStreamer, `biome` → composition audit).
- `iterate_loop.py` — orchestrator: parse (codeblock/raw/salvaged), gate-before-QA
  (violations skip QA and feed back as failures), budgets (iterations / tokens / wall clock),
  run-log JSON + markdown per run under `harness/runs/loop_runs/`.
- `scene_preview.py` + `vision.py` — deterministic top-down layout PNG; critique via the
  multimodal route (`auto/best-vision`); `critique_frame()` also accepts real rendered frames.
- `regression_bisect.py` — binary search over `(good, bad]` with per-step worktrees.
- `report.py` — dashboard (verdicts, tokens, latency, iterations-to-green).
- `production_run.py` — brief-to-verdict recursive pass: mandatory memory retrieval,
  builder-critic DAG planning, injected build loop, gate judgment (green requires loop
  convergence AND zero failed criteria; otherwise FAILED with defects), scope-reduction
  candidates for unautomatable criteria, DAG task-state ingestion.
- Tests: `python3 -m unittest discover -s harness/loop -p "test_*.py"` (hermetic:
  injected LLM transport / fake QA).

### Game Production Briefs (`harness/briefs/`)

Every prompt compiles into a validated `game_brief.json` before builder work starts:
fantasy, experience, world scope, required systems, look-dev, the Snapdragon 8 Elite /
Android 16 performance contract (60 FPS, ≤100 draw calls, tri/texture/physics/APK
budgets), and a binary acceptance matrix across the five axes. Criteria with `qaRule`
attachments compile to headless-QA runner rules; the rest are critic-owned.

```bash
# Brief-driven production run (records the brief, plans the DAG, runs the loop)
python3 -m harness.loop.production_run --brief harness/briefs/examples/island_collection_quest.json \
  --max-iterations 3 --max-tokens 30000 --frames 300

# Opt-in vision critique inside the Artemis QA runner (advisory; never changes verdicts)
python3 harness/agents/artemis_qa_runner.py --goal "..." --scenario ... --vision
```

- `harness/memory/project_memory.py` — `production_briefs` table: `record_brief`,
  `get_brief`, `list_briefs`, plus `query_production_context()` (brief + ADRs +
  failed tasks + latest QA), the bundle no agent may build without consulting.
- `harness/orchestrator/agent_swarm.py` — `plan_from_brief()` builds one builder task
  plus one dependent critic task per acceptance criterion; `get_ready_tasks()`
  schedules dependency-free pending tasks. Builders never grade their own work.
- Example: `harness/briefs/examples/island_collection_quest.json` (drivable island +
  collection quest; 6 automatable rules, 2 critic-owned).

First live run (2026-09-25): generate (41 actions) → gate rejected a spawn penetration →
repair (1 action: raise the player above the collider) → **QA SUCCEEDED 10/10** in 2
iterations, 6,725 tokens / 27.1s.

### Dev-Server Bridges (`app/vite.config.ts`)
All studio↔harness bridges run through the Vite dev server (dev-only, like `/api/llm`):
- `GET /api/scene` / `POST /api/scene` — canonical scene read/write (invariant-gated, memory-synced).
- `POST /api/qa/run` — real headless Artemis QA pipeline.
- `POST /api/swarm/run` — real multi-agent swarm orchestrator.
- `GET /api/devices` — real ADB device detection (`harness/agents/device_cli.py`); returns the actual
  `adb devices -l` result — the DeviceBar shows "No device detected" when nothing is attached
  (no mocked devices).
- `GET /api/device/screen?serial=` — live device screen PNG (`adb exec-out screencap -p`) for the
  **Device Mirror & Profiler** dock (`DeviceMirrorDock.tsx`, also in the `mobile_qa` preset).
- `POST /api/device/input` — remote input injection (`adb shell input`: tap/swipe/key/text);
  clicking the mirrored screen injects a tap at the mapped device coordinate.
- `GET /api/device/stats?serial=&package=` — parsed on-device profiler telemetry: FPS from
  `gfxinfo framestats` INTENDED_VSYNC deltas (column resolved by header name), jank %,
  p50/p90/p95/p99 frame times, and TOTAL PSS MB.
- `POST /api/deploy` — real packaging through `harness/build/apk_builder.py` (dry-run by default;
  both containers assemble real debug APKs — Tier 1 `app-debug.apk` with the synced web bundle,
  Tier 2 `app-debug.apk` with `libheretek_native.so` + `scene.native` + SPIR-V shaders;
  `{real:true}` builds and **installs + launches on the attached device/emulator**;
  `{tier:2}` targets the native Vulkan container and runs a real NDK cross-compile of
  `libheretek_native.so`); the studio header logs bundle-built/assets-synced/APK-path or
  scene-exported/native-library/scene.native-counts results and explicitly notes when on-device
  deployment is skipped (no device attached).

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
  `ALifeSimulator` promoting agents around the live camera), Streaming Cells (real
  `HierarchicalStreamingCells` with budget-aware level stats), Terrain LOD (real `QuadtreeTerrain`
  focused on the live camera — depth slider, per-LOD leaf distribution, budgeted async load queue;
  Save Config persists `scene.quadtree`, shared with the Tier 2 native export).
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
- Rule vocabulary: `entity_exists`, `entity_component`, `event_attached`, `object_count`, `transform_changes`, `transform_bounds`, `distance_traveled`, `speed_min`, `no_nan_transforms`, `draw_call_budget`, `fps_min`, `traversal_coverage_min`, `streaming_coherence_min`, `biome_coverage_min`, `game_phase`, `game_score_min`, `game_kills_min`, `game_wave_reached`, `game_reactions_min`, `game_enemy_chase_min`, `game_settlement_pop_min`, `game_settlement_gold_min`, `dialogue_reaches`, `dialogue_sets_variable`, `dialogue_event_fired`, `game_save_restore`. Look-dev calibration is loop-emittable via spawn/modify `cel` fields (verified as `AnimeCelShader` components headless).
- `artemis_qa_runner.py`: Orchestrator — invokes the Node runner, compares metrics against the persisted baseline (FPS drop >20%, frame time rise >20%, draw calls rise >25%, heap rise >30% ⇒ `REGRESSED`), records benchmarks into `project_memory.sqlite`, and writes `harness/artemis_report.json`.
- Scenario specs live in `harness/config/scenarios/` (e.g. `mini_arena.json`, `driving_course.json`); the live MCP-controlled scene is `harness/scenes/active_scene.json`.
- Tier 2 scene export: `harness/build/scene_exporter.py` emits `scene.native` (meshes/instances/lights) plus optional focus-driven `terrain_lod` quadtree leaves (`--quadtree --lod-depth N --lod-focus X Z`), consumed by `templates/vulkan-container`.
- Scale/stress validation: `python3 harness/agents/stress_scene_gen.py --count N --out <scene>` generates a
  batched-instance grid, and `apk_builder.py --tier2 --scene <scene>` exports that scene instead of the
  canonical one (10,000 instances → 1 indirect draw, 66 total draws).
- Tier 2 packaging: `python3 harness/build/apk_builder.py --tier2` exports the canonical scene (honoring
  the persisted `scene.quadtree` config) and cross-compiles `libheretek_native.so` (arm64-v8a) with the
  NDK toolchain into `harness/build/tier2-build/`, then assembles `app-debug.apk` with the vendored
  Gradle wrapper (requires a JDK 17-23; the builder auto-detects one and reports honestly when absent).

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

### 3. On-Device Tier 2 Validation (Android emulator or hardware)

Both containers assemble real debug APKs (`python3 harness/build/apk_builder.py [--tier2]`).
Without attached hardware, an emulator works as the validation target:

```bash
# Headless emulator (KVM host). lavapipe gives the guest a working software Vulkan WSI.
Xvfb :99 -screen 0 1920x1080x24 &                # only needed for -gpu host
emulator -avd <name> -no-window -no-audio -no-snapshot -gpu lavapipe &
adb wait-for-device
python3 harness/build/apk_builder.py --tier2      # export scene -> NDK build -> APK -> install + launch
adb logcat -s HeretekTier2                        # scene/draw telemetry + frame counter
```

- The native renderer logs `Scene ready — draws=… terrainLeaves=… terrainVertices=…`,
  `Surface ready (WxH) — swapchain + pipelines created`, a one-shot draw-state line
  (`instances/indirectCmds/terrainDraws`), a frame counter every 300 frames, and any
  Vulkan failure (acquire/submit/present/createSurface).
- `MainActivity` requests a one-shot in-renderer frame readback 2 s after surface
  creation (`nativeCaptureFrame` → `files/native_frame.ppm`); pull it with
  `adb exec-out run-as com.heretek.gamestudio.tier2 cat files/native_frame.ppm`.
  This proves rendered pixels independently of the emulator's display path.
- Verified 2026-09-25: 3 instanced cubes + 64 terrain LOD leaf draws, acquire/submit/
  present `VK_SUCCESS`, steady ~61.5 FPS; full `POST /api/deploy {real:true}` installs
  and launches on the emulator. Run log: `harness/runs/RUNS.md` (Run Block 2).

**One-command smoke test (both containers, GitHub issue #5):**

```bash
python3 harness/agents/emulator_smoke.py                       # boot AVD -> build -> install -> assert
python3 harness/agents/emulator_smoke.py --reuse --skip-build  # against an attached device + existing APKs
```

Asserts Tier 2 (scene + terrain plan, real swapchain, clean acquire/submit/present, an
advancing frame counter, and a non-uniform PPM frame readback) and Tier 1 (bundle load
line, no fatal exceptions); exits non-zero with the failing assertions. 18 unit tests
cover the pure checks (`harness/agents/test_emulator_smoke.py`).

### 4. Autonomous Game QA (real headless engine runs)
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

### 5. OpenCode Delegation for Token Savings
To conserve subscription credits, Antigravity should delegate file generation, repetitive refactoring, and boilerplate implementation to OpenCode via `opencode-mcp` tools (`opencode_run`, `opencode_fire`, `opencode_review_changes`). Antigravity acts as the architect and reviewer.

---

## 📜 Coding Conventions & Invariants
- **TypeScript**: Strict mode enabled. Use explicit typings for public APIs and interfaces.
- **Component Lifecycle**: Every game component must inherit from `Component` and adhere to `awake()`, `start()`, `update(dt)`, `lateUpdate(dt)`, `onCollisionEnter()`, and `onDestroy()`.
- **Physics Coordinates**: Rapier3D positions and rotations must synchronize with `GameObject.transform`.
- **Documentation**: Preserve all existing comments and docstrings. Use standard GitHub markdown links with `file://` scheme when referencing files.
