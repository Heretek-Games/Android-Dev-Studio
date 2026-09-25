# Artemis Autonomous 3D Game QA Mindset & Guidelines

When testing 3D Android games developed in **Heretek 3D Android Studio**, AI agents and test runners must follow these core principles:

## 1. Dynamic-First, Coordinate-Fallback Locator Pattern
* **On-Screen Virtual Sticks**:
  - Locate virtual analog joysticks dynamically via bounding box `#joystick-container` or screen quarter quadrant (Bottom-Left: 0–30% X, 70–100% Y).
  - Use relative vector drags from the stick center rather than absolute screen coordinates.
* **Action Buttons**:
  - Prioritize OCR / Text matching for on-screen labels (`JUMP`, `ACTION`, `FIRE`).
  - Fall back to standard mobile touch coordinates when custom 3D mesh overlays are rendered directly to WebGL canvas.

## 2. Timing & Physics Compensation
* **Rapier3D Simulation Step**:
  - Allow 100–300ms latency after initiating touch joystick drags for physics momentum and character acceleration to take effect.
  - For jump assertions, wait until peak arc (~400ms) before evaluating height or collision triggers.

## 3. Telemetry & Logcat Diagnostics
* Monitor Logcat tag `StudioGameLog`:
  - `[INFO]`: General engine and scene state transitions.
  - `[WARN]`: Dropped frames (<60 FPS) or asset loading delays.
  - `[ERROR]`: Shader compilation failures, physics NaN bounds, or uncaught exceptions.
* Any unhandled error in Logcat halts test runs and triggers the Studio AI Copilot self-healing routine.

## 4. Two QA Paths (use both, in this order)

### 4a. Headless engine runs (default, deterministic, CI-friendly)
`artemis_qa_runner.py` → `qa_scenario_runner.mjs` boots the scenario on the real engine
runtime — no GPU, no device. It measures sim frame cost, estimates GPU draw calls against
the **100 draw-call mobile budget**, records the memory heap, evaluates game-rule
assertions, and compares against the same-scenario baseline in `project_memory.sqlite`.
Use it for regression gates on every change:

```bash
python3 harness/agents/artemis_qa_runner.py --goal "<what you are verifying>" \
  --scenario harness/config/scenarios/<scene>.json --frames 600
```

Scenario specs define `gameObjects` (mesh/light/controller/events) and `rules`
(`entity_exists`, `entity_component`, `event_attached`, `object_count`,
`transform_changes`, `transform_bounds`, `no_nan_transforms`, `draw_call_budget`,
`fps_min`). MCP-mutated live scenes persist to `harness/scenes/active_scene.json` and
can be booted with `--scenario` pointing at that file.

### 4b. On-device playtests (Artemis UI automation, when hardware is attached)
Drive the deployed APK as described in sections 1–2; primary metric is the on-device
frame time (Logcat `[WARN]`/`[ERROR]`) — the headless FPS estimate is compute throughput,
not a GPU render measurement, so never substitute one for the other.
