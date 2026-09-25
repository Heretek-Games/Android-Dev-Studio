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
| **Milestone 6** | **Dual-Tier Native Vulkan Export (Tier 2)** | ✅ **Complete (emulator-validated)** | Native C++/NDK Vulkan runtime shell (zero WebView) for 60–120 FPS high-draw-call titles (Genshin, Anno, Doom scale). Validated on an Android target: real swapchain, 64 terrain LOD leaf draws + instanced cubes, steady ~61.5 FPS, rendered output confirmed on-display and by frame readback. |
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
- [x] Implement GPU compute culling and instanced draw calls for 50k+ simulated entities (Anno 1800 scale). **Implementation:** CPU reference (`culling.cpp`) host-tested (frustum planes caught a real row/column-major bug; dispatch planning = ceil(n/64) workgroups; indirect draw packing verified at 50k scale). GPU path implemented and compiling: `cull.comp` frustum culling shader + instanced `scene.vert/frag`, all compiled to SPIR-V with the NDK glslc (committed); `vulkan_swapchain` (surface/swapchain/render pass/framebuffers) + `vulkan_renderer` (compute dispatch → barrier → one `vkCmdDrawIndexedIndirect`, present loop) build into `libheretek_native.so` for arm64-v8a. **On-device validated (emulator):** real swapchain (4 images), `VK_SUCCESS` acquire/submit/present over thousands of frames at ~61.5 FPS, rendered output verified on-display and via in-renderer PPM readback. Three pipeline bugs were found and fixed by running on-device: `VK_KHR_swapchain` was never enabled at device creation, extension entry points were called without `vkGet*ProcAddr` (loader stubs return success and do nothing), and the scene was uploaded before the surface existed (terrain buffers never filled). A Vulkan-convention projection (`perspectiveVulkan`: Y-down, depth 0..1) replaced the OpenGL-style matrix that flipped the image and clipped near depth. 61 host checks.
- [x] Implement quadtree terrain and mesh LOD streaming (Genshin Impact scale). **Implementation:** TS engine ships `TerrainChunk`, `WorldStreamer` (frame-budgeted rings), `HierarchicalStreamingCells` (district/block/chunk tiers + adaptive draw budget), and `QuadtreeTerrain` (focus-driven subdivision/merge with hysteresis, continuous LOD blend factors, async loader state machine under a per-frame node budget — 7 tests). **Native integration:** the scene exporter emits focus-driven `terrain_lod` leaves (`--quadtree`, budget-aware depth — depth 3 keeps the sample at 67 draws) with a `terrain_meta` depth header; the native `scene_loader` parses them and `terrain_mesh.cpp` generates heightmap-displaced grid meshes per leaf (LOD-scaled resolution 33→5, central-difference normals, deterministic 77,888-vertex / 458,496-index budgets for the 64-leaf sample, including LOD skirts and leaf-local indices (the shared buffer passes 65,535 vertices, so absolute uint16 indices would overflow) — 63 native host checks green). Terrain meshes are packed into shared vertex/index buffers with per-leaf indirect draw commands (one `vkCmdDrawIndexedIndirect` renders all leaves via the `terrain.vert` pipeline; packing offsets/rebasing verified by the native host checks). **On-device validated (emulator):** 64 LOD leaf draws render the heightmap terrain alongside the instanced scene cubes; output confirmed by display capture and frame readback.

