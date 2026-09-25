# Heretek Tier 2 — Native Vulkan Mobile Container

The high-performance native path for **Android-Dev-Studio**: the same game
scenes produced by the studio's WebGL2 tier are exported and rendered through a
native C++/Vulkan container for 50k+ entity workloads and GPU compute culling.

## Layout

```
vulkan-container/
├── app/src/main/
│   ├── assets/scene.native        # exported by harness/build/scene_exporter.py
│   ├── java/.../MainActivity.kt   # SurfaceView loop + JNI bridge
│   └── cpp/
│       ├── CMakeLists.txt         # NDK shared library (libheretek_native.so)
│       ├── scene_loader.{h,cpp}   # dependency-free scene.native parser
│       ├── culling.{h,cpp}        # CPU frustum culling + instanced batch packing
│       ├── vulkan_renderer.{h,cpp}# Vulkan instance/device bootstrap (guarded)
│       ├── jni_bridge.cpp         # nativeInit/nativeFrame/nativeShutdown
│       └── tests/native_scene_test.cpp
├── app/build.gradle.kts           # AGP + externalNativeBuild (arm64-v8a)
├── build.gradle.kts
└── settings.gradle.kts
```

## Scene export (source of truth → native)

```bash
python3 harness/build/scene_exporter.py \
  --scene harness/scenes/active_scene.json \
  --quadtree --lod-depth 3 --lod-focus 0 0 \
  --out templates/vulkan-container/app/src/main/assets
```

Emits `scene.native` (line format, see `scene_exporter.py` docs) plus
`scene.summary.json` with draw-call estimates against the 100-call mobile
budget. The format is deterministic and dependency-free.

## Host-side native tests (no NDK required)

The scene loader and culling math are platform-independent and tested on the
host — the culling test caught a real row/column-major frustum bug during
development:

```bash
cd templates/vulkan-container/app/src/main/cpp
g++ -std=c++17 -Wall -Wextra scene_loader.cpp culling.cpp tests/native_scene_test.cpp -o /tmp/native_scene_test
/tmp/native_scene_test ../../assets/scene.native
```

## Android NDK build

The Gradle wrapper is vendored (`./gradlew`, Gradle 8.11.1); the build requires
a JDK 17–23 (Gradle 8.11 supports up to Java 23 — an incompatible `JAVA_HOME`
fails fast with a clear message).

```bash
# Via Gradle (downloads AGP 8.5.2/Kotlin 1.9.24 on first run):
cd templates/vulkan-container && ./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
#   (verified locally: arm64-v8a libheretek_native.so + scene.native + 4 SPIR-V shaders)

# Or directly with CMake + the NDK toolchain (fast CI verification path):
cmake -S app/src/main/cpp -B /tmp/tier2-build \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_HOME/ndk/<version>/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/tier2-build
# → libheretek_native.so
```

## Tier 2 status

| Capability | Status |
|---|---|
| Scene exporter (`project.scene.json` → `scene.native`) | ✅ done, unit-tested |
| Native scene loader + draw-call/instance telemetry | ✅ done, host-tested |
| CPU frustum culling + dispatch planning + indirect draw packing | ✅ done, host-tested (50k-scale checks) |
| GLSL compute/render shaders compiled to SPIR-V (`glslc`) | ✅ 4 shaders (cull + scene vert/frag + terrain), committed .spv |
| Vulkan swapchain + render pass + framebuffers | ✅ compiles (NDK) |
| Compute culling dispatch + instanced indirect draws | ✅ **on-device validated** (emulator, android-36 x86_64): 3 instanced cubes + 64 terrain LOD leaf draws, `VK_SUCCESS` acquire/submit/present, ~61.5 FPS; rendered output confirmed on-display and via PPM readback |
| JNI bridge + SurfaceView frame loop + surface lifecycle | ✅ on-device validated (scene parse/upload, surface create/destroy, 60 Hz frame loop) |
| Quadtree terrain LOD export + native parsing | ✅ focus-driven leaves exported (`--quadtree`), parsed into `TerrainLodRecord` (with `terrain_meta` depth), host-tested |
| Native terrain mesh generation + GPU upload | ✅ heightmap-displaced grid meshes packed into shared vertex/index buffers with per-leaf indirect draw commands; one `vkCmdDrawIndexedIndirect` renders every LOD leaf (terrain pipeline from `terrain.vert`), host-tested packing |
| Gradle APK assembly | ✅ vendored wrapper builds `app-debug.apk` (arm64-v8a + x86_64 `.so`, `scene.native`, 4 SPIR-V shaders); installed + launched on an emulator |

### Runtime telemetry & frame readback

A one-command smoke test boots the emulator, builds/installs/launches both containers, and
asserts this telemetry (exit non-zero on failure):

```bash
python3 harness/agents/emulator_smoke.py --reuse --skip-build
```

The native renderer logs to logcat under the `HeretekTier2` tag:

```
Scene ready — draws=67 instances=0 terrainLeaves=64 terrainVertices=77888
swapchain.create: ...  /  surface caps: extent=2400x1080 minImages=3 formats=5
swapchain created: 0x...  /  createSurface complete: swapchain=0x... images=4 commandBuffers=4
frame draw state: instances=3 indirectCmds=1 terrainDraws=64
renderFrame status: acquire=0 submit=0 present=0 capture=0   (every 300 frames)
```

`MainActivity` requests a one-shot readback of the rendered swapchain image two
seconds after surface creation (`nativeCaptureFrame` → PPM). Pull it with:

```bash
adb exec-out run-as com.heretek.gamestudio.tier2 cat files/native_frame.ppm > frame.ppm
```

This verifies rasterized pixels independently of the display/compositor path —
useful on emulators whose Vulkan WSI does not deliver buffers to SurfaceFlinger.

Shaders are compiled with the NDK's bundled glslc:

```bash
templates/vulkan-container/compile-shaders.sh
# -> app/src/main/assets/shaders/{cull.comp,scene.vert,scene.frag}.spv
```

The frame path: compute pass (`cull.comp`) tests every instance against the
six Gribb–Hartmann frustum planes and writes the visible set + indirect draw
instance count atomically → memory barrier → graphics pass issues one
`vkCmdDrawIndexedIndirect` covering the visible instances (vertex shader reads
the visible-index SSBO). CPU-side planning math is shared with the host tests
via `culling.cpp`.
