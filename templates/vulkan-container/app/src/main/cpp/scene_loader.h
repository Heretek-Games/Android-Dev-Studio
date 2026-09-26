// Heretek Tier 2 — native scene loader (dependency-free, host-testable).
//
// Parses the `scene.native` line format emitted by
// harness/build/scene_exporter.py into POD records consumed by the Vulkan
// renderer. No Vulkan/JNI/Android dependencies: this file compiles with any
// C++17 toolchain so it can be unit-tested on the host.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "nav_bake.h"

namespace heretek {

enum class PhysicsType : uint8_t { None = 0, Fixed = 1, Dynamic = 2 };

struct MeshRecord {
  std::string name;
  // Doubles: scene values parse once at full precision (the TS engine
  // computes in float64 — float32 inputs flipped erosion-boundary cells in
  // parity). Rendering narrows to float at upload; no visual difference.
  double px = 0, py = 0, pz = 0;
  double sx = 1, sy = 1, sz = 1;
  double r = 0.5, g = 0.5, b = 0.5;
  PhysicsType physics = PhysicsType::None;
  /** Track C.3 PBR factors (glTF-shaped; absent on v1 lines = defaults). */
  double metallic = 0.0;
  double roughness = 0.9;
  /** True = flat albedo (stylized/cel fallback); false = Cook-Torrance. */
  bool unlit = false;
};

struct InstanceRecord {
  std::string batch;
  double px = 0, py = 0, pz = 0;
  double rotY = 0;
  /** Foliage instances (batch key "foliage") get wind deformation on the GPU. */
  bool foliage = false;
  double r = 0.45, g = 0.65, b = 0.35;
  double metallic = 0.0;
  double roughness = 0.9;
  bool unlit = false;
  /** True when the line predates material tokens: the renderer keeps the
   * legacy hardcoded category colors so old scenes render identically. */
  bool legacy = true;
};

/** Batch key that marks instances for the wind-animated foliage pipeline. */
constexpr const char* kFoliageBatch = "foliage";

struct LightRecord {
  std::string name;
  float px = 0, py = 0, pz = 0;
  float r = 1, g = 1, b = 1;
  float intensity = 1;
  std::string type = "directional";
};

/** Focus-driven terrain LOD leaf (one draw call per leaf in the native path). */
struct TerrainLodRecord {
  std::string id;
  uint32_t depth = 0;
  float minX = 0, minZ = 0, maxX = 0, maxZ = 0;
  uint32_t lod = 0;
  float blend = 0;
};

struct NativeScene {
  std::string name;
  std::vector<MeshRecord> meshes;
  std::vector<InstanceRecord> instances;
  std::vector<LightRecord> lights;
  std::vector<TerrainLodRecord> terrainLod;
  /** Quadtree depth used for the terrain_lod export (0 when absent). */
  uint32_t terrainMaxDepth = 0;
  float terrainFocusX = 0, terrainFocusZ = 0;

  /** One draw per mesh + one draw per unique instanced batch + one per LOD leaf. */
  int drawCallEstimate() const;
  int uniqueBatchCount() const;

  /** Track C.6 strangler seam: native walkability bake over the mesh bounds
   * (cell 1, agent radius 0.4 — the engine defaults). Computed at upload,
   * logged, no behavior change yet; the future native nav runtime consumes it.
   * TS bakeWalkability stays the source of truth (parity-tested). */
  NavBakeResult bakeNavGrid() const;
};

/**
 * Parses scene text. Returns false and fills `error` (with a line number) when
 * a record is malformed; the partially filled scene must then be discarded.
 */
bool parseSceneText(const std::string& text, NativeScene& out, std::string& error);

/** Loads and parses a scene.native file from disk. */
bool loadSceneFile(const std::string& path, NativeScene& out, std::string& error);

}  // namespace heretek