- [x] **Gradle APK assembly verified** — the Tier 2 container now vendors the Gradle wrapper (`gradlew`, Gradle 8.11.1) and assembles a real `app-debug.apk` (2.2 MB: arm64-v8a `libheretek_native.so` + `scene.native` + 4 SPIR-V shaders, minSdk 24). Three scaffold bugs were found and fixed while bringing the build up: the invalid Java package namespace `...gamestudio.native` (`native` is a Java keyword), the manifest activity path resolving to a doubled `.native.native` suffix, and a 3-arg `setContentView` that does not exist. `apk_builder.py --tier2` runs the whole pipeline (scene export → NDK cross-compile → Gradle assemble) and reports the APK path; the builder auto-detects a JDK 17–23 (Gradle 8.11 rejects newer runtimes) and reports honestly when none is available. On-device runtime validation remains.

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
  - 171 automated unit tests across 38 suites (100% pass) — **every engine source file has a companion `.test.ts`** (Zero Untested Code).
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
- [x] **Packaging verified (real APKs for both tiers)** — `apk_builder.py` builds the web bundle, syncs assets into `templates/android-container`, and assembles a real Tier 1 `app-debug.apk` (12.9 MB with the synced webgame bundle) through the now-vendored Gradle wrapper; the Tier 1 container also gained its missing `gradle.properties` (`android.useAndroidX=true` — required by its AndroidX dependencies, previously an unbuildable scaffold). `--tier2` assembles the native Vulkan APK. The builder resolves a JDK 17–23 automatically and reports APK paths honestly; on-device deployment still requires attached hardware. 171 engine tests / 38 suites green, full monorepo build green.
- [x] **Hierarchical streaming cell system (`engine/src/terrain/StreamingCells.ts`)** — nested district/block/chunk cell levels with per-level streaming rings and hysteresis; assets cluster into the finest level while parent tiers stream independently (districts outlive chunks at long range); adaptive draw-budget enforcement trims outer rings under pressure (stable persistent trim scale, no thrash) and recovers with headroom; scene-bound assets toggle `GameObject.active` on stream in/out; flat serializable cell state. 7 tests (ring culling, hysteresis, tier independence, budget trimming ≤100 draws, scene visibility, re-clustering, serialize/restore).
- [x] **Vehicle QA integration** — `qa_scenario_runner.mjs` accepts `vehicle` configs (Rapier raycast vehicle + throttle/steering/brake inputs) and new `distance_traveled` / `speed_min` rule types; `harness/config/scenarios/driving_course.json` (300m course, 4 pillars, 8 rules) passes 8/8 through the full Artemis pipeline: 59.75m traveled at 15.0 m/s average, grounded, 6 draw calls, benchmark recorded.
- [x] **Real device & packaging telemetry (de-mocked):** `GET /api/devices` reports the actual `adb devices -l` result (`harness/agents/device_cli.py`); the DeviceBar shows an honest "No device detected" state when nothing is attached. `POST /api/deploy` runs the real `apk_builder.py` pipeline (dry-run by default) and the console logs bundle-built/assets-synced/APK-path results, explicitly noting when on-device deployment is skipped. Verified in chrome-devtools: real ADB log line, real packaging results, no fabricated success.

### Milestone 10: Autonomous Iterate-Until-Green Loop ✅
- [x] **Closed-loop generation (`harness/loop/`)** — the harness no longer stops at one-shot generation: LLM (generate | repair) → parse (codeblock/raw/salvaged) → apply → 7-point invariant gate → headless engine QA → failing rules + telemetry + scene fed back → repeat until QA-verified green or budget exhaustion (iterations / tokens / wall clock).
  - `llm_client.py` — OpenAI-compatible client (.env.prod) with per-call tokens/latency/finish-reason/retry telemetry and vision messages (`chat_with_image`).
  - `action_applier.py` — pure spawn/light/modify/delete/event applier over the flat scene schema, reusing the invariant gate's canonical sets; malformed actions become explicit outcomes (repair input), never exceptions.
  - `prompts.py` — generation + repair prompts with the QA-rule → schema mappings (`physics` → RigidBody3D, `controller` → MobileController, events → EventSheet).
  - `iterate_loop.py` — gate-before-QA (violations skip QA and feed back as failures), budgets, per-iteration telemetry, run-log JSON + markdown under `harness/runs/loop_runs/`.
  - `scene_preview.py` + `vision.py` — deterministic top-down layout PNG and multimodal critique (`auto/best-vision`); `critique_frame()` accepts real rendered frames (studio screenshot / emulator readback).
  - `regression_bisect.py` — first-bad-commit search running real QA per step in throwaway git worktrees (engine rebuilt there).
  - `report.py` — cost/latency dashboard (verdicts, tokens, latency, iterations-to-green).
  - **63 hermetic tests** (`python3 -m unittest discover -s harness/loop -p "test_*.py"`) with injected LLM transport / fake QA.
- [x] **First live green run (2026-09-25)** — mini arena goal against `mini_arena.json`: iteration 1 generated 41 actions (gate rejected a spawn penetration), iteration 2 applied one corrective action ("raise the player above the collider") → gate ok → QA **SUCCEEDED 10/10** (23/100 draw calls, 25 objects: player + 15 coins + 6 pillars + sunset light) in 2 iterations, 6,725 tokens / 27.1s. Evidence: `harness/runs/loop_runs/20260925-060026-*.json` + `harness/scenes/loop_work_scene.json`.

