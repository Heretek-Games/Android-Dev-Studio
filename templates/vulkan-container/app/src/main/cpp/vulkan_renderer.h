// Heretek Tier 2 — minimal Vulkan renderer bootstrap (NDK only).
//
// Compiled only when HERETEK_ENABLE_VULKAN is defined (the Android CMake build
// does this). Creates the instance, selects a physical device, and creates a
// logical device with a graphics queue — the foundation the Tier 2 render loop
// (swapchain, pipelines, instanced draws, compute culling) builds on.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "scene_loader.h"

namespace heretek {

class VulkanRenderer {
 public:
  bool initialize();
  void shutdown();

  /** Uploads the parsed scene into GPU-side instance data (stub until the
   *  pipeline lands; records counts for telemetry today). */
  void uploadScene(const NativeScene& scene);

  int drawCallEstimate() const { return drawCallEstimate_; }
  int instanceCount() const { return instanceCount_; }
  bool isReady() const { return device_ != nullptr; }
  const std::string& lastError() const { return lastError_; }

 private:
  bool createInstance();
  bool pickPhysicalDevice();
  bool createDevice();

  void* instance_ = nullptr;
  void* physicalDevice_ = nullptr;
  void* device_ = nullptr;
  void* queue_ = nullptr;
  uint32_t queueFamily_ = 0;
  int drawCallEstimate_ = 0;
  int instanceCount_ = 0;
  std::string lastError_;
};

}  // namespace heretek
