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

/**
 * Gribb–Hartmann frustum plane extraction (public so the Vulkan renderer can
 * fill the compute push constants with the same planes the CPU tests use).
 * Each plane is (nx, ny, nz, distance).
 */
void extractFrustumPlanes(const Mat4& viewProj, float planes[6][4]);

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

// ---------------------------------------------------------------------------
// GPU compute culling plan (CPU side of the cull.comp dispatch)
// ---------------------------------------------------------------------------

struct ComputeDispatchPlan {
  uint32_t groupCountX = 0;
  uint32_t workgroupSize = 64;
};

/** ceil(itemCount / workgroupSize) workgroups, 0 when there is nothing to cull. */
ComputeDispatchPlan planComputeDispatch(int itemCount, uint32_t workgroupSize = 64);

/** Matches VkDrawIndexedIndirectCommand memory layout (5 × 32-bit words). */
struct IndirectDrawCommand {
  uint32_t indexCount = 0;
  uint32_t instanceCount = 0;
  uint32_t firstIndex = 0;
  int32_t vertexOffset = 0;
  uint32_t firstInstance = 0;
};

struct IndirectDrawPlan {
  std::vector<IndirectDrawCommand> commands;
  uint32_t totalInstances = 0;
  uint32_t totalDrawCalls = 0;
};

/**
 * Builds one indirect draw command per instance batch (the compute shader only
 * rewrites instanceCount at runtime). firstInstance offsets accumulate across
 * batches so a single drawIndirect range covers the whole visible set.
 */
IndirectDrawPlan buildIndirectDrawPlan(const std::vector<InstanceBatch>& batches,
                                       uint32_t indicesPerInstance = 36);

}  // namespace heretek