### Milestone 11: Vertical Slice #1 — Playable Arena FPS ✅
- [x] **Game-shell foundation (engine)** — `GameFlow` (menu/playing/paused/won/lost with explicit rejections), `GameSession` (score/waves/kills/timer, win/lose conditions, snapshot/restore), `SaveSystem` (slot saves over injectable storage with explicit corrupt/version errors), `HealthComponent` (invulnerability window, damage/death events), `GameShell` (DOM menu/HUD/pause/win/lose/restart with a headless view model).
- [x] **Audio module** — `AudioManager` (clip registry, master volume, linear spatial attenuation), `AudioBackend` + `NullAudioBackend` (headless), `WebAudioBackend` (browser), `AudioSource` component (one-shot/loop/spatial with position tracking). 20 tests.
- [x] **FPS gameplay** — `AttackNode` (range-gated, rate-limited BT node), `EnemyAI` (attack/chase/idle behavior tree), `WaveSpawner` (deterministic ring spawns, wave clearing, deadlock-safe), `DamageRouter` (hit events → health → kills), `GameRuntime` (full wiring with `prepare()`/`start()`/`restart()`/`stop()`).
- [x] **Playable game mode** — `?play=1` boots a fullscreen arena (same `fps_arena` spec as QA): dedicated three.js renderer, follow camera, auto-aim fire, `GameShell` overlays, Save/Continue via `SaveSystem`, Pause button + Escape. Studio header gained a **Game** button.
- [x] **Genre QA scenario** — `harness/config/scenarios/fps_arena.json` (12 rules) with runner support for `weapon`/`health`/`ai` specs, real `GameRuntime` boot, and `game_*` rule types; **12/12 rules**, Artemis baseline recorded (phase=won, kills=2, score=200, 0.75m enemy chase).
- [x] **Real bug fixed with regression coverage** — `WeaponController` reported `"Environment"` for every hit (three.js mesh name never set), so the damage path never resolved targets; hits now use `userData.gameObject.name` and a new DamageRouter e2e test drives a real raycast → router → health → kill.
- [x] **On-device validation (Tier 1 APK, emulator)** — installed + launched via `apk_builder.py`; header **Game** button → arena menu → **Start** → **Victory 200 points (2 kills, wave 2)** → **Restart** → mid-run HUD (Score 100 · Wave 2 · Kills 1, health bar). Screenshots captured; 268 engine tests green.

