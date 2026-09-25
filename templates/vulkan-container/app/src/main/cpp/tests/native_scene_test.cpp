// Host-side test for the Tier 2 native scene core (no Vulkan/Android needed).
//
// Build & run:
//   g++ -std=c++17 scene_loader.cpp culling.cpp tests/native_scene_test.cpp -o /tmp/native_scene_test
//   /tmp/native_scene_test /path/to/scene.native

#include <cassert>
#include <cmath>
#include <cstdio>
#include <string>

#include "../culling.h"
#include "../scene_loader.h"

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
  CHECK(scene.meshes[0].physics == PhysicsType::Fixed, "ground is fixed physics");
  CHECK(scene.meshes[1].physics == PhysicsType::Dynamic, "player is dynamic physics");
  CHECK(std::fabs(scene.meshes[0].sx - 24.0f) < 1e-3f, "ground size preserved");

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
  instanced.instances.push_back({"foliage_blade", 1, 0, 1, 0});
  instanced.instances.push_back({"foliage_blade", 2, 0, 2, 0});
  instanced.instances.push_back({"foliage_blade", 3, 0, 3, 0});
  instanced.instances.push_back({"rock_chunk", 4, 0, 4, 0});
  const auto batches = packInstanceBatches(instanced);
  CHECK(batches.size() == 2, "two unique batch keys -> two draw calls");
  CHECK(instanced.drawCallEstimate() == 2, "instanced draw estimate ignores instance count");

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

  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "NATIVE CORE TESTS PASSED" : "NATIVE CORE TESTS FAILED",
              failures, failures == 1 ? "" : "s");
  return failures == 0 ? 0 : 1;
}
