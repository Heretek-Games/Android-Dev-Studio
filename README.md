# Heretek 3D Android Studio & AI Harness

<p align="center">
  <strong>An in-house Desktop 3D Game Development Studio and AI Harness tailored for Android.</strong><br>
  <em>Bridging the visual agility of GDevelop and the component depth of Unity, powered by an integrated AI Copilot and autonomous mobile playtesting via Google Artemis.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Three.js-0.170-black.svg?logo=three.js" alt="Three.js">
  <img src="https://img.shields.io/badge/Physics-Rapier3D%20WASM-orange.svg" alt="Rapier3D">
  <img src="https://img.shields.io/badge/Target-Android%2010+-green.svg?logo=android" alt="Android">
  <img src="https://img.shields.io/badge/Artemis-99%25%2B%20SOTA%20QA-purple.svg" alt="Google Artemis">
  <img src="https://img.shields.io/badge/MCP-Native%20Server-8A2BE2.svg" alt="MCP Server">
</p>

---

## 🌟 Key Highlights

- **3D Engine Core**: Three.js PBR graphics and `@dimforge/rapier3d-compat` WebAssembly physics with rigid bodies, colliders, raycasting, and mobile character controllers.
- **Hybrid Scripting Paradigm**:
  - **Visual Event Sheets** (GDevelop style): Conditions & Actions editor for no-code logic and rapid prototyping.
  - **TypeScript Components** (Unity `MonoBehaviour` style): Full lifecycle (`awake`, `start`, `update(dt)`, `onCollisionEnter`, `onDestroy`).
- **Desktop Studio Interface**:
  - **3D Viewport**: Orbit controls, camera presets, transform gizmos (Translate, Rotate, Scale), and real-time mobile touch emulation.
  - **Scene Hierarchy**: Tree view of GameObjects, parent-child nesting, and primitive spawners.
  - **Inspector**: Live editing of transforms, PBR materials, lights, physics bodies, and mobile joysticks.
  - **Asset Browser**: Project management for glTF 2.0 (`.glb`/`.gltf`), textures, audio, and scene files.
- **AI Studio Copilot**:
  - Natural language prompt-to-world ("Create a desert obstacle course with 5 pillars, floating platforms, sunset lighting, and a player sphere").
  - Automated code generation, component wiring, and self-healing.
- **Google Artemis Autonomous Game QA**:
  - Integrates with [Google Artemis](https://github.com/google/artemis) (99%+ AndroidWorld SOTA).
  - **Headless engine runs**: boots scenario specs on the real runtime (Rapier3D + EventSheet) — real sim FPS, frame time, GPU draw-call estimate against the 100-call mobile budget, memory heap, and game-rule assertions.
  - **Regression gate**: every run compares against the same-scenario baseline in `project_memory.sqlite` and emits `SUCCEEDED` / `REGRESSED` / `FAILED`.
  - **On-device playtests**: autonomous touch automation on real Android phones or emulators via ADB; audits frame time and diagnoses Logcat crashes.
- **Two-Tier Model Context Protocol (MCP)**:
  - Built-in MCP server (`harness/mcp_server.py`) allowing external AI coding assistants (Antigravity, Claude Code, Cursor) to inspect the 3D scene and execute editor actions programmatically (9 tools).
  - Scene mutations persist to `harness/scenes/active_scene.json` and sync snapshots into project memory; `studio_run_artemis_qa` boots that exact live scene headless.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+ or v20+)
- **Python** (3.10+)
- **Android SDK & ADB** (configured in `$ANDROID_HOME` with USB debugging enabled on phone/emulator)

### 2. Installation
```bash
# Clone repository
git clone https://github.com/Heretek-Games/Android-Dev-Studio.git
cd Android-Dev-Studio

# Install monorepo dependencies
npm install

# Build core 3D engine
npm --workspace=engine run build
```

### 3. Launch Desktop Studio
```bash
# Start Vite development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser (or run with Electron).

---

## 🧪 Testing

```bash
# Run Engine ECS, Scene Graph, and EventSheet Unit Tests
npm test
```

---

## 🤖 Google Artemis Autonomous QA

**Headless scenario runs (default, deterministic)** — boots the scene on the real engine
runtime with Rapier3D physics and EventSheet execution, then evaluates game rules and
compares metrics against the same-scenario baseline:

```bash
# QA the live MCP-controlled scene (harness/scenes/active_scene.json)
python3 harness/agents/artemis_qa_runner.py --goal "Verify player physics and spin events"

# QA a named scenario spec
python3 harness/agents/artemis_qa_runner.py --goal "Mini arena QA" --scenario harness/config/scenarios/mini_arena.json
```

Verdicts: `SUCCEEDED` · `REGRESSED` (FPS −20% / frame time +20% / draw calls +25% / heap +30% vs same-scenario baseline) · `FAILED` (rule assertions). Reports land in `harness/artemis_report.json`. The Studio's Artemis dock drives the same runner through the dev-server bridge (`POST /api/qa/run`).

**On-device playtests** on a connected Android phone or emulator via ADB (touch automation and frame-time/Logcat auditing) follow the locator pattern in `harness/config/artemis_game_rules.md`.

To connect AI coding assistants to the Studio via Model Context Protocol:
```bash
python3 harness/mcp_server.py
```

---

## 📁 Repository Structure

```
Android-Dev-Studio/
├── app/                              # Desktop Studio UI (React, Tailwind, Three.js Viewport)
│   ├── src/components/
│   │   ├── Viewport3D.tsx            # 3D canvas, gizmos, mobile touch HUD
│   │   ├── Hierarchy.tsx             # Scene graph tree
│   │   ├── Inspector.tsx             # Transform, materials, physics inspector
│   │   ├── EventSheetEditor.tsx      # GDevelop visual condition-action editor
│   │   ├── AIHarnessDock.tsx         # Natural language world & logic copilot
│   │   ├── ArtemisQADock.tsx         # Google Artemis autonomous test runner
│   │   ├── AssetBrowser.tsx          # glTF models, textures, audio
│   │   └── DeviceBar.tsx             # ADB device selector & APK deployer
│   └── vite.config.ts
│
├── engine/                           # Core 3D Game Engine (Shared Editor & Android Runtime)
│   ├── src/core/                     # Transform, Component, GameObject, Scene, EngineContext
│   ├── src/components/               # MeshRenderer, LightComponent, RigidBody3D, Collider3D, MobileController
│   ├── src/events/                   # EventSheet visual condition-action interpreter
│   ├── src/physics/                  # Rapier3D WASM physics world
│   └── src/input/                    # Mobile touch joystick & keyboard mappings
│
├── templates/
│   └── android-container/            # High-performance Android Gradle Template
│       ├── app/src/main/
│       │   ├── AndroidManifest.xml   # Fullscreen landscape, WebGL2 hardware acceleration
│       │   └── java/                 # MainActivity with WebViewAssetLoader & haptic bridge
│       └── build.gradle
│
└── harness/                          # AI Harness, Artemis QA & Studio MCP Server
    ├── agents/artemis_qa_runner.py   # Autonomous mobile playtest runner
    ├── mcp_server.py                 # Studio Model Context Protocol server
    └── config/artemis_game_rules.md  # Autonomous QA behavioral rules
```

---

## 📄 License
MIT License - Copyright (c) Heretek Games.
