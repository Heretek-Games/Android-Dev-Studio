// Host-side test for the Tier 2 native scene core (no Vulkan/Android needed).
//
// Build & run:
//   g++ -std=c++17 scene_loader.cpp culling.cpp tests/native_scene_test.cpp -o /tmp/native_scene_test
//   /tmp/native_scene_test /path/to/scene.native

#include <cassert>
#include <cmath>
#include <array>
#include <cstdio>
#include <string>

#include "../culling.h"
#include "../scene_loader.h"
#include "../terrain_mesh.h"
#include "../vulkan_renderer.h"

using namespace heretek;

static int failures = 0;

#define CHECK(cond, message)                          \
  do {                                                \
    if (!(cond)) {                                    \
      std::printf("FAIL: %s\n", message);             \
      failures++;                                     \
    } else {                                          \
      std::printf("ok:   %s\n", message);             \
    }                                                 \
  } while (0)

int main(int argc, char** argv) {
  if (argc < 2) {
    std::printf("usage: native_scene_test <scene.native>\n");
    return 2;
  }

  // ---- Parse the exported canonical scene ----
  NativeScene scene;
  std::string error;
  const bool loaded = loadSceneFile(argv[1], scene, error);
  CHECK(loaded, ("load scene file: " + error).c_str());
  if (!loaded) return 1;

  CHECK(scene.name == "MainArena", "scene name parses");
  CHECK(scene.meshes.size() == 3, "3 mesh records");
  CHECK(scene.lights.size() == 1, "1 light record");
  CHECK(scene.terrainLod.size() == 64, "64 quadtree terrain LOD leaves (depth 3)");
  CHECK(scene.terrainMaxDepth == 3, "terrain_meta carries the export depth");
  CHECK(scene.drawCallEstimate() == 67, "draw estimate includes mesh + LOD leaves (3 + 64)");

  // LOD leaves tile the world bounds exactly once
  double leafArea = 0;
  for (const auto& leaf : scene.terrainLod) {
    leafArea += static_cast<double>(leaf.maxX - leaf.minX) * (leaf.maxZ - leaf.minZ);
  }
  const double boundsArea = 1024.0 * 1024.0;
  CHECK(std::fabs(leafArea - boundsArea) < 1.0, "LOD leaves cover the bounds without overlap");

  CHECK(scene.terrainLod[0].depth == 3, "leaves are at the configured depth");
  CHECK(scene.terrainLod[0].blend == 1.0f, "max-depth leaves are fully blended to finest");

  // ---- Terrain mesh generation from LOD leaves ----
  const float h1 = terrainHeight(12.5f, -30.25f, 1337, 12.0f);
  const float h2 = terrainHeight(12.5f, -30.25f, 1337, 12.0f);
  CHECK(h1 == h2, "terrainHeight is deterministic for a seed");
  CHECK(h1 >= 0.0f && h1 <= 12.0f, "terrainHeight stays within [0, maxHeight]");
  CHECK(terrainHeight(12.5f, -30.25f, 99, 12.0f) != h1, "different seeds decorrelate terrain");

  CHECK(terrainResolutionForLod(3, 3) == 33, "finest LOD uses the base resolution");
  CHECK(terrainResolutionForLod(0, 3) == 5, "coarsest LOD floors at 5 vertices");
  CHECK(terrainResolutionForLod(3, 3) >= terrainResolutionForLod(2, 3) &&
            terrainResolutionForLod(2, 3) >= terrainResolutionForLod(1, 3),
        "resolution decreases with coarser LODs");

  TerrainLodRecord sampleLeaf;
  sampleLeaf.id = "test";
  sampleLeaf.depth = 3;
  sampleLeaf.minX = -16;
  sampleLeaf.minZ = -16;
  sampleLeaf.maxX = 16;
  sampleLeaf.maxZ = 16;
  sampleLeaf.lod = 3;
  const TerrainMeshData sampleMesh = generateTerrainMesh(sampleLeaf, 9, 42, 10.0f);
  const uint32_t samplePerimeter = 4 * 9 - 4;
  CHECK(sampleMesh.vertexCount() == 81 + samplePerimeter, "9x9 grid + perimeter skirt vertices");
  CHECK(sampleMesh.indexCount() == 8 * 8 * 6 + samplePerimeter * 6, "grid quads + skirt quads");
  CHECK(sampleMesh.indices[sampleMesh.indexCount() - 1] < sampleMesh.vertexCount(),
        "local indices stay inside the leaf vertex range");
  bool skirtBelowSurface = false;
  for (uint32_t i = 81; i < sampleMesh.vertexCount(); i++) {
    if (sampleMesh.vertices[i * 6 + 1] < 0.0f) skirtBelowSurface = true;
  }
  CHECK(skirtBelowSurface, "skirt vertices hang below the surface (crack cover)");
  CHECK(sampleMesh.vertices[0] == -16.0f && sampleMesh.vertices[2] == -16.0f,
        "grid starts at the leaf origin");
  CHECK(sampleMesh.vertices[80 * 6] == 16.0f, "grid ends at the leaf max X");
  bool heightsInRange = true;
  bool normalsUnit = true;
  for (uint32_t i = 0; i < 81; i++) {  // surface grid only; the skirt hangs below
    const float y = sampleMesh.vertices[i * 6 + 1];
    if (y < 0.0f || y > 10.0f) heightsInRange = false;
    const float nx = sampleMesh.vertices[i * 6 + 3];
    const float ny = sampleMesh.vertices[i * 6 + 4];
    const float nz = sampleMesh.vertices[i * 6 + 5];
    const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (std::fabs(len - 1.0f) > 1e-3f) normalsUnit = false;
  }
  CHECK(heightsInRange, "all vertex heights stay within [0, maxHeight]");
  CHECK(normalsUnit, "all normals are unit length");

  const TerrainMeshPlan plan = planTerrainMeshes(scene.terrainLod, 3, 1337, 12.0f);
  CHECK(plan.leaves == 64, "mesh plan covers every LOD leaf");
  const uint32_t finestVertices = 33 * 33 + (4 * 33 - 4);  // grid + skirt
  const uint32_t finestIndices = 32 * 32 * 6 + (4 * 33 - 4) * 6;
  CHECK(plan.maxVerticesPerLeaf == finestVertices, "finest leaf uses 33x33 grid + skirt vertices");
  CHECK(plan.totalVertices == 64u * finestVertices, "total vertex budget is deterministic (77,888)");
  CHECK(plan.totalIndices == 64u * finestIndices, "total index budget is deterministic (458,496)");

  // ---- GPU packing: single buffers + per-leaf indirect draw commands ----
  const TerrainGpuData packed = packTerrainGpuData(scene.terrainLod, 3, 1337, 12.0f);
  CHECK(packed.vertices.size() == static_cast<size_t>(plan.totalVertices) * 6,
        "packed vertex buffer holds every interleaved vertex");
  CHECK(packed.indices.size() == plan.totalIndices, "packed index buffer holds every index");
  CHECK(packed.commands.size() == 64, "one indirect draw command per leaf");
  CHECK(packed.commands[0].firstIndex == 0 && packed.commands[0].vertexOffset == 0,
        "first command starts at the buffer origins");
  CHECK(packed.commands[1].firstIndex == finestIndices, "second command offsets past the first index range");
  CHECK(packed.commands[1].vertexOffset == static_cast<int32_t>(finestVertices),
        "second command offsets past the first vertex range");
  CHECK(packed.commands[63].firstIndex + packed.commands[63].indexCount == plan.totalIndices,
        "last command covers the buffer tail");
  CHECK(packed.commands[0].instanceCount == 1, "terrain draws are non-instanced");

  // Local indices must stay inside a single leaf's vertex range (the draw's
  // vertexOffset rebases them). A global bound would hide the uint16 overflow
  // that absolute indices hit once the shared buffer passes 65,535 vertices.
  uint16_t maxIndex = 0;
  for (const uint16_t index : packed.indices) {
    if (index > maxIndex) maxIndex = index;
  }
  CHECK(maxIndex < finestVertices, "indices are leaf-local (no shared-buffer uint16 overflow)");

  const TerrainGpuData packedAgain = packTerrainGpuData(scene.terrainLod, 3, 1337, 12.0f);
  CHECK(packed.vertices == packedAgain.vertices && packed.indices == packedAgain.indices,
        "GPU packing is deterministic");
  CHECK(scene.meshes[0].physics == PhysicsType::Fixed, "ground is fixed physics");
  CHECK(scene.meshes[1].physics == PhysicsType::Dynamic, "player is dynamic physics");
  CHECK(std::fabs(scene.meshes[0].sx - 24.0f) < 1e-3f, "ground size preserved");

  // ---- Vulkan projection conventions (Y down, depth 0..1) ----
  {
    const Mat4 vk = perspectiveVulkan(1.0472f, 16.0f / 9.0f, 0.1f, 500.0f);
    const float nearPoint[4] = {0.0f, 0.0f, -0.1f, 1.0f};
    const float farPoint[4] = {0.0f, 0.0f, -500.0f, 1.0f};
    const float upPoint[4] = {0.0f, 10.0f, -10.0f, 1.0f};
    auto clip = [&](const float* p) {
      // Mat4 is column-major: element (row r, col c) = m[c * 4 + r].
      float out[4];
      for (int r = 0; r < 4; r++) {
        out[r] = vk.m[0 * 4 + r] * p[0] + vk.m[1 * 4 + r] * p[1] + vk.m[2 * 4 + r] * p[2] +
                 vk.m[3 * 4 + r] * p[3];
      }
      return std::array<float, 4>{out[0], out[1], out[2], out[3]};
    };
    const auto nearClip = clip(nearPoint);
    const auto farClip = clip(farPoint);
    const auto upClip = clip(upPoint);
    CHECK(std::fabs(nearClip[2] / nearClip[3]) < 1e-4f, "Vulkan projection: near plane maps to z=0");
    CHECK(std::fabs(farClip[2] / farClip[3] - 1.0f) < 1e-4f, "Vulkan projection: far plane maps to z=1");
    CHECK(upClip[1] / upClip[3] < 0.0f, "Vulkan projection: +Y world maps to -Y NDC (Y-down clip space)");
  }

  // ---- Frustum culling ----
  const Mat4 proj = perspective(1.0472f /*60°*/, 16.0f / 9.0f, 0.1f, 500.0f);
  const Mat4 view = lookAt({0, 10, 20}, {0, 1, 0}, {0, 1, 0});
  const Mat4 viewProj = multiply(proj, view);
  const CullResult visible = cullMeshes(scene, viewProj);
  CHECK(visible.totalCount == 3, "culling covers all meshes");
  CHECK(visible.visibleMeshIndices.size() == 3, "all three meshes visible from the overview camera");
  CHECK(visible.culledCount == 0, "nothing culled in view");

  const Mat4 awayView = lookAt({0, 10, 20}, {0, 1, 400}, {0, 1, 0});  // looking away from origin
  const CullResult behind = cullMeshes(scene, multiply(proj, awayView));
  CHECK(behind.culledCount == 3, "all meshes culled when the camera looks away");

  // ---- Instance batch packing (one draw per unique batch key) ----
  NativeScene instanced;
  instanced.name = "BatchTest";
  instanced.instances.push_back({"foliage", 1, 0, 1, 0});
  instanced.instances.push_back({"foliage", 2, 0, 2, 0});
  instanced.instances.push_back({"foliage", 3, 0, 3, 0});
  instanced.instances.push_back({"rock_chunk", 4, 0, 4, 0});
  const auto batches = packInstanceBatches(instanced);
  CHECK(batches.size() == 2, "two unique batch keys -> two draw calls");
  CHECK(instanced.drawCallEstimate() == 2, "instanced draw estimate ignores instance count");
  {
    uint32_t foliageCategory = 99, sceneCategory = 99;
    size_t foliageCount = 0;
    for (const auto& batch : batches) {
      if (batch.batchKey == kFoliageBatch) {
        foliageCategory = batch.category;
        foliageCount = batch.instances.size();
      } else {
        sceneCategory = batch.category;
      }
    }
    CHECK(foliageCategory == 1, "foliage batches carry the wind category");
    CHECK(sceneCategory == 0, "scene batches stay in the static category");
    CHECK(foliageCount == 3, "foliage batch groups every blade instance");
  }

  // ---- Compute dispatch planning + indirect draw packing (GPU cull path) ----
  const ComputeDispatchPlan empty = planComputeDispatch(0);
  CHECK(empty.groupCountX == 0, "empty scene dispatches zero workgroups");

  const ComputeDispatchPlan exact = planComputeDispatch(64);
  CHECK(exact.groupCountX == 1, "64 items -> 1 workgroup");

  const ComputeDispatchPlan over = planComputeDispatch(65);
  CHECK(over.groupCountX == 2, "65 items -> 2 workgroups");

  const ComputeDispatchPlan large = planComputeDispatch(50000);
  CHECK(large.groupCountX == 782, "50k items -> 782 workgroups (ceil(50000/64))");

  NativeScene mega;
  mega.name = "Mega";
  for (int i = 0; i < 25000; i++) mega.instances.push_back({"foliage_blade", (float)i, 0, 0, 0});
  for (int i = 0; i < 25000; i++) mega.instances.push_back({"rock_chunk", (float)i, 0, 0, 0});
  const auto megaBatches = packInstanceBatches(mega);
  CHECK(megaBatches.size() == 2, "50k instances collapse to 2 batches");

  const IndirectDrawPlan megaPlan = buildIndirectDrawPlan(megaBatches, 36);
  CHECK(megaPlan.totalDrawCalls == 2, "50k instances -> 2 indirect draw calls");
  CHECK(megaPlan.totalInstances == 50000, "indirect plan accounts for every instance");
  CHECK(megaPlan.commands[0].indexCount == 36, "indexCount from the mesh index buffer");
  CHECK(megaPlan.commands[0].instanceCount == 25000, "first batch instance count");
  CHECK(megaPlan.commands[0].firstInstance == 0, "first batch starts at instance 0");
  CHECK(megaPlan.commands[1].firstInstance == 25000, "second batch offsets past the first");

  // ---- Malformed input is rejected with a line number ----
  NativeScene broken;
  std::string brokenError;
  const bool parsedBroken = parseSceneText("scene S\nmesh Bad 1 2\n", broken, brokenError);
  CHECK(!parsedBroken, "malformed mesh record rejected");
  CHECK(brokenError.find("line 2") != std::string::npos, "error reports the offending line");

  // Experiment 1 (delta-loop spike): host-stub syncInstances validates shape.
  {
    VulkanRenderer stub;
    const int slots[3] = {0, 1, 2};
    const float xyz[9] = {1, 2, 3, 4, 5, 6, 7, 8, 9};
    CHECK(stub.syncInstances(slots, xyz, 3) == 3, "stub syncInstances accepts a batch");
    CHECK(stub.syncInstances(nullptr, nullptr, 0) == 0, "stub syncInstances rejects empty");
    CHECK(stub.syncInstances(slots, xyz, -1) == 0, "stub syncInstances rejects negative count");
  }

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "NATIVE CORE TESTS PASSED" : "NATIVE CORE TESTS FAILED",
              failures, failures == 1 ? "" : "s");
  return failures == 0 ? 0 : 1;
}
