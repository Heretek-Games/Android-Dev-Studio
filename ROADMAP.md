# Project Roadmap: Heretek 3D Android Studio & AI Harness

A phased roadmap tracking progress from foundational 3D engine systems to AAA-tier mobile production (Genshin Impact, Anno 1800, and Doom 2016 scope).

---

## 🗺️ Milestone Overview

| Milestone | Focus Area | Status | Target Deliverables |
| :--- | :--- | :---: | :--- |
| **Milestone 1** | **3D Engine Core & ECS** | ✅ **Complete** | Spatial Transform hierarchy, GameObject/Component lifecycle, Three.js PBR renderer, Rapier3D WASM physics, Mobile touch input, GDevelop-style visual EventSheets. |
| **Milestone 2** | **Desktop Studio IDE** | ✅ **Complete** | Dockable panel interface (Dockview), 3D Viewport with transform gizmos (Translate/Rotate/Scale), Hierarchy, Inspector, Visual Event Editor, Asset Browser, Device Bar. |
| **Milestone 3** | **Android Mobile Container (Tier 1)** | ✅ **Complete** | Fullscreen landscape activity (`MainActivity.kt`), hardware-accelerated WebView container (`WebViewAssetLoader`), native haptics/vibration and Logcat bridges. |
| **Milestone 4** | **Live LLM AI Harness** | 🚀 **Active** | Integration with live LLM endpoints (`https://llm.heretek.one/v1`, model `mimotp/mimo-v2.6-flash`), real-time prompt-to-scene AST generation, reasoning trace stream. |
| **Milestone 5** | **GDevelop & CC0 3D Asset Store** | ⏳ **Queued** | Ingest public GDevelop Asset Store CDN (`resources.gdevelop-app.com/assets-database`), Poly Haven, and Kenney into Asset Browser for 1-click 3D pack installs. |
| **Milestone 6** | **Dual-Tier Native Vulkan Export (Tier 2)** | ⏳ **Queued** | Scaffolding Native C++/NDK Vulkan runtime shell (zero WebView) for 60–120 FPS high-draw-call titles (Genshin, Anno, Doom scale). |
| **Milestone 7** | **Artemis QA & OpenCode Delegation** | ✅ **Complete** | Google Artemis autonomous playtesting agent (`artemis_qa_runner.py`), Studio MCP server (`mcp_server.py`), and OpenCode delegation bridge (`opencode-mcp`). |

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

### Milestone 4: Live LLM AI Harness (`.env.prod` Integration) 🚀
- [ ] Connect Studio AI Copilot to live LLM endpoint `https://llm.heretek.one/v1` via secure Vite proxy.
- [ ] Support reasoning model `mimotp/mimo-v2.6-flash` with streaming thought tokens and action JSON parsing.
- [ ] Implement self-healing loop: feed runtime exceptions and Logcat traces into LLM for automated script patches.

### Milestone 5: GDevelop & CC0 3D Asset Store Integration ⏳
- [ ] Implement `GDevelopAssetService.ts` querying `https://resources.gdevelop-app.com/assets-database/assetPacks.json`.
- [ ] Add "Asset Store" tab in `AssetBrowser.tsx` allowing 1-click download of Quaternius 3D robots/characters, Kenney props, and Poly Haven skyboxes.
- [ ] Expose asset store querying and installation to the AI Copilot via Studio MCP (`studio_search_and_install_asset`).
- [ ] Add Unity `.unitypackage` decompression and FBX-to-glTF conversion pipeline.

### Milestone 6: Dual-Tier Native Vulkan Mobile Container (Tier 2) ⏳
- [ ] Scaffold native C++/NDK Android project using Google Filament or Godot 4 Vulkan Mobile core.
- [ ] Build scene exporter: translate `project.scene.json` into native Vulkan scene graphs.
- [ ] Implement GPU compute culling and instanced draw calls for 50k+ simulated entities (Anno 1800 scale).
- [ ] Implement quadtree terrain and mesh LOD streaming (Genshin Impact scale).

### Milestone 7: Autonomous QA & OpenCode Delegation ✅
- [ ] Configure `opencode-mcp` in `~/.gemini/config/mcp_config.json` with auto-serve on port 4096.
- [ ] Integrate Google Artemis autonomous mobile testing runner (`artemis_qa_runner.py`) for on-device 60 FPS profiling and crash reproduction.
- [ ] Expose 6 Studio MCP tools for external AI coding assistants (`mcp_server.py`).
