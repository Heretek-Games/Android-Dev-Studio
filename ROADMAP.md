# Project Roadmap: Heretek 3D Android Studio & AI Harness

A phased roadmap tracking progress from foundational 3D engine systems to AAA-tier mobile production (Genshin Impact, Anno 1800, and Doom 2016 scope).

---

## 🗺️ Milestone Overview

| Milestone | Focus Area | Status | Target Deliverables |
| :--- | :--- | :---: | :--- |
| **Milestone 1** | **3D Engine Core & ECS** | ✅ **Complete** | Spatial Transform hierarchy, GameObject/Component lifecycle, Three.js PBR renderer, Rapier3D WASM physics, Mobile touch input, GDevelop-style visual EventSheets. |
| **Milestone 2** | **Desktop Studio IDE** | ✅ **Complete** | Dockable panel interface (Dockview), 3D Viewport with transform gizmos (Translate/Rotate/Scale), Hierarchy, Inspector, Visual Event Editor, Asset Browser, Device Bar. |
| **Milestone 3** | **Android Mobile Container (Tier 1)** | ✅ **Complete** | Fullscreen landscape activity (`MainActivity.kt`), hardware-accelerated WebView container (`WebViewAssetLoader`), native haptics/vibration and Logcat bridges. |
| **Milestone 4** | **Live LLM AI Harness** | ✅ **Complete** | Integration with live LLM endpoints (`https://llm.heretek.one/v1`, model `mimotp/mimo-v2.6-flash`), real-time prompt-to-scene AST generation, streaming reasoning traces, and self-healing loop. |
| **Milestone 5** | **GDevelop & CC0 3D Asset Store** | ✅ **Complete** | Integrated GDevelop Asset Store CDN, Quaternius 3D characters, Kenney props, and Poly Haven HDRI PBR into Asset Browser with 1-click scene instantiation, Unity package decompression, and Studio MCP integration. |
| **Milestone 6** | **Dual-Tier Native Vulkan Export (Tier 2)** | 🚀 **Active** | Scaffolding Native C++/NDK Vulkan runtime shell (zero WebView) for 60–120 FPS high-draw-call titles (Genshin, Anno, Doom scale). |
| **Milestone 7** | **Artemis QA & OpenCode Delegation** | ✅ **Complete** | Google Artemis autonomous playtesting agent (`artemis_qa_runner.py`), Studio MCP server (`mcp_server.py`) with 8 production tools, and OpenCode delegation bridge (`opencode-mcp`). |

---

## 📋 Detailed Milestone Breakdown

### Milestone 1: 3D Engine Core & ECS (`@heretek/engine`) ✅
- [x] Hierarchical transform matrix calculation with parent-child propagation (`Transform.ts`).
- [x] Unity-like component lifecycle: `awake()`, `start()`, `update(dt)`, `lateUpdate(dt)`, `onCollisionEnter()`, `onDestroy()` (`Component.ts`, `GameObject.ts`).
- [x] Three.js PBR mesh rendering with Box, Sphere, Cylinder, Capsule, Plane, Torus geometries and shadows (`MeshRenderer.ts`).
- [x] Lighting system with Directional, Point, Ambient, and Spot lights (`LightComponent.ts`).
- [x] Perspective and Orthographic camera controllers (`CameraComponent.ts`).
- [x] `@dimforge/rapier3d-compat` WebAssembly physics integration with dynamic, fixed, and kinematic bodies (`PhysicsWorld.ts`, `RigidBody3D.ts`, `Collider3D.ts`).
- [x] Virtual mobile touch joystick, jump buttons, and desktop WASD mapping (`MobileInput.ts`, `MobileController.ts`).
- [x] Visual condition-action event interpreter for GDevelop-style no-code game logic (`EventSheet.ts`).
- [x] Automated unit test suite passing with 100% success rate (`Scene.test.ts`).

### Milestone 2: Desktop Studio IDE (`app`) ✅
- [x] Dark-themed desktop UI layout using Vite, React 18, and TailwindCSS.
- [x] Interactive 3D Viewport with orbit camera navigation, coordinate axes, and selection bounding boxes (`Viewport3D.tsx`).
- [x] Transform gizmos for Translate, Rotate, and Scale modes.
- [x] Scene Hierarchy tree view with 1-click entity creation dropdown (`Hierarchy.tsx`).
- [x] Property Inspector with live editing of transforms, PBR materials, physics bodies, and mobile joysticks (`Inspector.tsx`).
- [x] GDevelop visual condition-action event sheet editor (`EventSheetEditor.tsx`).
- [x] Project asset browser supporting glTF 2.0 models, textures, audio, and scene files (`AssetBrowser.tsx`).
- [x] Top Device Bar with Play/Pause/Stop game loop, ADB device picker, and APK deploy button (`DeviceBar.tsx`).

