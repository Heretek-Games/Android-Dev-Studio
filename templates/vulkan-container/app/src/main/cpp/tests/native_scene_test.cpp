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
  CHECK(scene.drawCallEstimate() == 3, "draw estimate is 3");
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