### Milestone 12: Tier 2 Hardening & Scale Tooling ✅ (validation-layer soak pending)
- [x] **Per-frame-in-flight synchronisation** — each in-flight slot owns its semaphores + fence (kMaxFramesInFlight=2), replacing the single reused semaphore pair (a real Vulkan hazard). On-device: steady frames with `acquire=0 submit=0 present=0`, frame readback still valid.
- [x] **Swapchain recreation** on `OUT_OF_DATE`/`SUBOPTIMAL` (acquire + present): rebuilds swapchain, command buffers, fences, semaphores and the capture buffer; scene/terrain buffers survive.
- [x] **Validation-layer opt-in** — `VK_LAYER_KHRONOS_validation` enabled automatically in debug builds when present (verified in the Debug NDK build; on-device soak needs the layer packaged in the APK — tracked in issue #6).
- [x] **Scale tooling** — `stress_scene_gen.py` (deterministic N-instance grids, 5 tests) + `apk_builder --scene <path>`; exporter verified with 10,000 instances → **1 indirect draw, 66 total draws** (budget 100).
- [x] **Asset freshness fix** — the Tier 2 container now always refreshes extracted assets (a stale `scene.native` silently rendered the previous build).
- [~] **On-emulator scale validation (issue #3)** — 3 instances run stably for hours; 2,000+ instances kill the emulator host (gfxstream/lavapipe) within seconds. Physical-device validation (issue #1) is the remaining path; host-side 50k-scale planning/packing checks stay green.

### Milestone 13: Vertical Slice #2 — Driving Sandbox ✅
- [x] **Distance-mode game runtime** — `GameRuntime` mode `'distance'`: travelled planar metres score into the session (win at target, lose on the timer), teleport/NaN deltas ignored, restart resets (5 tests).
- [x] **Genre QA scenario** — `driving_slice.json` (10 rules): vehicle component stack, distance, average speed, finish score, won phase, transforms, draw budget, FPS. **10/10 rules**, Artemis baseline recorded (won at 120.06 m, avg 37.6 m/s).
- [x] **Playable mode** — `?play=driving` / studio **Drive** button: auto-cruise VehicleController with keyboard/touch steering and braking, chase camera, distance HUD; **verified on-device** (Victory — 120.7 m in 7.8 s, all four wheels grounded).
- [x] **Production-only bug fixed** — the APK skipped physics init because `GameView` dispatched on `constructor.name` (mangled by the production minifier); `instanceof` now, plus `toJSON().type` in the debug surface and AI harness summaries. On-device `AndroidBridge.log` telemetry (phase/distance/throttle/wheels/grounded/body) added and kept for device debugging.

### Milestone 14: Vertical Slice #3 — Dungeon Action RPG ✅
- [x] **Elemental damage routing** — `DamageRouter` elemental path with single kill reporting and entity removal; physical fallback for elemental health pools.
- [x] **Runtime element swaps** — `GameRuntime.setHitElement` re-attaches only the weapon router; driven by the DungeonKeeper `hydro_blessing` dialogue event.
- [x] **Genre QA scenario** — `dungeon_slice.json` (11 rules) + `DungeonKeeper` dialogue tree; **11/11 rules SUCCEEDED** (`phase=won`, `kills=2`, `reactions=2`).
- [x] **Playable mode** — `?play=dungeon` / studio **Dungeon** button: keeper dialogue overlay on Start, elemental enemy factory, reactions/dialogue debug surface. **Verified on-device** (Tier 1 APK): menu → Start → keeper dialogue with both blessing choices → auto-aim clears both slime waves → **Victory — 200 points (Score 200 · Wave 2 · Kills 2 · 2.0s)**; blessing tap dismisses the dialogue cleanly.

### Milestone 15: Vertical Slice #4 — City Builder ✅
- [x] **Settlement core** — plot-grid placement with validation, fixed-step economy (housing caps, upkeep, surplus growth / starvation), deterministic advance, demolish, snapshot, reset, target-population win (7 tests).
- [x] **Runtime build mode + score mirror** — `GameRuntime` mode `'build'` with `getSettlement()`; `GameSession.syncScore` mirrors population into the HUD without triggering wins.
- [x] **Genre QA scenario** — `city_slice.json` (7 rules) with `game_settlement_pop_min` / `game_settlement_gold_min` rules and settlement telemetry; **7/7 rules SUCCEEDED**, Artemis baseline recorded.
- [x] **Playable mode** — `?play=city` / studio **City** button: found an empty town on a 24×24 grid, click-to-place with grid snapping, build toolbar, treasury overlay, fixed overview camera. **Verified on-device** (Tier 1 APK): menu → Start → toolbar selection + 3 ground taps all placed (`CityPlace ok:true` ×3: house + 2 farms) → live treasury → **Victory — Pop 6/6 (Pop 6 · 9.0s)**; restart resets to a fresh town.

### Milestone 16: Autonomous AI Game Studio — Orchestration MVP ✅
- [x] **Game Production Briefs (`harness/briefs/`)** — machine-checkable `game_brief.json` schema: fantasy, experience, world scope, required systems, look-dev, Snapdragon 8 Elite / Android 16 performance contract (60 FPS, ≤100 draw calls, tri/texture/physics/APK budgets), binary acceptance matrix across the five axes. Criteria with `qaRule` attachments compile to headless-QA runner rules; the rest are critic-owned. 17 tests.
- [x] **Brief persistence + mandatory retrieval (`harness/memory/project_memory.py`)** — `production_briefs` table with `record_brief`/`get_brief`/`list_briefs` plus `query_production_context()` (brief + ADRs + failed tasks + latest QA). 8 tests.
- [x] **Builder-critic DAG (`harness/orchestrator/agent_swarm.py`)** — `plan_from_brief()` builds one builder task plus one dependent critic task per acceptance criterion (`AXIS_POD_ASSIGNMENT`; builders never grade their own work); `get_ready_tasks()` schedules dependency-free pending tasks. 6 tests.
- [x] **Vision hooks in Artemis (`harness/agents/artemis_qa_runner.py`)** — opt-in `--vision` flag attaches multimodal layout-critique notes + telemetry to the report; advisory only, never changes verdicts. 5 tests.
- [x] **Production-run orchestrator (`harness/loop/production_run.py`)** — brief-to-verdict recursive pass with CLI; green requires loop convergence AND zero failed criteria, otherwise FAILED with defects; scope-reduction candidates for unautomatable criteria. 6 tests.
- [x] **Phase 1 milestone check PASSED (2026-09-25)** — island brief → DAG (16 tasks) → loop: generate (10 actions incl. 4-wheel vehicle) → gate rejected spawn penetration → repair (3 actions) → QA **SUCCEEDED 6/6** in 2 iterations, 7,897 tokens. Follow-up run with the traversal criterion: **SUCCEEDED 7/7** in 1 iteration (3,016 tokens), sweep coverage=1.0. Evidence: `harness/runs/loop_runs/20260925-133811-*.json` + `20260925-134955-*.json`.
- [x] **Phase 2 rung 1 PASSED (2026-09-25)** — valley brief (traversal + streaming coherence criteria) → DAG → loop: generate (13 actions incl. streamer config) → gate clean → QA **SUCCEEDED 6/6** in 1 iteration (2,293 tokens); traversal sweep coverage=1.0 with 0 holes, streaming transect coverage=1 with 0 gaps and 0 thrash reloads. Evidence: `harness/runs/loop_runs/20260925-140409-*.json`.