### Milestone 3: Android Hardware-Accelerated Container (`templates/android-container`) ✅
- [x] Immersive fullscreen landscape Android Gradle application (`MainActivity.kt`).
- [x] Hardware-accelerated WebView with WebGL 2.0 support and `WebViewAssetLoader` for zero-CORS local asset loading.
- [x] Native Android JavaScript Bridge (`AndroidBridge`) providing native haptics/vibration and Logcat console forwarding.
- [x] Fullscreen touch HUD with virtual analog joystick and action buttons (`index.html`).

### Milestone 4: Live LLM AI Harness (`.env.prod` Integration) ✅
- [x] Connect Studio AI Copilot to live LLM endpoint `https://llm.heretek.one/v1` via secure Vite proxy.
- [x] Support reasoning model `mimotp/mimo-v2.6-flash` with streaming thought tokens, action JSON parsing, and scene mutation.
- [x] Implement self-healing loop: feed runtime exceptions and Logcat traces into LLM for automated script patches (`AiHarnessService.selfHeal`, `ConsoleDock` auto-heal).
- [x] Add proactive physics and clipping audit chips in `AIHarnessDock.tsx`.

### Milestone 5: GDevelop & CC0 3D Asset Store Integration ✅
- [x] Implement `GDevelopAssetService.ts` querying `https://resources.gdevelop-app.com/assets-database/assetPacks.json` with curated Quaternius/Kenney/Poly Haven CC0 catalog.
- [x] Add "Asset Store" tab in `AssetBrowser.tsx` allowing 1-click download/import of Quaternius 3D characters, Kenney props, and Poly Haven skyboxes.
- [x] Expose asset store querying and installation to the AI Copilot via Studio MCP (`studio_search_and_install_asset`).
- [x] Add Unity `.unitypackage` decompression and manifest extraction pipeline in `GDevelopAssetService.ts` and `AssetBrowser.tsx`.

### Milestone 6: Dual-Tier Native Vulkan Mobile Container (Tier 2) 🚀
- [x] Scaffold native C++/NDK Android project (`templates/vulkan-container`): CMake project building `libheretek_native.so` (verified: ARM64 Android ELF via NDK r30, links libvulkan/libandroid/liblog), Vulkan instance/device bootstrap, JNI bridge, MainActivity SurfaceView loop, Gradle scaffolding. No Filament/Godot dependency — the container owns its renderer core.
- [x] Build scene exporter: `harness/build/scene_exporter.py` translates studio scenes into the dependency-free `scene.native` line format + `scene.summary.json` draw-budget report (6 unit tests; deterministic output; sample exported into the container assets). Native `scene_loader.cpp` parses it with line-numbered error reporting (host-tested).
- [~] Implement GPU compute culling and instanced draw calls for 50k+ simulated entities (Anno 1800 scale). **Progress:** CPU reference (`culling.cpp`) host-tested (frustum planes caught a real row/column-major bug; dispatch planning = ceil(n/64) workgroups; indirect draw packing verified at 50k scale). GPU path implemented and compiling: `cull.comp` frustum culling shader + instanced `scene.vert/frag`, all compiled to SPIR-V with the NDK glslc (committed); `vulkan_swapchain` (surface/swapchain/render pass/framebuffers) + `vulkan_renderer` (compute dispatch → barrier → one `vkCmdDrawIndexedIndirect`, present loop) build into `libheretek_native.so` for arm64-v8a. On-device runtime validation remains.
- [ ] Implement quadtree terrain and mesh LOD streaming (Genshin Impact scale). **Progress:** TS engine ships `TerrainChunk`, `WorldStreamer` (frame-budgeted rings), and `HierarchicalStreamingCells` (district/block/chunk tiers + adaptive draw budget); native integration pending.

