// Heretek Tier 2 — native walkability bake implementation.
// Mirrors engine/src/navigation/NavBake.ts bakeWalkability line-for-line:
// floor/clamp ranges, cell-center coverage against the eroded footprint.

#include "nav_bake.h"

#include <algorithm>
#include <cmath>

namespace heretek {

NavBakeResult bakeWalkabilityNative(int width, int height,
                                    const NavObstacle* obstacles, int obstacleCount,
                                    double originX, double originZ, double cellSize,
                                    double agentRadius) {
  NavBakeResult out;
  out.width = width;
  out.height = height;
  out.originX = static_cast<float>(originX);
  out.originZ = static_cast<float>(originZ);
  out.cellSize = static_cast<float>(cellSize);
  out.blocked.assign(static_cast<size_t>(width) * static_cast<size_t>(height), 0);

  for (int i = 0; i < obstacleCount; i++) {
    const NavObstacle& o = obstacles[i];
    // Double-precision mirrors the TypeScript source (float64): float32
    // inputs flipped erosion-boundary cells in parity (0.4f != 0.4).
    const double hx = std::max(0.0, o.hx) + agentRadius;
    const double hz = std::max(0.0, o.hz) + agentRadius;
    const double ox = originX, oz = originZ, cs = cellSize;
    const int x0 = std::max(0, static_cast<int>(std::floor((o.x - hx - ox) / cs)));
    const int x1 = std::min(width - 1,
                            static_cast<int>(std::floor((o.x + hx - ox) / cs)));
    const int z0 = std::max(0, static_cast<int>(std::floor((o.z - hz - oz) / cs)));
    const int z1 = std::min(height - 1,
                            static_cast<int>(std::floor((o.z + hz - oz) / cs)));
    for (int z = z0; z <= z1; z++) {
      for (int x = x0; x <= x1; x++) {
        const double cx = ox + (static_cast<double>(x) + 0.5) * cs;
        const double cz = oz + (static_cast<double>(z) + 0.5) * cs;
        if (std::fabs(cx - o.x) <= hx && std::fabs(cz - o.z) <= hz) {
          out.blocked[static_cast<size_t>(z) * static_cast<size_t>(width) +
                      static_cast<size_t>(x)] = 1;
        }
      }
    }
  }
  return out;
}

}  // namespace heretek
