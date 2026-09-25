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

namespace heretek {

enum class PhysicsType : uint8_t { None = 0, Fixed = 1, Dynamic = 2 };

struct MeshRecord {
  std::string name;
  float px = 0, py = 0, pz = 0;
  float sx = 1, sy = 1, sz = 1;
  float r = 0.5f, g = 0.5f, b = 0.5f;
  PhysicsType physics = PhysicsType::None;
};

struct InstanceRecord {
  std::string batch;
  float px = 0, py = 0, pz = 0;
  float rotY = 0;
};

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
};

/**
 * Parses scene text. Returns false and fills `error` (with a line number) when
 * a record is malformed; the partially filled scene must then be discarded.
 */
bool parseSceneText(const std::string& text, NativeScene& out, std::string& error);

/** Loads and parses a scene.native file from disk. */
bool loadSceneFile(const std::string& path, NativeScene& out, std::string& error);

}  // namespace heretek