### Milestone 7: Autonomous QA & OpenCode Delegation ✅
- [x] Configure `opencode-mcp` in `~/.gemini/config/mcp_config.json` with auto-serve on port 4096.
- [x] Integrate Google Artemis autonomous mobile testing runner (`artemis_qa_runner.py`) for on-device 60 FPS profiling, telemetry reports, and crash reproduction.
- [x] Expose 8 Studio MCP tools for external AI coding assistants (`mcp_server.py`).
- [x] **Real headless QA pipeline:** `qa_scenario_runner.mjs` boots scenarios on the actual engine runtime (Rapier3D physics + EventSheet execution), measures real sim frame cost, GPU draw-call estimates (100-call mobile budget), and memory heap, and evaluates game-rule assertions against scenario specs.
- [x] **Regression gate:** `artemis_qa_runner.py` compares each run against the `project_memory` benchmark baseline and emits `SUCCEEDED` / `REGRESSED` / `FAILED` verdicts; every benchmark is persisted with draw-call and heap columns.
- [x] **Live scene store:** MCP mutations (spawn/modify/event/delete/import/terrain) persist to `harness/scenes/active_scene.json` and sync snapshots to `project_memory`; `studio_run_artemis_qa` boots that exact file.
- [x] **Vite QA bridge:** `POST /api/qa/run` (`app/vite.config.ts`) spawns the real runner from the studio's Artemis dock (no more simulated telemetry in the UI).
- [x] Added `studio_delete_entity` MCP tool (9 tools total).

### Milestone 8: Large-Scale World Subsystems & Battle-Hardened AI Harness ✅
- [x] **Large-Scale Engine Subsystems (`@heretek/engine`):**
  - Uniform 3D spatial hash partition (`SpatialGrid.ts`) for near-constant multi-entity proximity and radius queries (Veloren / SS14 pattern).
  - Level-of-Detail & culling subsystem (`LODManager.ts`) enforcing the 100 mobile draw-call budget across distance thresholds.
  - Hierarchical A* pathfinder (`GridPathfinder.ts`, `NavGrid`) with coarse chunk planning, fine grid refinement, and obstacle routing (Warzone 2100 pattern).
  - Deterministic fixed-step economy and logistics simulation loop (`EconomyTick.ts`) decoupled from visual frame rate (Anno / SS14 pattern).
  - World origin shifting (`FloatingOrigin.ts`) eliminating 32-bit floating-point precision jitter in massive worlds (Daggerfall Unity / OpenMW pattern).
  - S.T.A.L.K.E.R. OpenXRay inspired dual-tier A-Life simulation (`ALifeSimulator.ts`) with seamless online 3D bubble vs offline sector simulation (horizontal-distance promotion with hysteresis).
  - Branching narrative dialogue trees (`DialogueManager.ts`) with variable-gated choice selection (`getAvailableChoices` + comparison operators) and Markdown script DSL (Dialogic & Godot Dialogue Manager pattern).
  - 164 automated unit tests across 37 suites (100% pass) — **every engine source file has a companion `.test.ts`** (Zero Untested Code).
- [x] **Battle-Hardened Zero-Mistake AI Harness (`harness/`):**
  - 7-point Scene Invariant Gate (`scene_invariants.py`) rewritten for the canonical flat schema: finite transforms, unbatched draw budget (max 100), spawn non-penetration, entity uniqueness, component contracts, event integrity with cross-entity target existence, and velocity caps. Normalizes engine-exported nested dumps so one gate covers both formats.
  - **24 unit tests** (`test_scene_invariants.py`) covering the positive scene plus one negative per invariant; input immutability and schema normalization included.
  - **Rollback proven E2E:** duplicate-name, buried-collider, and invalid-shape mutations rejected with the scene file byte-identical (md5), valid spawn + delete round-trips restore the same checksum.
  - Multi-agent swarm pipeline (`agent_swarm.py`): all roles execute real actions — Architect (ADR), World Designer (streams 4 invariant-gated terrain chunks into the canonical scene), Shader Dev (applies AnimeCelShader config to scene entities), Gameplay Coder (wires Timer→RotateY events onto entities), Invariant Auditor (validates the mutated scene), headless Artemis QA (regression gate + benchmark recording), and Reviewer (approves on real telemetry). No fabricated results.
  - 23 Studio MCP tools; scene-mutating tools persist transactionally to `harness/scenes/active_scene.json` with `project_memory` snapshot sync.
