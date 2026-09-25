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
| Tier 2 native init (scene parse + upload) | ✅ `draws=67 terrainLeaves=64 terrainVertices=69696` |
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
