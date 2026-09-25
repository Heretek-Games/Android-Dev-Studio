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
| CPU frustum culling + instanced batch packing | ✅ done, host-tested |
| Vulkan instance/device bootstrap | ✅ compiles (NDK), device-dependent at runtime |
| JNI bridge + SurfaceView frame loop | ✅ scaffolded |
| GPU compute culling dispatch + instanced draw calls (50k+) | 🚧 next |
| Quadtree terrain + mesh LOD streaming | 🚧 next (TS engine has `TerrainChunk`/`StreamingCells` today) |
