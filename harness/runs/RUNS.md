# AI Harness Feedback Runs — Heretek Studio

Repeatable harness e2e records for the Studio AI Copilot pipeline
(`AIHarnessDock` → `AiHarnessService` → `/api/llm` → `mimotp/mimo-v2.6-flash`).
Format follows the feedback-loop methodology: per-stage transport/parse/apply
telemetry from `window.__HARNESS_TRACE__`, thrash signatures, two rubrics
(game + harness), suspected cause, and the fix that closes the loop.

Telemetry sources (chrome-devtools):
- `window.__HARNESS_TRACE__` / localStorage `harness-trace` — per-call pipeline records
- `window.__STUDIO_DEBUG__` — live scene introspection (transforms, events, play state)
- Console messages + network request status (never dump request headers — API keys live there)

---

## Run Block 1 — 2026-09-24/25, `mimotp/mimo-v2.6-flash` via `https://llm.heretek.one/v1`

**Acceptance prompt (mini arena game):**
"Build a mini arena game: spawn a ground arena plane, a player capsule, 6 tall box
pillars arranged as an obstacle course, 5 gold cylinder coins each with a Timer event
that RotateY to spin, and a warm sunset directional light with high intensity"

### Per-run results

| Run | Trace ID | Outcome | Duration | Tokens (c) | Parse | Apply | Notes |
|-----|----------|---------|----------|------------|-------|-------|-------|
| 1 | tr_df5q4y3 | ✅ llm-success | 25.0s | 1522 | codeblock, 19 actions | 19/19 | Baseline success (pre-fix build) |
| 2 | tr_q6iih0d | ❌ parse-degraded | 21.0s | 1800 (= ceiling) | raw, 0 actions | — | **Truncation cascade** (see below) |
| 3 | tr_3bh66se | ✅ llm-success | 15.9s | 1545 | codeblock, 20 actions | 20/20 | Post token-ceiling fix |
| 4 | tr_z6xxvkg | ✅ llm-success | 369.7s | 1967 | codeblock, 19 actions | 19/19 | Upstream latency stall (6.2 min) |
| 5 | tr_qlazspo | ✅ llm-success | 26.7s | 2008 | codeblock, 21 actions | 21/21 | Final verification run |

### Breakdowns found (localized by stage)

