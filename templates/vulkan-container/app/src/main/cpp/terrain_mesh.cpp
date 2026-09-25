#include "terrain_mesh.h"

#include <algorithm>
#include <cmath>

namespace heretek {

namespace {

/** Deterministic hash noise in [-1, 1] (mirrors the TS noise2D). */
float noise2D(int x, int z, uint32_t seed) {
  const double s = std::sin(x * 12.9898 + z * 78.233 + static_cast<double>(seed)) * 43758.5453;
  return static_cast<float>((s - std::floor(s)) * 2.0 - 1.0);
}

float smoothStep(float t) {
  return t * t * (3.0f - 2.0f * t);
}

}  // namespace

float terrainHeight(float worldX, float worldZ, uint32_t seed, float maxHeight) {
  float elevation = 0.0f;
  float frequency = 0.02f;
  float amplitude = 1.0f;
  float maxAmp = 0.0f;

  for (int octave = 0; octave < 4; octave++) {
    const float nx = worldX * frequency;
    const float nz = worldZ * frequency;
    const int x0 = static_cast<int>(std::floor(nx));
    const int z0 = static_cast<int>(std::floor(nz));
    const float fx = nx - static_cast<float>(x0);
    const float fz = nz - static_cast<float>(z0);

    const float n00 = noise2D(x0, z0, seed);
    const float n10 = noise2D(x0 + 1, z0, seed);
    const float n01 = noise2D(x0, z0 + 1, seed);
    const float n11 = noise2D(x0 + 1, z0 + 1, seed);

    const float sx = smoothStep(fx);
    const float sz = smoothStep(fz);
    const float top = n00 * (1.0f - sx) + n10 * sx;
    const float bottom = n01 * (1.0f - sx) + n11 * sx;
    const float value = top * (1.0f - sz) + bottom * sz;

    elevation += value * amplitude;
    maxAmp += amplitude;
    frequency *= 2.1f;
    amplitude *= 0.45f;
  }

  const float normalized = (elevation / maxAmp + 1.0f) * 0.5f;
  return std::pow(normalized, 1.4f) * maxHeight;
}

uint32_t terrainResolutionForLod(uint32_t lod, uint32_t maxDepth, uint32_t baseResolution) {
  const uint32_t shift = maxDepth > lod ? maxDepth - lod : 0;
  const uint32_t shifted = baseResolution >> shift;
  return shifted < 5 ? 5 : shifted;
}

TerrainMeshData generateTerrainMesh(const TerrainLodRecord& leaf, uint32_t resolution, uint32_t seed,
                                    float maxHeight) {
  TerrainMeshData mesh;
  if (resolution < 2) resolution = 2;

  const float stepX = (leaf.maxX - leaf.minX) / static_cast<float>(resolution - 1);
  const float stepZ = (leaf.maxZ - leaf.minZ) / static_cast<float>(resolution - 1);

  mesh.vertices.resize(static_cast<size_t>(resolution) * resolution * 6);
  size_t v = 0;
  for (uint32_t zi = 0; zi < resolution; zi++) {
    for (uint32_t xi = 0; xi < resolution; xi++) {
      const float x = leaf.minX + stepX * static_cast<float>(xi);
      const float z = leaf.minZ + stepZ * static_cast<float>(zi);
      const float y = terrainHeight(x, z, seed, maxHeight);

      // Central-difference normal from neighbouring height samples
      const float hL = terrainHeight(x - stepX, z, seed, maxHeight);
      const float hR = terrainHeight(x + stepX, z, seed, maxHeight);
      const float hD = terrainHeight(x, z - stepZ, seed, maxHeight);
      const float hU = terrainHeight(x, z + stepZ, seed, maxHeight);
      float nx = hL - hR;
      float ny = 2.0f * stepX;
      float nz = hD - hU;
      const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-6f) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }

      mesh.vertices[v++] = x;
      mesh.vertices[v++] = y;
      mesh.vertices[v++] = z;
      mesh.vertices[v++] = nx;
      mesh.vertices[v++] = ny;
      mesh.vertices[v++] = nz;
    }
  }

  mesh.indices.reserve(static_cast<size_t>(resolution - 1) * (resolution - 1) * 6);
  for (uint32_t zi = 0; zi < resolution - 1; zi++) {
    for (uint32_t xi = 0; xi < resolution - 1; xi++) {
      const uint16_t i0 = static_cast<uint16_t>(zi * resolution + xi);
      const uint16_t i1 = static_cast<uint16_t>(i0 + 1);
      const uint16_t i2 = static_cast<uint16_t>(i0 + resolution);
      const uint16_t i3 = static_cast<uint16_t>(i2 + 1);
      mesh.indices.push_back(i0);
      mesh.indices.push_back(i2);
      mesh.indices.push_back(i1);
      mesh.indices.push_back(i1);
      mesh.indices.push_back(i2);
      mesh.indices.push_back(i3);
    }
  }
  return mesh;
}

TerrainMeshPlan planTerrainMeshes(const std::vector<TerrainLodRecord>& leaves, uint32_t maxDepth,
                                  uint32_t seed, float maxHeight) {
  TerrainMeshPlan plan;
  plan.leaves = static_cast<uint32_t>(leaves.size());
  for (const auto& leaf : leaves) {
    const uint32_t resolution = terrainResolutionForLod(leaf.lod, maxDepth);
    const TerrainMeshData mesh = generateTerrainMesh(leaf, resolution, seed, maxHeight);
    plan.totalVertices += mesh.vertexCount();
    plan.totalIndices += mesh.indexCount();
    plan.maxVerticesPerLeaf = std::max(plan.maxVerticesPerLeaf, mesh.vertexCount());
    plan.maxIndicesPerLeaf = std::max(plan.maxIndicesPerLeaf, mesh.indexCount());
  }
  return plan;
}

TerrainGpuData packTerrainGpuData(const std::vector<TerrainLodRecord>& leaves, uint32_t maxDepth,
                                  uint32_t seed, float maxHeight) {
  TerrainGpuData data;
  data.plan = planTerrainMeshes(leaves, maxDepth, seed, maxHeight);
  data.vertices.reserve(static_cast<size_t>(data.plan.totalVertices) * 6);
  data.indices.reserve(data.plan.totalIndices);
  data.commands.reserve(leaves.size());

  uint32_t vertexOffset = 0;
  uint32_t indexOffset = 0;
  for (const auto& leaf : leaves) {
    const uint32_t resolution = terrainResolutionForLod(leaf.lod, maxDepth);
    const TerrainMeshData mesh = generateTerrainMesh(leaf, resolution, seed, maxHeight);

    TerrainDrawCommand command;
    command.indexCount = mesh.indexCount();
    command.firstIndex = indexOffset;
    command.vertexOffset = static_cast<int32_t>(vertexOffset);

    data.vertices.insert(data.vertices.end(), mesh.vertices.begin(), mesh.vertices.end());
    for (const uint16_t index : mesh.indices) {
      data.indices.push_back(static_cast<uint16_t>(index + vertexOffset));
    }
    data.commands.push_back(command);

    vertexOffset += mesh.vertexCount();
    indexOffset += mesh.indexCount();
  }
  return data;
}

}  // namespace heretek
