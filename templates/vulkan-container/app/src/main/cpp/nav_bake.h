// Heretek Tier 2 — native walkability bake (Track C.6 first strangler module).
//
// Ports engine bakeWalkability semantics EXACTLY (see ADR-1790394000001):
// axis-aligned footprints + agent-radius erosion, cell-center coverage test.
// The TypeScript engine is the source of truth — any divergence fails the
// parity test (harness/validation/test_native_nav_parity.py), never the engine.

#pragma once

#include <cstdint>
#include <vector>

namespace heretek {

struct NavObstacle {
  double x = 0.0;
  double z = 0.0;
  double hx = 0.0;
  double hz = 0.0;
};

struct NavBakeResult {
  int width = 0;
  int height = 0;
  float originX = 0.0f;
  float originZ = 0.0f;
  float cellSize = 1.0f;
  // Row-major blocked flags (z * width + x), 1 = blocked.
  std::vector<uint8_t> blocked;

  bool inBounds(int x, int z) const {
    return x >= 0 && z >= 0 && x < width && z < height;
  }

  // Out-of-bounds reads blocked (mirrors engine NavGrid.isBlocked).
  bool isBlocked(int x, int z) const {
    if (!inBounds(x, z)) return true;
    return blocked[static_cast<size_t>(z) * static_cast<size_t>(width) +
                   static_cast<size_t>(x)] != 0;
  }

  int blockedCount() const {
    int total = 0;
    for (uint8_t cell : blocked) total += (cell != 0) ? 1 : 0;
    return total;
  }
};

NavBakeResult bakeWalkabilityNative(int width, int height,
                                    const NavObstacle* obstacles, int obstacleCount,
                                    double originX, double originZ, double cellSize,
                                    double agentRadius);

}  // namespace heretek
