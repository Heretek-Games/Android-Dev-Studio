#include "culling.h"

#include <cmath>
#include <map>

namespace heretek {

Mat4 perspective(float fovY, float aspect, float nearZ, float farZ) {
  Mat4 out;
  const float f = 1.0f / std::tan(fovY * 0.5f);
  for (float& v : out.m) v = 0;
  out.m[0] = f / aspect;
  out.m[5] = f;
  out.m[10] = (farZ + nearZ) / (nearZ - farZ);
  out.m[11] = -1.0f;
  out.m[14] = (2.0f * farZ * nearZ) / (nearZ - farZ);
  return out;
}

Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up) {
  Vec3 f{center.x - eye.x, center.y - eye.y, center.z - eye.z};
  const float fLen = std::sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
  if (fLen > 0) {
    f.x /= fLen;
    f.y /= fLen;
    f.z /= fLen;
  }
  Vec3 s{f.y * up.z - f.z * up.y, f.z * up.x - f.x * up.z, f.x * up.y - f.y * up.x};
  const float sLen = std::sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
  if (sLen > 0) {
    s.x /= sLen;
    s.y /= sLen;
    s.z /= sLen;
  }
  Vec3 u{s.y * f.z - s.z * f.y, s.z * f.x - s.x * f.z, s.x * f.y - s.y * f.x};

  Mat4 out;
  out.m[0] = s.x;
  out.m[4] = s.y;
  out.m[8] = s.z;
  out.m[1] = u.x;
  out.m[5] = u.y;
  out.m[9] = u.z;
  out.m[2] = -f.x;
  out.m[6] = -f.y;
  out.m[10] = -f.z;
  out.m[3] = 0;
  out.m[7] = 0;
  out.m[11] = 0;
  out.m[12] = -(s.x * eye.x + s.y * eye.y + s.z * eye.z);
  out.m[13] = -(u.x * eye.x + u.y * eye.y + u.z * eye.z);
  out.m[14] = f.x * eye.x + f.y * eye.y + f.z * eye.z;
  out.m[15] = 1;
  return out;
}

Mat4 multiply(const Mat4& a, const Mat4& b) {
  Mat4 out;
  for (int col = 0; col < 4; col++) {
    for (int row = 0; row < 4; row++) {
      float sum = 0;
      for (int k = 0; k < 4; k++) {
        sum += a.m[k * 4 + row] * b.m[col * 4 + k];
      }
      out.m[col * 4 + row] = sum;
    }
  }
  return out;
}

AABB meshAABB(const MeshRecord& mesh) {
  AABB box;
  box.min = {mesh.px - mesh.sx * 0.5f, mesh.py - mesh.sy * 0.5f, mesh.pz - mesh.sz * 0.5f};
  box.max = {mesh.px + mesh.sx * 0.5f, mesh.py + mesh.sy * 0.5f, mesh.pz + mesh.sz * 0.5f};
  return box;
}

namespace {

/** Gribb–Hartmann frustum plane extraction from a view-projection matrix. */
void extractPlanes(const Mat4& vp, float planes[6][4]) {
  const float* m = vp.m;
  // Column-major storage: row r component i lives at m[i * 4 + r].
  for (int i = 0; i < 4; i++) {
    const float row0 = m[i * 4 + 0];
    const float row1 = m[i * 4 + 1];
    const float row2 = m[i * 4 + 2];
    const float row3 = m[i * 4 + 3];
    planes[0][i] = row3 + row0;  // left
    planes[1][i] = row3 - row0;  // right
    planes[2][i] = row3 + row1;  // bottom
    planes[3][i] = row3 - row1;  // top
    planes[4][i] = row3 + row2;  // near
    planes[5][i] = row3 - row2;  // far
  }
}

}  // namespace

bool isVisible(const Mat4& viewProj, const AABB& box) {
  float planes[6][4];
  extractPlanes(viewProj, planes);

  const Vec3 center{(box.min.x + box.max.x) * 0.5f, (box.min.y + box.max.y) * 0.5f, (box.min.z + box.max.z) * 0.5f};
  const Vec3 extent{(box.max.x - box.min.x) * 0.5f, (box.max.y - box.min.y) * 0.5f, (box.max.z - box.min.z) * 0.5f};

  for (int p = 0; p < 6; p++) {
    const float distance = planes[p][0] * center.x + planes[p][1] * center.y + planes[p][2] * center.z + planes[p][3];
    const float radius = std::fabs(planes[p][0]) * extent.x + std::fabs(planes[p][1]) * extent.y +
                         std::fabs(planes[p][2]) * extent.z;
    if (distance + radius < 0) return false;  // fully outside this plane
  }
  return true;
}

CullResult cullMeshes(const NativeScene& scene, const Mat4& viewProj) {
  CullResult result;
  result.totalCount = static_cast<int>(scene.meshes.size());
  for (int i = 0; i < result.totalCount; i++) {
    if (isVisible(viewProj, meshAABB(scene.meshes[i]))) {
      result.visibleMeshIndices.push_back(i);
    } else {
      result.culledCount++;
    }
  }
  return result;
}

std::vector<InstanceBatch> packInstanceBatches(const NativeScene& scene) {
  std::map<std::string, InstanceBatch> byKey;
  for (const auto& inst : scene.instances) {
    auto& batch = byKey[inst.batch];
    batch.batchKey = inst.batch;
    batch.instances.push_back(&inst);
  }
  std::vector<InstanceBatch> batches;
  batches.reserve(byKey.size());
  for (auto& [key, batch] : byKey) {
    batches.push_back(std::move(batch));
  }
  return batches;
}

}  // namespace heretek
