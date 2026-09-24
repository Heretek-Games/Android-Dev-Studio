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

### 3. Autonomous Mobile QA with Google Artemis
When testing mobile Android gameplay:
```bash
python3 harness/agents/artemis_qa_runner.py --goal "Navigate player character past obstacle course and verify 60 FPS"
```
Adhere to the **Dynamic-First, Coordinate-Fallback** locator pattern for mobile touch controls documented in [`harness/config/artemis_game_rules.md`](file:///home/john/Projects/Android-Dev-Studio/harness/config/artemis_game_rules.md).

### 4. OpenCode Delegation for Token Savings
To conserve subscription credits, Antigravity should delegate file generation, repetitive refactoring, and boilerplate implementation to OpenCode via `opencode-mcp` tools (`opencode_run`, `opencode_fire`, `opencode_review_changes`). Antigravity acts as the architect and reviewer.

---

## 📜 Coding Conventions & Invariants
- **TypeScript**: Strict mode enabled. Use explicit typings for public APIs and interfaces.
- **Component Lifecycle**: Every game component must inherit from `Component` and adhere to `awake()`, `start()`, `update(dt)`, `lateUpdate(dt)`, `onCollisionEnter()`, and `onDestroy()`.
- **Physics Coordinates**: Rapier3D positions and rotations must synchronize with `GameObject.transform`.
- **Documentation**: Preserve all existing comments and docstrings. Use standard GitHub markdown links with `file://` scheme when referencing files.