1. **Truncation cascade (run 2) — parse stage.**
   Signature: `completionTokens == max_tokens` (1800), `finish_reason` not recorded
   (pre-fix), parse strategy fell back `codeblock → raw`, `JSON.parse` failed on the
   opening fence backtick. Chain: max_tokens truncation → closing ``` fence missing →
   regex fallback to raw → parse degraded → 0 actions applied.
   **Fixes:** `max_tokens` 1800→4000 (self-heal 1200→2500); `finishReason` recorded in
   transport trace; `extractJson` tolerates unterminated fences; `salvageJson`
   balanced-brace recovery salvages complete actions from truncated payloads
   (parse strategy `salvaged`).

2. **Timer conditions never fired — engine stage (EventSheet).**
   Signature: play-mode transform sampling via `__STUDIO_DEBUG__` showed
   `coin1_rotated: false` while physics was demonstrably ticking (player Y settling
   under Rapier gravity). Root cause: `EventSheet.update()` only accumulated timer
   keys that already existed in the map and `checkCondition` never seeded them, so a
   `Timer` condition read `0 >= interval` forever.
   **Fixes:** lazy timer accumulation in `checkCondition` (regression-tested in
   `engine/src/events/EventSheet.test.ts` — 5 new tests, 25/25 green); `RotateY`
   now honors `{degrees}` per-fire steps (Timer/OnStart) alongside `{speed}` rad/s
   (EveryFrame); harness forwards `condition_params`; system prompt documents the
   condition/action param vocabulary.

3. **Upstream latency stall (run 4) — transport stage.**
   Signature: POST `/api/llm/chat/completions` pending 5+ min, UI spinner hung.
   Resolution: completed after 369.7s with HTTP 200 and a clean parse — pure
   upstream slowness. **Fix:** 90s `AbortController` bound on the fetch so hangs
   degrade into a traceable transport error (`timeout after 90s`) instead of an
   infinite spinner.

4. **Silent-failure masking (pre-existing, first pass of this cycle).**
   Signature: fetch errors, parse failures, and action-apply crashes all surfaced as
   plausible chat summaries with green checkmarks (fallback spawned a single
   "Procedural AI Entity"; parse failure produced a fake summary; apply crashes were
   mislabeled "LLM fetch failed"). **Fixes:** `isFallback` + outcome badges
   (Fallback / Parse Degraded / Partial Apply), per-action try/catch with
   target-missing/invalid/error outcomes, `outcome` ∈ llm-success | parse-degraded |
   apply-error | fallback | transport-error on every trace record.

5. **AI Copilot dock unreachable — app wiring (discovered this cycle).**
   `AIHarnessDock` was never registered in DockviewWorkspace (dead code); the
   "Agent Swarm" dispatch is a canned setTimeout simulation, not an LLM pipeline.
   **Fix:** registered `ai_harness` panel in the default bottom drawer + Panels menu.

### Two rubrics

**Game (run 5, accepted):** ground arena ✅, player capsule ✅, 6 pillar obstacle
course ✅, 5 gold coins ✅, Timer→RotateY spin events firing ✅ (rotation.y +3.5 rad
over 3s live-sampled), sunset directional lighting ✅, physics settling ✅ (pillars
tilt under Rapier), mobile HUD + joystick ✅, 60 FPS ✅, zero console errors ✅.
Play-mode proof: `docs/screenshots/qa_run_play_mode.png`.

**Harness:** 4/5 runs `llm-success`; all 5 calls traced end-to-end; every breakdown
localized to a stage (parse ×1, engine ×1, transport ×1) and closed with a fix +
regression coverage; 0 silent degradations post-fix (fallback/degraded states now
explicitly flagged in UI and trace).

### Open items / next run notes

- `AgentSwarmDock.handleDispatchSwarm` remains a canned simulation — wire it to
  `AiHarnessService.generateWorld` (or MCP) so the swarm dock exercises the real
  pipeline.
- RotateY `{degrees}`-per-fire vs `{speed}`-per-frame semantics are now documented
  in the system prompt; consider validating LLM param shapes against the EventSheet
  vocabulary and rejecting malformed params into `apply` outcomes.
- Full-viewport chrome-devtools screenshots can carry stale compositor raster tiles
  (DOM correct, pixels stale; element-uid captures render correctly). Prefer
  `__STUDIO_DEBUG__` DOM assertions + uid element captures for pixel-level checks.
- Upstream latency variance is large (16s–370s). If stalls repeat, raise the 90s
  abort or add retry-with-backoff and record attempts in the trace.

---

## Run Block 2 — 2026-09-25, On-Device Tier 2 Validation (Android emulator)

First real runtime validation of both containers on an Android target
(`xune-test` AVD: android-36, x86_64, 1080x2400, booted headless with
`-gpu lavapipe` on a KVM host; SwiftShader/SwANGLE/host-GPU modes were also
tried). Method: `apk_builder.py --tier2` → `adb install` → `am start` →
logcat + `screencap` + in-renderer frame readback (`nativeCaptureFrame` → PPM).

### Verdict

| Check | Result |
|-------|--------|
| Tier 1 APK launch + WebGL studio render | ✅ after fixes (screenshot: studio UI with 3D viewport) |
| `POST /api/deploy {real:true}` full path | ✅ "Successfully installed and launched on emulator-5554" |
| Tier 2 native init (scene parse + upload) | ✅ `draws=67 terrainLeaves=64 terrainVertices=77888` (grid + LOD skirts) |
| Tier 2 Vulkan swapchain + pipelines | ✅ real handle, 4 images, 4 command buffers |
| Tier 2 frame loop | ✅ acquire/submit/present = `VK_SUCCESS`, steady ~61.5 FPS (300 frames / 4.88s) |
| Tier 2 rendered output | ✅ live display + readback PPM (terrain + blue player + orange crate, correct orientation) |
| Native host checks | ✅ 61 checks (3 new Vulkan-projection checks) |

### Real bugs found only by running on-device (all fixed)

1. **`VK_KHR_swapchain` never enabled at device creation (Tier 2).** The device was
   created without the extension, so `vkCreateSwapchainKHR` resolved to a loader
   stub that returned `VK_SUCCESS` and wrote nothing: null swapchain, 0 images,
   black screen, while the app logged "Surface ready". Fix: enumerate device
   extensions, require `VK_KHR_swapchain`, enable it, and fail loudly if missing.
2. **Extension entry points must be resolved via `vkGet*ProcAddr` (Tier 2).**
   Direct calls to `vkCreateSwapchainKHR` / `vkAcquireNextImageKHR` /
   `vkQueuePresentKHR` link but do not dispatch on Android. Fix: resolve all
   VK_KHR_swapchain functions through `vkGetInstanceProcAddr`/`vkGetDeviceProcAddr`.
3. **Scene uploaded before the surface existed (Tier 2).** `nativeInit` ran
   `uploadScene` while the GPU buffers were still null, so instance/terrain
   buffers were never filled (`terrainDraws=0`). Fix: re-upload after
   `createSurface`.
4. **OpenGL-convention projection used in Vulkan (Tier 2).** Y-up clip space +
   depth −1..1 flipped the image vertically and clipped the near half of the
   depth range. Fix: `perspectiveVulkan()` (Y-down, depth 0..1) + host checks.
5. **JNI symbols left on the old package (Tier 2).** Renaming the namespace from
   `...gamestudio.native` (invalid: `native` is a Java keyword) to
   `...gamestudio.tier2` broke all `Java_..._native*` symbols →
   `UnsatisfiedLinkError`. Fix: renamed the 9 JNI entry points.
6. **Tier 1 crashed in `onCreate`.** `hideSystemUI()` dereferenced the decor view
   before `setContentView`. Fix: call it after the content view exists.
7. **Tier 1 crashed on launch.** `AppCompatActivity` with a platform theme
   (`Theme.NoTitleBar.Fullscreen`) → "You need to use a Theme.AppCompat theme".
   Fix: `Theme.HeretekGame` (AppCompat parent + fullscreen attrs).
8. **Tier 1 white screen.** Vite emitted absolute `/assets/...` URLs; the WebView
   asset loader maps `/assets/` to the APK asset root, so `index-*.js` 404'd
   (`FileNotFoundException: index-*.js`). Fix: `base: './'` in `vite.config.ts`.
9. **Tier 2 manifest resolved to a doubled suffix.** `android:name=".native.MainActivity"`
   under namespace `...native` → `...native.native.MainActivity`. Fix:
   `.MainActivity` under the `...tier2` namespace.
10. **Tier 2 `setContentView(view, w, h)`** does not exist (3-arg form) → Kotlin
    compile error. Fix: `setContentView(view, ViewGroup.LayoutParams(...))`.

### Environment notes

- The emulator's Vulkan WSI with software backends silently no-ops device-level
  extension calls; after fix #1/#2 the WSI delivers buffers normally (verified via
  `dumpsys SurfaceFlinger --latency` frame timestamps).
- `screencap` shows black for the native SurfaceView before the swapchain fix;
  after it, both `screencap` and the in-renderer readback agree.
- Gradle 8.11.1 requires JDK 17–23; the builder auto-detects one and reports
  honestly when only an incompatible runtime is present.

---

## Run Block 3 — 2026-09-25, Iterate-Until-Green Loop (live LLM + engine QA)

First autonomous runs of `harness/loop/iterate_loop.py` against the live endpoint
(`mimotp/mimo-v2.6-flash` for generation/repair, `auto/best-vision` for the layout
critique) with the real headless engine QA (`qa_scenario_runner.mjs`).

### Results

| Run | Mode | Verdict | Iterations | Tokens | LLM latency | Notes |
|-----|------|---------|-----------|--------|-------------|-------|
| `20260925-060026` | plain | ✅ green | 2 | 6,725 | 27.1s | 41 actions → gate rejected a spawn penetration → 1-action repair → QA 10/10 |
| `20260925-060822` | vision | ✅ green | 2 | 6,461 | 75.1s | vision call ran but returned no notes (pre-telemetry build) |
| `20260925-061359` | vision | ✅ green | 2 | 9,390 | 100.7s | vision tokens now counted (2,881) |
| `20260925-062444` | vision + retry | ✅ green | 2 | 12,211 | 145.1s | **6 vision notes** fed into the repair; 17-action repair → QA 10/10 |

All runs: gate-before-QA enforced, 10/10 rules passed at green (23/100 draw calls,
25 objects, player + 15 coins + 6 pillars + sunset light).

### Vision critique findings (run `20260925-062444`)

```
Issue: No visible ground plane object in the layout, supporting the QA report of collider penetration at spawn.
Issue: Player spawn is immediately adjacent to multiple gold coins (e.g., Gold Coin 7), risking unintended collisions at collection.
Issue: Dense arrangement of gold coins in the central area, causing excessive clutter that may hinder navigation.
Suggestion: Add or verify a ground plane collider beneath the player spawn point to prevent penetration issues.
Suggestion: Increase clearance around the player spawn by repositioning nearby gold coins to allow safe initial movement.
Suggestion: Reduce coin density in the central region or spread coins out to improve playability.
```

### Breakdowns found and fixed

1. **Vision route is a reasoning model** — `auto/best-vision` (mimo-v2.5) spent small
   budgets on thinking and returned empty content with `finish_reason=length`
   (confirmed live: 1,500/2,000 tokens → empty; 6,000 → 3 suggestions). Fix: vision calls
   default to 6,000 tokens and self-heal with one 12,000-token retry; empty responses are
   recorded as an explicit error, never silently ignored.
2. **Vision telemetry was dropped** — critique tokens/latency now count toward run totals
   and are stored per iteration (`vision` record).
3. **Failure-blind critique** — the layout prompt now receives the failing QA rules so the
   model looks for their visual evidence (a top-down layout cannot show 3D spawn
   penetration on its own).
4. **`harness/loop/bisect.py` shadowed the stdlib `bisect` module** (via `tempfile`→`random`)
   when the package directory was on `sys.path`; renamed to `regression_bisect.py`.

### Emulator smoke test (issue #5)

`python3 harness/agents/emulator_smoke.py --reuse --skip-build` → `tier1: PASS`, `tier2: PASS`
on the attached lavapipe emulator. Two real bugs were caught while validating it: the logcat
collector broke on the first frame line (before the 300-frame status line), and `adb install`
failures were silently ignored. 18 unit tests cover the pure assertion checks.

---

## Run Block 4 — 2026-09-25, Vertical Slice #1: Arena FPS (Phase 3)

The first complete playable game: menu → gameplay → win/lose → restart, with audio,
save/load, real weapon damage, and on-device validation.

### Engine additions (268 tests green, +27 for this block)

| Module | Purpose |
|--------|---------|
| `audio/AudioManager` + `AudioBackend`/`WebAudioBackend` | Clip registry, master volume, linear spatial attenuation; headless null backend |
| `components/AudioSource` | Per-entity playback (one-shot/loop/spatial), position tracking |
| `game/GameFlow` | menu/playing/paused/won/lost state machine; explicit rejections |
| `game/GameSession` | Score/waves/kills/timer + win/lose conditions; snapshot/restore |
| `game/SaveSystem` | Slot save/load over injectable storage; explicit corrupt/version errors |
| `components/HealthComponent` | HP, invulnerability window, damage/death events |
| `components/EnemyAI` + `AttackNode` | Behavior-tree enemy: attack in range, chase in aggro, idle |
| `game/WaveSpawner` | Deterministic ring spawns, wave clearing, inter-wave delay |
| `game/DamageRouter` | Hit events → target HealthComponent → kill reporting |
| `game/GameRuntime` | Wires session + spawner + damage routing + player death + win/lose |
| `ui/GameShell` | DOM menu/HUD/pause/win/lose/restart with a headless view model |

### Genre QA scenario (`harness/config/scenarios/fps_arena.json`) — 12/12 rules

Runner gained `weapon`/`health`/`ai` scene specs, real `GameRuntime` boot, and rule
types `game_phase`, `game_score_min`, `game_kills_min`, `game_wave_reached`,
`game_enemy_chase_min`. Verified: phase=won, kills=2, score=200, wave=2, max enemy
displacement 0.75m, 2/100 draw calls; Artemis baseline recorded.

### Bug found and fixed (the FPS damage path never worked end-to-end)

`WeaponController` named hits from `threeMesh.name` (never set by MeshRenderer), so
every hit reported `"Environment"` and the damage router could never resolve the target —
waves advanced only because enemies were never damaged. Hits now resolve through
`userData.gameObject.name`; MeshRenderer names its mesh after the entity. Regression
coverage: DecalDispatcher e2e asserts the entity name; a new DamageRouter e2e test drives
a real WeaponController raycast → hit event → router → health → kill.

### On-device validation (Tier 1 APK, emulator)

1. `python3 harness/build/apk_builder.py` → installed + launched on emulator-5554
2. Header **Game** button → `?play=1` → arena menu (screenshot: `docs/screenshots`-style capture in the session log)
3. Tap **Start** → run completes → **Victory — 200 points / Score 200 · Wave 2 · Kills 2 · 1.1s**
4. Tap **Restart** → mid-run HUD: **Score 100 · Wave 2 · Kills 1 · 0.8s**, health bar full, player capsule visible
5. Save/load (dev-server verification): pause → Save → Menu → Continue restores score 200 / kills 2

Screenshots captured during the session: studio-in-APK, arena menu, victory, mid-run HUD.

---

## Run Block 5 — 2026-09-25, Studio ↔ Device Live Loop (Phase 4)

### In-APK device context (issue #4, closed)

`AndroidGameBridge.deviceInfo()` returns the device/build identity as JSON; the studio's
`NativeBridge` service detects and parses it, and `refreshDevices` prefers it inside the
container. Verified: mocked bridge in the dev server → header `Pixel 8 Pro (arm64-v8a) · API 35`
plus an explicit log that the dev-server bridges are unavailable in the packaged build;
on-device APK → the header shows the emulator device instead of "No device detected".

### Device Mirror & Profiler (commit `011757c`)

Bridge routes (dev-only):

| Route | Backing command | Notes |
|-------|-----------------|-------|
| `GET /api/device/screen?serial=` | `adb exec-out screencap -p` | returns the live PNG frame (~991 KB, 2400×1080) |
| `POST /api/device/input` | `adb shell input` | tap / swipe / key / text |
| `GET /api/device/stats?serial=&package=` | `adb shell dumpsys gfxinfo <pkg> framestats` + `meminfo` | FPS from INTENDED_VSYNC deltas, jank %, p50/p90/p95/p99, TOTAL PSS |

**FPS parser bug found and fixed:** newer Android inserts `FrameTimelineVsyncId` before
`IntendedVsync` in the framestats CSV; the fixed-index parser reported 42,829,331 FPS. The
parser now resolves the column by header name; the same device reports **9.7 FPS / 100% jank /
p50 150 ms / PSS 124.6 MB** — honest telemetry for a software-GL emulator.

**Dock:** `DeviceMirrorDock` — live mirror (1.5 s poll, pause/resume), click-to-tap with
letterbox-correct coordinate mapping, profiler strip, explicit empty/packaged states;
registered in the `mobile_qa` preset and the header Panels menu.

**End-to-end proof:** clicking the Game button *inside the studio's mirror* injected
`Tap injected at (1045, 51) on emulator-5554` and the device opened the arena game
(device screenshot confirms the arena menu).

---

## Run Block 6 — 2026-09-25, Tier 2 Hardening & Scale Characterization (issues #6, #3)

### Renderer hardening (verified on-device)

- **Per-frame-in-flight sync:** each in-flight slot owns its `imageAvailable`/`renderFinished`
  semaphores + fence (kMaxFramesInFlight=2). Canonical-scene run: frames advance with
  `acquire=0 submit=0 present=0`, `frame 0/300/600 presented`, frame readback still writes a
  valid PPM.
- **Swapchain recreation** on `OUT_OF_DATE`/`SUBOPTIMAL` (acquire + present) — rebuilds
  swapchain/command buffers/fences/semaphores/capture buffer; scene buffers survive.
- **Validation layers:** `VK_LAYER_KHRONOS_validation` is enabled automatically in debug builds
  when present (verified in the Debug NDK build). The emulator image has no layer, so the
  validation soak remains open in issue #6 (layer must be packaged in the APK).
- **Asset freshness fix:** the Tier 2 container now always refreshes extracted assets — a stale
  `scene.native` silently rendered the previous build (found while validating the stress scene).

### Scale characterization (10k-instance export; emulator limit found)

| Metric | Value |
|--------|-------|
| Exporter, 10,000 batched instances | 1 indirect draw · 66 total draws (budget 100) · within budget |
| Host-side planning/packing coverage | 50k-scale dispatch planning + indirect packing (61 native host checks) |
| Emulator, 3 instances | stable for hours (multiple sessions) |
| Emulator, 500 instances | **emulator host process dies within ~60s** (gfxstream/lavapipe) |
| Emulator, 2,000+ instances | **emulator host process dies within seconds** |

The emulator's software Vulkan path cannot sustain multi-hundred-instance workloads; the app
process and the emulator host both die, with no validation output (no layer) and no host OOM.
This is an environment limitation rather than renderer logic: the CPU reference planning and
GPU indirect packing remain host-verified at 50k, and the on-device path is correct at small
scale. Multi-thousand-instance on-device validation therefore moves to physical hardware
(issue #1); issue #3 stays open with this characterization.

---

## Run Block 7 — 2026-09-25, Native Foliage Wind + Category Culling (issue #2, final item)

### What shipped

- **Instance categories**: the instance SSBO's unused `color.a` now carries 0 (scene) or
  1 (foliage; batch key `foliage`). The loader flags it, `packInstanceBatches` marks the CPU
  reference category, and host checks pin both.
- **Category-aware compute culling**: `cull.comp` compacts visible indices into per-category
  ranges and grows one indirect command per category; the renderer issues two indirect draws —
  scene geometry with `scenePipeline_`, foliage with the new `foliagePipeline_`.
- **Wind shader** (`foliage.vert`): pivot-at-base 3-unit blades with a two-frequency sway
  (slow gust + flutter), phase-offset per blade, driven by a wall-clock time push constant;
  shares the scene fragment lighting. Compiled SPIR-V committed (now 6 shaders).

### On-device verification (emulator, foliage grove scene, `--no-quadtree`)

| Check | Evidence |
|-------|----------|
| Foliage renders | `foliageVisible=240`; frame shows a green blade cluster on the arena |
| Wind animates | two captures 4 s apart differ by **0.57%** of sampled pixels, diff bbox exactly over the blade cluster |
| Scene path unaffected | canonical scene: `sceneVisible=3 foliageVisible=0`, terrain renders (1,122 colours) |
| Budget | foliage grove: 66 draws (1 mesh + 1 foliage batch + 64 terrain leaves) |

### Two real bugs found while validating

1. **Indirect counts never reset** — the culler's `atomicAdd` accumulated across frames
   (`foliageVisible` reached 14,160 after ~60 frames) and draws referenced stale visible slots.
   `recordFrame` now zeroes each category's count before the dispatch.
2. **Push constants never filled** — `graphicsConstants.time` and `foliageVisibleBase` were
   added to the struct but not assigned, so the foliage read the scene's visible range with
   `time=0` (static, wrong geometry). Both are set now, and the status log prints
   `sceneVisible`/`foliageVisible`/`time`, which is what exposed the issue.

---

## Run Block 8 — 2026-09-25, Vertical Slice #2: Driving Sandbox (Phase 5)

### What shipped

- **`GameRuntime` distance mode** (`mode: 'waves' | 'distance'`): no wave spawning; travelled
  planar metres accumulate into the session score (win at `targetScore`, lose at
  `timeLimitSeconds`); teleport-sized jumps and non-finite deltas ignored; restart resets.
  5 new tests (273 engine tests total).
- **QA runner distance mode** + **`driving_slice.json`**: the vehicle sprints 120 m down the
  avenue within 30 s. Rules: vehicle component stack, distance travelled, average speed,
  finish score, won phase, finite transforms, draw budget, FPS.
- **Playable mode** (`?play=driving`, studio header **Drive** button): VehicleController
  auto-cruise with keyboard/touch steering and braking, chase camera, distance HUD
  ("Distance 120.0m · 7.7s"), victory/restart.

### Verification

| Check | Evidence |
|-------|----------|
| Genre QA | **10/10 rules**, `phase=won`, score 120.06 m, avg speed 37.6 m/s, 2 draw calls; Artemis baseline recorded |
| Browser | menu → Start → auto-cruise → **Victory — 120.0m** in 7.7 s; restart resets to 0 |
| On-device (Tier 1 APK) | header **Drive** → Start → **Victory — 120.7m (7.8 s)**; telemetry `grounded=4/4`, `body z=-120.71` |

### Production-only bug found and fixed

The packaged APK silently skipped physics initialisation: `GameView` dispatched on
`component.constructor.name`, which the **production minifier mangles** — so `RigidBody3D`
became e.g. `t`, `initPhysics` never ran, the vehicle body stayed null, wheels never touched
the ground and the distance stayed 0 while the dev server worked perfectly. Fixed with
`instanceof` checks; the debug surface and AI harness scene summaries now prefer
`toJSON().type` over `constructor.name` for the same reason. The on-device telemetry hook
(`AndroidBridge.log` every 2 s: phase/distance/throttle/wheels/grounded/body) is what
pinpointed it and stays in place for future device debugging.

---

## Run Block 9 — 2026-09-25, Vertical Slice #3: Dungeon Action RPG (Phase 5)

### What shipped

- **Elemental damage routing** — `DamageRouter` routes hits through the target's
  `ElementalReactionComponent` when a hit element is configured (auras, Vaporize/Melt/
  Freeze/Overload scaling, physics effects), with single kill reporting and entity removal
  on elemental death; physical hits still apply plain damage to elemental health pools.
- **`GameRuntime.setHitElement`** — swaps the weapon hit element at runtime and re-attaches
  only the weapon router; the DungeonKeeper dialogue blessing drives it via the
  `hydro_blessing` event.
- **Genre QA scenario** (`dungeon_slice.json`, 11 rules): hydro-armed adventurer vs two waves
  of pyro slimes; rules cover the adventurer component stack, enemy chase, reactions, kills,
  won phase, transforms, draw budget, FPS — plus a `DungeonKeeper` dialogue tree.
- **Playable mode** (`?play=dungeon`, studio header **Dungeon** button): keeper dialogue
  overlay on Start, blessing choice, elemental enemy factory, reactions/dialogue debug surface.

### Verification

| Check | Evidence |
|-------|----------|
| Engine | **278/278 tests green** (`npm test`), app production build green |
| Genre QA | **11/11 rules SUCCEEDED** — `phase=won`, `kills=2`, `reactions=2`, enemy displacement 1.93 m, 2 draw calls |
| Playable | **Verified on-device** (Tier 1 APK): studio → **Dungeon** button → keeper menu → Start → live keeper dialogue with both blessing choices → auto-aim clears both slime waves → **Victory — 200 points (Score 200 · Wave 2 · Kills 2 · 2.0s)**; blessing tap advances/dismisses the dialogue |

---

## Run Block 10 — 2026-09-25, Vertical Slice #4: City Builder (Phase 5)

### What shipped

- **Settlement core** (`engine/src/simulation/Settlement.ts`) — plot-grid placement with
  bounds/occupancy/funds validation, fixed-step simulation (housing caps growth, farms feed
  mouths, markets earn gold, upkeep drains, surplus grows / shortage starves with deficit
  clamping), deterministic advance, demolish, snapshot, reset, target-population win.
- **Runtime build mode** — `GameRuntime` mode `'build'` advances an injected Settlement each
  frame and wins at its target population; `getSettlement()` exposes it; `restart()` resets it.
- **`GameSession.syncScore`** — mirrors an external sim value into the HUD score without
  triggering score wins (the owning runtime decides the phase).
- **Genre QA scenario** (`city_slice.json`, 7 rules): house + 2 farms + market growing to 6
  population; new `game_settlement_pop_min` / `game_settlement_gold_min` rules and settlement
  telemetry in the game report block.
- **Playable mode** (`?play=city`, studio header **City** button): the player founds an empty
  town — click-to-place on the ground mesh with grid snapping, build toolbar (house/farm/
  market with costs), treasury stats overlay, placement error messages, fixed overview
  camera. Arena snapshots stay out of city mode (the settlement grid is not serialized).

### Verification

| Check | Evidence |
|-------|----------|
| Engine | **290/290 tests green** (`npm test`), app production build green |
| Genre QA | **7/7 rules SUCCEEDED** — `phase=won`, `population=6`, treasury healthy, 1 draw call; Artemis baseline recorded |
| Playable | **Verified on-device** (Tier 1 APK): menu → Start → toolbar + 3 ground taps placed house + 2 farms (`CityPlace ok:true`) → live treasury → **Victory Pop 6/6**; restart resets to a fresh town |

### On-device findings fixed during validation

1. **Taps missed the build grid silently** — the playable town initially inherited the QA
   scenario's 8×8 grid while the visible ground spans ±18 world units, so ground taps
   raycast-hit but mapped to out-of-grid plots with no visible feedback. The playable town
   now uses a 24×24 founding grid (the QA scenario keeps its small deterministic grid).
2. **Silent tap path** — every tap/placement now logs to logcat (`CityTap` with NDC + hit
   count, `CityPlace` with plot + ok/reason), and placement rejections show in the message
   panel. This instrumentation is what exposed finding 1 and stays for device debugging.

---

## Run Block 11 — 2026-09-25, Phase 1 Milestone: Brief-Driven Production Run ✅

**Milestone check:** "build a small drivable island with 1 collection quest" through the full
recursive loop — **PASSED**.

### What shipped this block

- **Production-run CLI** (`python3 -m harness.loop.production_run --brief ...`) — was written
  but never committed before the first milestone attempt; committed now. Also fixes the
  `__main__` guard placement that crashed the first attempt before any work happened.
- **Vehicle wheels in the loop vocabulary** — attempt 1 failed precisely on `player-car`
  (the QA runner accepts `vehicle` configs but the loop couldn't emit them); spawn/modify
  now accept validated `vehicle` objects and prompts document the shape.
- **Wheels required, not optional** — attempt 2 crashed the QA runner
  (`VehicleController requires at least one wheel`); configs now require a non-empty
  `wheels` array with per-wheel offsets, matching the engine schema.
- **QA-crash recovery** — runner crashes feed the next repair iteration as a synthetic
  `qa_runner` failure (crash detail included) instead of aborting; still bounded by
  iteration/token/wall budgets, with the success path guarded so crashes can't fall through.
- **ADR-1790357825384** recorded: loop vocabulary must cover every QA-runner component a
  brief can require.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 6/6 automatable criteria verified (`island-ground`, `player-car`, `buoy-field`, `buoys-spin`, `draw-budget`, `sim-fps`); 2 critic-owned (`island-read`, `brief-faithful`) listed as scope candidates, not silently passed |
| Traversal milestone (follow-up run) | **GREEN** — 7/7 with new `island-traversable` criterion: generate (18 actions) → gate clean → QA **SUCCEEDED 7/7** in 1 iteration, 3,016 tokens; sweep reports coverage=1.0, 0 holes, 0 steep, 4 step hazards (reported in telemetry) |
| Loop trace | generate (10 actions incl. 4-wheel vehicle with offsets) → gate rejected spawn penetration → repair (3 actions) → QA **SUCCEEDED 6/6** in 2 iterations, 7,897 tokens |
| DAG + memory | 16 tasks (8 criteria × build + critique) in the ledger, states reflect the outcome; brief persisted and retrievable |
| Suites | 80 loop + 112 harness Python tests green |

Evidence: `harness/runs/loop_runs/20260925-133811-*.json` + `harness/scenes/loop_work_scene.json`.

---

## Run Block 12 — 2026-09-25, Phase 2 Rung 1: Streaming Valley ✅

**Valley brief** (`harness/briefs/examples/valley_streaming.json`: 8 criteria, 6 automatable
incl. `valley-traversable` + `streaming-seamless`) through the full production loop — **GREEN**.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 6/6 automatable (`valley-ground`, `player-car`, `valley-traversable`, `streaming-seamless`, `draw-budget`, `sim-fps`); 2 critic-owned (`valley-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate (13 actions incl. streamer config) → gate clean → QA **SUCCEEDED 6/6** in 1 iteration, 2,293 tokens |
| Gates | traversal sweep coverage=1.0 (0 holes); streaming transect coverage=1, 0 gaps, 0 thrash reloads |
| DAG + memory | 16 tasks in the ledger, all completed; brief persisted and retrievable |

