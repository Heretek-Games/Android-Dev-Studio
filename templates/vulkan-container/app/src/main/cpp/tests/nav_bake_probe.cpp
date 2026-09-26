// Heretek Tier 2 — nav-bake parity probe (Track C.6).
//
// Reads a scene.native file with the production loader, collects tall fixed
// meshes as walkability obstacles (mirrors collectStaticFootprints), bakes
// over the argv grid, and prints the blocked bitmask as JSON. The parity
// test compares this byte-for-byte against the TypeScript engine bake.
//
// Usage:
//   nav_bake_probe <scene.native> <width> <height> <originX> <originZ> <cell> <agent>
// Output: {"width":..,"height":..,"blocked":[0/1...]}

#include <cstdio>
#include <string>
#include <vector>

#include "nav_bake.h"
#include "scene_loader.h"

int main(int argc, char** argv) {
  if (argc != 8) {
    std::printf("usage: nav_bake_probe <scene.native> <w> <h> <ox> <oz> <cell> <agent>\n");
    return 2;
  }
  heretek::NativeScene scene;
  std::string error;
  if (!heretek::loadSceneFile(argv[1], scene, error)) {
    std::printf("{\"error\": \"load failed: %s\"}\n", error.c_str());
    return 1;
  }
  const int width = std::atoi(argv[2]);
  const int height = std::atoi(argv[3]);
  // Doubles throughout: float32 narrowing here flipped erosion-boundary
  // cells in parity (0.4f != 0.4) — the exact bug this probe guards.
  const double originX = std::atof(argv[4]);
  const double originZ = std::atof(argv[5]);
  const double cell = std::atof(argv[6]);
  const double agent = std::atof(argv[7]);

  std::vector<heretek::NavObstacle> obstacles;
  for (const auto& mesh : scene.meshes) {
    if (mesh.physics != heretek::PhysicsType::Fixed) continue;
    if (mesh.sy < 2.0f) continue;  // thin slabs are walkable ground
    heretek::NavObstacle obstacle;
    obstacle.x = mesh.px;
    obstacle.z = mesh.pz;
    obstacle.hx = mesh.sx / 2.0f;
    obstacle.hz = mesh.sz / 2.0f;
    obstacles.push_back(obstacle);
  }

  heretek::NavBakeResult baked = heretek::bakeWalkabilityNative(
      width, height, obstacles.data(), static_cast<int>(obstacles.size()),
      originX, originZ, cell, agent);

  std::printf("{\"width\": %d, \"height\": %d, \"blocked\": [", width, height);
  for (int i = 0; i < width * height; i++) {
    std::printf("%s%d", i == 0 ? "" : ",", baked.blocked[static_cast<size_t>(i)]);
  }
  std::printf("]}\n");
  return 0;
}
