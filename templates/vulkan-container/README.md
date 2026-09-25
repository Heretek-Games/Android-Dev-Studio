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

```bash
# Via Gradle (requires AGP download):
cd templates/vulkan-container && ./gradlew :app:assembleDebug

# Or directly with CMake + the NDK toolchain (what CI verification uses):
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
| GLSL compute/render shaders compiled to SPIR-V (`glslc`) | ✅ 3 shaders, committed .spv |
| Vulkan swapchain + render pass + framebuffers | ✅ compiles (NDK) |
| Compute culling dispatch + instanced indirect draws | ✅ implemented, compiles; on-device runtime validation pending |
| JNI bridge + SurfaceView frame loop + surface lifecycle | ✅ implemented, compiles |
| Quadtree terrain LOD export + native parsing | ✅ focus-driven leaves exported (`--quadtree`), parsed into `TerrainLodRecord` (with `terrain_meta` depth), host-tested |
| Native terrain mesh generation | ✅ heightmap-displaced grid meshes per leaf (LOD-scaled resolution, normals, deterministic budgets), host-tested; per-leaf GPU buffer upload remains |

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