Evidence: `harness/runs/loop_runs/20260925-140409-*.json`.

---

## Run Block 13 — 2026-09-25, Phase 2 Rung 2: Two-Biome Valley ✅

**Valley-biomes brief** (`harness/briefs/examples/valley_biomes.json`: 10 criteria, 8 automatable
incl. two regional `biome_coverage_min` rules) through the full production loop — **GREEN**.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 8/8 automatable (`valley-ground`, `player-car`, `sand-held`, `grass-held`, `valley-traversable`, `streaming-seamless`, `draw-budget`, `sim-fps`); 2 critic-owned (`valley-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate (21 actions incl. streamer config + sand/grass tags) → gate clean → QA **SUCCEEDED 8/8** in 1 iteration, 4,181 tokens |
| Composition | 4 live `sand` + 6 live `grass` objects; regional bounds enforced by the rule |
| Gates | traversal sweep coverage=1.0 (0 holes); streaming transect coverage=1, 0 gaps, 0 thrash reloads |
| DAG + memory | 20 tasks in the ledger, all completed; brief persisted and retrievable |

Evidence: `harness/runs/loop_runs/20260925-141538-*.json`.

---

## Run Block 14 — 2026-09-25, Phase 2 Rung 3: Open County (Three Districts) ✅

**County brief** (`harness/briefs/examples/county_districts.json`: 11 criteria, 9 automatable
incl. three regional `biome_coverage_min` rules: town/farm/wilds) through the full
production loop — **GREEN**. This run exercised the whole failure-recovery path, not just
the happy path.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 9/9 automatable (`county-ground`, `player-car`, `town-held`, `farms-held`, `wilds-held`, `county-traversable`, `streaming-seamless`, `draw-budget`, `sim-fps`); 2 critic-owned (`county-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate returned malformed JSON (0 actions, parse `failed`) → QA FAILED 2/9 → repair (10 actions) → gate rejected `Player Car`/`Farm Barn` spawn penetration → repair (1 action: move car +Z) → QA **SUCCEEDED 9/9** in 3 iterations, 13,598 tokens |
| Composition | 3 live `town` + 2 live `farm` + 2 live `wilds` objects, each inside its district region |
| Gates | traversal sweep coverage=1.0 (0 holes); streaming transect coverage=1, 0 gaps, 0 thrash reloads |
| DAG + memory | brief persisted and retrievable; tasks reflect the outcome |

Evidence: `harness/runs/loop_runs/20260925-142226-*.json`.

---

## Run Block 15 — 2026-09-25, Phase 2 Rung 4: Urban Center with Outskirts ✅

**Urban brief** (`harness/briefs/examples/urban_outskirts.json`: 11 criteria, 9 automatable
incl. three regional `biome_coverage_min` rules: downtown/suburbs/park) through the full
production loop — **GREEN**, first try. The Phase 2 ladder
(valley → two-biome valley → open county → urban center with outskirts) is complete:
all four rungs green, every automatable criterion verified on the real headless engine
runtime, every run committed with its loop trace as evidence.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 9/9 automatable (`urban-ground`, `player-car`, `downtown-held`, `suburbs-held`, `park-held`, `urban-traversable`, `streaming-seamless`, `draw-budget`, `sim-fps`); 2 critic-owned (`urban-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate (17 actions incl. streamer config + downtown/suburbs/park tags) → gate clean → QA **SUCCEEDED 9/9** in 1 iteration, 5,405 tokens |
| Composition | 6 live `downtown` + 4 live `suburbs` + 4 live `park` objects, each inside its district region |
| Gates | traversal sweep coverage=1.0 (0 holes); streaming transect coverage=1, 0 gaps, 0 thrash reloads |
| DAG + memory | brief persisted and retrievable; tasks reflect the outcome |

Evidence: `harness/runs/loop_runs/20260925-142522-*.json`.

---

## Run Block 16 — 2026-09-25, Phase 3 Rung 1: Arena Defense (Combat Quest) ✅

**Arena brief** (`harness/briefs/examples/arena_defense.json`: 13 criteria, 11 automatable
incl. five `game_*` quest rules: chase/kills/score/wave/phase) through the full production
loop — **GREEN**. First campaign-structure milestone: the loop now authors quest content
(`game` action + `weapon`/`health` fields, committed the prior turn), not just terrain.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 11/11 automatable (`arena-ground`, `player-hero`, `hero-armed`, `hero-tough`, `enemies-chase`, `kills-scored`, `score-awarded`, `wave-advanced`, `run-won`, `draw-budget`, `sim-fps`); 2 critic-owned (`arena-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate (18 actions: arena, hero, 4 hand-placed NPC enemies, covers, lights, waves config) → gate rejected capsule/ground spawn penetrations → repair (5 actions: raise heights above slab) → QA **SUCCEEDED 11/11** in 2 iterations, 7,009 tokens |
| Quest proof | real GameRuntime: enemies chased (0.75 m displacement), 2 kills, score 200, wave 2, phase=`won` |
| DAG + memory | brief persisted and retrievable; tasks reflect the outcome |

Evidence: `harness/runs/loop_runs/20260925-143005-*.json`.

---

## Run Block 17 — 2026-09-25, Phase 3 Rung 2: Settlement Run FAILED (Precise Defect) → Fix Forward ✅/❌

**Settlement brief** (`harness/briefs/examples/founding_hollow.json`: 8 criteria, 6 automatable)
through the production loop — **FAILED** 3/6 across all 4 iterations (13,698 tokens), with a
precise, root-caused defect (no false success claimed).

### Defect report

| Check | Evidence |
|-------|----------|
| Verdict | **FAILED** — `settlement-ground`, `draw-budget`, `sim-fps` verified; `population-grown`, `treasury-healthy`, `charter-granted` failed with `no game config in scenario` |
| Loop trace | generate (19 actions incl. a `game` action) → gate rejected a `Player Hero` penetration → repair (2 actions) → gate clean but still no game config → repair (1 action) → same → repair (0 actions, parse `failed`) → budget exhausted |
| Root cause | the model emitted a `game` action in iters 1–3 but `_validate_game` rejected all three — and the rejection detail was a **monolithic generic blob** listing every allowed field, never naming the offending key. The model saw the same un-actionable text three times and could not repair (likely extra descriptive keys like `name`/`description`, which the strict allow-list rejects by design) |
| Fix | validators now take an `errors` out-param: `_validate_game`/`_validate_game_enemy`/`_validate_game_settlement` report the **specific offense** (e.g. `unknown game key 'description' (allowed: …)`, `game 'totalWaves' must be a positive finite number (got 0)`), and `_apply_game` quotes it in the outcome detail that feeds the next repair prompt. 1 new test asserts rejections name the key (102 loop tests green) |

Evidence: `harness/runs/loop_runs/20260925-143359-*.json`. Re-run queued after the fix.

### Re-run (2026-09-25 14:36): FAILED 3/6 again — precise second defect

The specific errors fired exactly as designed — all 4 iterations reported
`game config rejected — unknown game settlement key 'name'` (the model nests a
descriptive `name` inside the settlement block every time). But repair still did
not converge, exposing the **last-mile defect**: `repair_messages` never received
the applier outcomes. The rejection detail existed only in the run log while the
model saw just the downstream symptom (`no game config in scenario`).

Fix: the loop now carries the previous iteration's rejected-action details into
the repair prompt (`REJECTED actions … fix these first — the scene does NOT
contain them`), alongside the QA failures. Covered by `test_prompts.py` (prompt
quotes rejections; absent by default) and a hermetic loop test proving an
invalid `game` action's reason reaches the next repair prompt. 105 loop tests green.

Evidence: `harness/runs/loop_runs/20260925-143603-*.json`. Third run queued.

### Third run (2026-09-25 14:39): FAILED 4/6 — feedback loop proven working, one schema gap left

Real movement: the model read the REJECTED-actions section, dropped the `name`
key, and landed a valid build config (treasury now passes, phase runs). Remaining
defect: `population-grown` 0/6, `charter-granted` stuck at `playing` — the applied
config has **no placements**, and the iter-4 placements attempt died on a bare
`must be an array` message. Root cause class: the engine's `Settlement.place()`
skips bad plots **silently**, so plot errors surface only as population
shortfalls. Fix: strict per-plot validation in the loop (type house/farm/market,
integer x/z inside the grid — mirroring `Settlement.place` preconditions) with
indexed reasons (`settlement placements[2].type must be one of …`), plus the
exact placements shape in the prompt schema doc. 106 loop tests green; the
known-good settle probe still SUCCEEDS 7/7 (validator is backward compatible).

Evidence: `harness/runs/loop_runs/20260925-143909-*.json`. Fourth run queued
with a wider iteration budget (6) since schema negotiation demonstrably consumes
rounds.

### Fourth run (2026-09-25 14:41): FAILED 4/6 — feedback fully working, content economy broken

The validation/repair feedback loop now works end to end: `game` configs applied
in iters 1, 3, 4, 5, 6 with zero schema rejections. But `population-grown` stays
0/6 through all five QA runs. Final work-scene config shows why: **17 valid
plots but `startingGold: 12`** — the first house costs 50g, so every placement
fails and zero buildings exist. The model never raised starting gold because
nothing tells it *why* pop is 0: the engine's `Settlement.place()` returns
per-plot reasons (`insufficient gold (need 50, have 12)`) that the runner
swallows. Treasury passes only vacuously (`12 >= 1`).

Next fix (not started): surface placement outcomes in the runner — report
placed/attempted counts plus the first `place()` failure reason inside the
settlement rule details/metrics, turning `population=0` into `0/17 plots
placed: insufficient gold (need 50, have 12)`.

Evidence: `harness/runs/loop_runs/20260925-144150-*.json`.

### Fifth run (2026-09-25 15:01): GREEN 6/6 — rung 2 closed ✅

With placement surfacing in the repair loop: generate (9 actions) → gate
rejected a penetration AND the indexed plot reason fired
(`settlement placements[1].x must be an integer plot inside the 8x8 grid`) →
repair (2 actions, game applied) → QA 5/6 with the placement footnote
(`plots placed 1/3; first failure: insufficient gold (need 40, have 0)`) →
repair (1 action: funded startingGold 500, 6 plots) → QA **SUCCEEDED 6/6** in
3 iterations, 9,899 tokens. Every fix in the Run Block 17 chain demonstrably
fired: specific rejection → REJECTED channel → strict plots → placement
footnote → green. **Phase 3 rung 2 PASSED.**

Evidence: `harness/runs/loop_runs/20260925-150134-*.json`.

---

## Run Block 18 — 2026-09-25, Phase 3 Rung 3: Keeper Blessing FAILED 5/8 (Precise Defects) → Fix Forward

**Dialogue brief** (`harness/briefs/examples/keeper_blessing.json`: 10 criteria, 8 automatable:
dialogue event/variable + reactions/phase + components + budget) through the production
loop — **FAILED** 5/8 across 6 iterations (44,125 tokens), with three root-caused
defects, two fixed before relaunch.

### Defect report

| # | Rule | Root cause | Fix (status) |
|---|------|-----------|--------------|
| 1 | `adventurer-ready` (`missing "Adventurer"`) | valid staged hero killed mid-run by its own wraiths; entity rules evaluate post-run and `destroyOnDeath` defaults true | prompt rule: size hero `maxHealth` with margin (shipped); ADR-1790363670157 |
| 2 | `blessing-taken` (fired `[none]`, flag set) | model's action node used bare `event`/`fireEvent` keys; engine only fires `emitEvent:{eventName}` | action-payload validator rejects unknown keys + malformed `emitEvent` with indexed reasons; exact shape in prompt docs (shipped) |
| 3 | `reactions-fired` (`reactions=0`) | loop had no elemental vocabulary: `hitElement`/`hitGauge` rejected as unknown game keys, no aura fields anywhere, zero prompt docs | `hitElement`+`hitGauge` game keys, `enemy.elemental`, spawn/modify `elemental`, both-halves prompt mapping (shipped, proven 3/3 on scratch) |

Loop-level defect: iters 3–6 burned on **empty LLM responses** (0 actions, identical QA) — new stall guard stops after 2 consecutive no-op iterations with a precise verdict (shipped, 2 tests).

Loop trace: generate (21 actions incl. valid game + dialogue) → gate rejected penetrations → repair (3 position fixes) → QA 5/8 → 4× empty responses → budget exhausted.

Evidence: `harness/runs/loop_runs/20260925-151042-*.json`. Relaunched with all three fixes.

### Second run (2026-09-25 15:15): GREEN 8/8 — rung 3 closed ✅

Generate (19 actions incl. valid `dialogue` + `game`) → gate rejected a penetration
AND the new elemental validator fired (`unknown game enemy elemental key 'moveSpeed'`)
→ repair (3 actions: fixed positions, moved the tunable out of the elemental block) →
QA **SUCCEEDED 8/8** in 2 iterations, 9,884 tokens — all 8 automatable
(`keeper-present`, `adventurer-ready`, `blessing-taken`, `blessing-flagged`,
`reactions-fired`, `hall-cleared`, `draw-budget`, `sim-fps`); 2 critic-owned
(`dungeon-read`, `brief-faithful`) listed, not passed. Every fix shipped for the
first run demonstrably fired in the second. **Phase 3 rung 3 PASSED.**

Evidence: `harness/runs/loop_runs/20260925-151528-*.json`.

---

## Run Block 19 — 2026-09-25, Phase 3 Rung 4: Checkpoint Keep (Save/Load) ✅

**Save/load brief** (`harness/briefs/examples/checkpoint_keep.json`: 10 criteria, 8 automatable
incl. `game_save_restore`) through the production loop — **GREEN** first pass at the
repair round. **Phase 3 complete: all four rungs green.**

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 8/8 automatable (`keep-floor`, `defender-ready`, `kills-scored`, `wave-advanced`, `save-compatible`, `run-won`, `draw-budget`, `sim-fps`); 2 critic-owned (`keep-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate (17 actions: keep, defender, props — no game action) → QA 4/8, all four game_* failing `no game config in scenario` → repair (1 action: the game action) → QA **SUCCEEDED 8/8** in 2 iterations, 9,266 tokens |
| Save proof | `save=ok; envelope=ok; restore=ok; monotonic=ok` (kills 7→12, wave 2→3, score 70→120 across the mid-run restore) |
| DAG + memory | brief persisted and retrievable; tasks reflect the outcome |

Evidence: `harness/runs/loop_runs/20260925-151800-*.json`.

---

## Run Block 20 — 2026-09-25, Phase 4: Sunset Duel (Look-Dev Calibration) ✅

**Look-dev brief** (`harness/briefs/examples/sunset_duel.json`: 9 criteria, 7 automatable:
dual cel-shader calibration, rival chase, win phase, budget + FPS) through the
production loop — **GREEN**. First milestone driven by the Tech-Artist vocabulary.

### Verification

| Check | Evidence |
|-------|----------|
| Milestone run | **GREEN** — 7/7 automatable (`ring-floor`, `hero-shaded`, `rival-shaded`, `rival-chases`, `round-won`, `draw-budget`, `sim-fps`); 2 critic-owned (`sunset-read`, `brief-faithful`) listed, not passed |
| Loop trace | generate returned malformed JSON (0 actions, parse `failed`) → QA FAILED 2/7 → repair (6 actions: ring, cel-shaded hero + physics-none AI rival, lights, waves config) → QA **SUCCEEDED 7/7** in 2 iterations, 8,515 tokens |
| Look-dev proof | both duelists carry `AnimeCelShader` alongside combat kits; rival chased 5.05 m; repair summary explicitly cites the prompt rules (AI + physics-none) |
| DAG + memory | brief persisted and retrievable; tasks reflect the outcome |

Evidence: `harness/runs/loop_runs/20260925-152130-*.json`.

---

## Run Block 21 — 2026-09-25, Track 0 Experiment 1: Delta-Loop Spike ❌ (Kill Criterion Failed, Transport Exonerated)

**Question:** can a batched TS→native delta bridge hold p95 ≤ 20 ms frames on the emulator?
**Setup:** `VulkanRenderer::syncInstances` (in-place mapped-slot rewrite) + `nativeSyncInstances`
JNI (critical arrays) + hidden-WebView fixed-dt 3-waypoint stepper + per-frame pacing/sync
timing (`SYNC_STATS` at frame 600). Commits `1c87bca` (transport) + `7b8c4f1` (rAF-throttle fix).

### Verdict

| Check | Evidence |
|-------|----------|
| Kill criterion p95 ≤ 20 ms | **FAILED** — `frames=599 p50=29.62ms p95=33.49ms max=445.25ms` (emulator-5554, logcat `HeretekTier2`) |
| Transport cost | **EXONERATED** — `syncBatches=597 meanSync=33.1us`; 33 µs cannot explain 33 ms frames |
| Attribution | lavapipe software rasterization at 2400×1080 + per-frame `evaluateJavascript` round-trip + `postDelayed(16)` UI-thread pacing |
| Motion proof | **INCONCLUSIVE** — dual PPM captures byte-identical; concurrent anomaly: `sceneVisible` telemetry flipped 3→0 mid-run, suggesting unsynchronized host-visible writes racing the compute cull dispatch (barrier/fence or double-buffering needed) and/or a stale capture path |
| Collateral finding | Hidden WebViews throttle `requestAnimationFrame` to zero — any WebView-driven gameplay must tick JS explicitly |

### Prescription (per spike contract — revisit, not abandon)
Option A stands: isolate render cost on physical hardware (blocked: #1) and design explicit
host↔device synchronization; input round-trip probe (experiment 2) proceeds against this
baseline. ADR-1790368134523.

---

## Run Block 22 — 2026-09-25, Track 0 Experiment 2: Input Round-Trip Probe ⚠️ (Path Proven, Latency Partial)

**Question:** does a tap reach staged motion within ≤ 3 frames?
**Setup:** tap-driven mover-0 target through `__probeTick` input; `INPUT_TAP` receipt timestamps
+ mover-x trace every 10 frames (`INPUT_PROBE`). Commit `9b1f103`.

### Verdict

| Check | Evidence |
|-------|----------|
| Full path tap→photon-path | **PROVEN** — tap (2000,500) → `INPUT_TAP x=0.667` → JS target → staged sync → mover eased 0.0 → 6.667 (exact target = 0.667×10), converged and held |
| Latency ≤ 3 frames | **NOT MET on evidence** — tap landed 14.7 ms after frame 4350's apply; first moved sample frame 4360 (+268 ms). 10-frame trace granularity bounds true latency at ≤ 10 frames (consistent with ~2–5, unresolvable without per-frame tracing) |
| Incidental findings | Touch space is 2400×1080 landscape despite `wm size` reporting portrait — off-space taps clip silently (voided two earlier taps); hidden-WebView rAF lesson reinforced |

### Prescription
Per-frame tracing window (log every frame for ~60 frames post-tap) or hardware measurement
(blocked: #1) to resolve ≤ 3. Path proven; no architecture change indicated. ADR-1790368461390.

---

## Run Block 24 — 2026-09-25, Track 0 Gate Review: GREEN ✅

Every Track 0 item verified with evidence; Track 1 unlocked (bridge ADR satisfied).

| Item | Evidence | Status |
|------|----------|--------|
| Desktop shell | Electron-first ADR-1790367094692 (WebKitGTK risk, verbatim bridges, skill fit) | ✅ closed |
| Tier 2 parity + flip rule | `tier2_parity.json` (20 entries, 6 honestly missing) + checker + first CI (commit `5229b3f`) | ✅ closed |
| Bridge spike | Option A delta bridge ADR-1790367301826; exp-1 transport exonerated (33 µs), exp-2 input path proven; wasmtime tracked successor (fit-check pending, non-blocking) | ✅ closed |
| Scene migration | `harness/scenes/v2.py` + 5 gate tests + QA parity 5/5 original vs reassembled (commit `d463f0f`) | ✅ closed |
| Scalability tiers | `harness/perf/tiers.py` (S/A/X + fallback ladder) wired into brief validation, backward compatible (commit `d39e5e4`) | ✅ closed |

**Track 1 unlocked.** First item: prefabs/variants (builds directly on the v2 format).

---

## Run Block 23 — 2026-09-25, Track 0: Tier 2 Parity Checklist + CI Flip Rule ✅

**Parity gate mechanized:** `harness/tier2_parity.json` (20 entries: full/partial/missing/web-tier
with notes) is now the source of truth for Tier 1 vs Tier 2 capability coverage;
`harness/build/check_tier2_parity.py` fails when any runner-constructed capability lacks
an entry (it caught a missing `VehicleController` entry on its own first run);
`.github/workflows/ci.yml` runs engine + harness + native + parity on every push/PR —
the repo's first CI. Honest count: 6 missing (camera, physics, input-productized,
models, cel-shader, runtime stream refocus). 3 checker tests green; all CI commands
verified locally (70-module suite OK).
