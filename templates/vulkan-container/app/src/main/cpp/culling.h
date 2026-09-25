// Heretek Tier 2 — CPU frustum culling and instanced batch packing.
//
// This is the host-testable reference implementation of the culling math the
// Vulkan renderer dispatches (compute path mirrors these planes/tests). It has
// no Vulkan/Android dependencies.

#pragma once

#include <string>
#include <vector>

#include "scene_loader.h"

namespace heretek {

/** Column-major 4x4 matrix (same memory layout as GLSL mat4). */
struct Mat4 {
  float m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
};

struct Vec3 {
  float x = 0, y = 0, z = 0;
};

struct AABB {
  Vec3 min;
  Vec3 max;
};

/** Right-handed perspective projection (fovY radians). */
Mat4 perspective(float fovY, float aspect, float nearZ, float farZ);

/** Right-handed look-at view matrix. */
Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up);

/** viewProj = projection * view. */
Mat4 multiply(const Mat4& a, const Mat4& b);

/** World-space AABB from a mesh record's position and size. */
AABB meshAABB(const MeshRecord& mesh);

/** Conservative frustum test against the six planes extracted from viewProj. */
bool isVisible(const Mat4& viewProj, const AABB& box);

struct CullResult {
  std::vector<int> visibleMeshIndices;
  int culledCount = 0;
  int totalCount = 0;
};

CullResult cullMeshes(const NativeScene& scene, const Mat4& viewProj);

struct InstanceBatch {
  std::string batchKey;
  std::vector<const InstanceRecord*> instances;
};

/** Groups instances by batch key: one draw call per returned batch. */
std::vector<InstanceBatch> packInstanceBatches(const NativeScene& scene);

}  // namespace heretek
