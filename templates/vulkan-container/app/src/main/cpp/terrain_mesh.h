// Heretek Tier 2 — terrain mesh generation from quadtree LOD leaves.
//
// Generates CPU-side terrain grid meshes (heightmap displacement + normals)
// for each terrain_lod leaf exported by harness/build/scene_exporter.py. The
// heightmap mirrors the TS engine's TerrainChunk algorithm (multi-octave
// interpolated value noise) so both tiers produce the same terrain character.
//
// Dependency-free and host-testable; the Vulkan layer uploads the resulting
// vertex/index data per leaf.

#pragma once

#include <cstdint>
#include <vector>

#include "scene_loader.h"

namespace heretek {

struct TerrainMeshData {
  /** Interleaved position(3) + normal(3) floats. */
  std::vector<float> vertices;
  std::vector<uint16_t> indices;

  uint32_t vertexCount() const { return static_cast<uint32_t>(vertices.size() / 6); }
  uint32_t indexCount() const { return static_cast<uint32_t>(indices.size()); }
};

/** Heightmap sample matching the TS TerrainChunk generator (seed-stable). */
float terrainHeight(float worldX, float worldZ, uint32_t seed, float maxHeight);

/**
 * Vertices per grid edge for a LOD level: the finest level (lod == maxDepth)
 * uses baseResolution; each coarser level halves it (minimum 5).
 */
uint32_t terrainResolutionForLod(uint32_t lod, uint32_t maxDepth, uint32_t baseResolution = 33);

/** Generates a displaced grid mesh covering one LOD leaf. */
TerrainMeshData generateTerrainMesh(const TerrainLodRecord& leaf, uint32_t resolution, uint32_t seed,
                                    float maxHeight);

struct TerrainMeshPlan {
  uint32_t leaves = 0;
  uint32_t totalVertices = 0;
  uint32_t totalIndices = 0;
  uint32_t maxVerticesPerLeaf = 0;
  uint32_t maxIndicesPerLeaf = 0;
};

/** Aggregated mesh stats for all leaves (planning + telemetry). */
TerrainMeshPlan planTerrainMeshes(const std::vector<TerrainLodRecord>& leaves, uint32_t maxDepth,
                                  uint32_t seed, float maxHeight);

/**
 * One packed draw range for a terrain leaf, matching
 * VkDrawIndexedIndirectCommand semantics (instanceCount = 1).
 */
struct TerrainDrawCommand {
  uint32_t indexCount = 0;
  uint32_t instanceCount = 1;
  uint32_t firstIndex = 0;
  int32_t vertexOffset = 0;
  uint32_t firstInstance = 0;
};

struct TerrainGpuData {
  /** All leaf meshes concatenated (interleaved position + normal). */
  std::vector<float> vertices;
  /** All leaf indices, rebased by each leaf's vertex offset. */
  std::vector<uint16_t> indices;
  std::vector<TerrainDrawCommand> commands;
  TerrainMeshPlan plan;
};

/**
 * Generates and packs every leaf mesh into single vertex/index buffers plus
 * per-leaf indirect draw commands (one drawIndexedIndirect call renders all).
 * Pure function: the Vulkan layer uploads the result verbatim.
 */
TerrainGpuData packTerrainGpuData(const std::vector<TerrainLodRecord>& leaves, uint32_t maxDepth,
                                  uint32_t seed, float maxHeight);

}  // namespace heretek