- [x] **Desktop Studio IDE Integration (`app/`) — functional and chrome-devtools verified:**
  - `LargeScaleWorldDock.tsx`: LOD tab runs the real `LODManager` against the canonical scene + live viewport camera (culling proven: 3 culled / 1 visible at a 55m threshold), Spatial tab runs a real `SpatialGrid` (query distances 0.00/2.00/5.02m), Pathfinding derives its `NavGrid` from scene bounds/footprints (17 fine / 1 coarse nodes, hierarchical) and can spawn path markers into the scene, Economy uses one persistent `EconomyTick` (deterministic 210/75/430/120 after +30s), A-Life runs the real two-tier `ALifeSimulator` (12 online / 23 offline at a 40m bubble around the live camera).
  - `DialogueEditorDock.tsx`: trees persist to `scene.dialogues` (MCP-compatible); preview runs the real `DialogueManager` with live gating (gold≥100 choice hidden at gold=50) and narrative event dispatch.
  - `AgentSwarmDock.tsx`: real pipeline via `POST /api/swarm/run`; renders the real DAG, invariant audit, Artemis QA telemetry/regressions, ADRs and QA benchmarks from SQLite. Verified end-to-end: terrain streaming + shader config + event wiring all persist through the invariant gate, the auditor validates the mutated scene, and QA passes at 7 draw calls.
  - Scene bridge (`/api/scene` + `SceneStore`): read-modify-write against the authoritative file so studio saves never clobber external agent changes (verified: dock save preserves CLI deletions and other config).


### Milestone 9: Genre Systems — Vehicle Physics, Ambient Traffic & Impact Decals ✅
- [x] **Vehicle physics (`engine/src/vehicles/VehicleController.ts`)** — GTA-class handling built on Rapier3D's battle-tested `DynamicRayCastVehicleController`: multi-wheel independent raycast suspension (rest length, stiffness, compression/relaxation damping, travel, force caps), engine force per driven wheel, steering with configurable max angle, braking, and full telemetry (grounded state, suspension length/force, forward/side impulses, contact normals, integrated wheel spin). Forward is -Z; +steering turns right. 6 headless tests.
- [x] **Physics foundations hardened** — `PhysicsWorld.castRayAndGetNormal()` (suspension raycasts need contact normals); **mass bug fixed**: dynamic bodies now honor `RigidBody3D.mass` (collider mass distribution via `Collider3D.setMass`, verified 800kg chassis); `MeshRenderer` keeps three.js world matrices current so raycasts are correct without a render loop (headless QA).
- [x] **Ambient traffic & pedestrians (`engine/src/ai/TrafficSystem.ts`)** — real `BehaviorTreeComponent` decisions (waypoint-reached → advance route) plus a seek + separation steering layer for dynamic obstacle avoidance, with `SpatialGrid` perception for near-constant cost at scale; agents bind to scene GameObjects (spawn/cleanup) or run headless. 5 tests incl. crossing-agent separation (min gap > 0.4m, no deadlock) and 30-vehicle scale runs.
- [x] **Impact decal dispatcher (`engine/src/rendering/DecalDispatcher.ts`)** — capped, TTL-expiring decal registry with fade-out, fed by new `WeaponController.onHit()` hit events carrying world-space surface normals; rendering layer consumes a structurally-typed `{point, normal}` so it never imports weapons (Strict Decoupling). 4 tests incl. an end-to-end scene raycast → hit event → decal record.
- [x] **Packaging verified** — `apk_builder.py --dry-run` builds the web bundle, syncs assets into `templates/android-container` (container assets refreshed in-repo), and reports the target package; 62 engine tests / 14 suites green, full monorepo build green.
- [x] **Hierarchical streaming cell system (`engine/src/terrain/StreamingCells.ts`)** — nested district/block/chunk cell levels with per-level streaming rings and hysteresis; assets cluster into the finest level while parent tiers stream independently (districts outlive chunks at long range); adaptive draw-budget enforcement trims outer rings under pressure (stable persistent trim scale, no thrash) and recovers with headroom; scene-bound assets toggle `GameObject.active` on stream in/out; flat serializable cell state. 7 tests (ring culling, hysteresis, tier independence, budget trimming ≤100 draws, scene visibility, re-clustering, serialize/restore).
- [x] **Vehicle QA integration** — `qa_scenario_runner.mjs` accepts `vehicle` configs (Rapier raycast vehicle + throttle/steering/brake inputs) and new `distance_traveled` / `speed_min` rule types; `harness/config/scenarios/driving_course.json` (300m course, 4 pillars, 8 rules) passes 8/8 through the full Artemis pipeline: 59.75m traveled at 15.0 m/s average, grounded, 6 draw calls, benchmark recorded.
- [x] **Real device & packaging telemetry (de-mocked):** `GET /api/devices` reports the actual `adb devices -l` result (`harness/agents/device_cli.py`); the DeviceBar shows an honest "No device detected" state when nothing is attached. `POST /api/deploy` runs the real `apk_builder.py` pipeline (dry-run by default) and the console logs bundle-built/assets-synced/APK-path results, explicitly noting when on-device deployment is skipped. Verified in chrome-devtools: real ADB log line, real packaging results, no fabricated success.
