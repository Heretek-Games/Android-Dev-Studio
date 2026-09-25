// Heretek Tier 2 — Vulkan renderer: surface/swapchain, compute culling
// dispatch, and instanced indirect draws.
//
// Two variants: the NDK build (HERETEK_ENABLE_VULKAN) owns real Vulkan
// objects; host builds get a stub with the same public surface so
// jni_bridge/scene code paths compile everywhere.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "scene_loader.h"

#ifdef HERETEK_ENABLE_VULKAN

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include "terrain_mesh.h"
#include "vulkan_swapchain.h"

namespace heretek {

class VulkanRenderer {
 public:
  bool initialize(const std::string& shaderDir);
  bool createSurface(ANativeWindow* window, int width, int height);
  void destroySurface();
  void renderFrame();
  /** Requests a one-shot readback of the next rendered frame (writes a PPM P6 file). */
  bool captureNextFrame(const std::string& path);
  void uploadScene(const NativeScene& scene);
  void shutdown();

  int drawCallEstimate() const { return drawCallEstimate_; }
  int instanceCount() const { return instanceCount_; }
  /** Terrain mesh planning telemetry (LOD leaves + generated vertices). */
  int terrainLeaves() const { return static_cast<int>(terrainPlan_.leaves); }
  int terrainVertices() const { return static_cast<int>(terrainPlan_.totalVertices); }
  bool isReady() const { return device_ != VK_NULL_HANDLE; }
  const std::string& lastError() const { return lastError_; }

 private:
  bool createInstance();
  bool pickPhysicalDevice();
  bool createDevice();
  bool createCommandPool();
  bool createBuffers();
  bool createDescriptors();
  bool createPipelines();
  VkShaderModule loadShader(const std::string& path);
  void recordFrame(VkCommandBuffer cmd, uint32_t imageIndex, bool capture);
  bool createBuffer(VkDeviceSize size, VkBufferUsageFlags usage, VkBuffer* buffer, VkDeviceMemory* memory, void** mapped);

  VkInstance instance_ = VK_NULL_HANDLE;
  VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
  VkDevice device_ = VK_NULL_HANDLE;
  VkQueue queue_ = VK_NULL_HANDLE;
  uint32_t queueFamily_ = 0;
  VulkanSwapchain swapchain_;
  VkCommandPool commandPool_ = VK_NULL_HANDLE;
  std::vector<VkCommandBuffer> commandBuffers_;
  std::vector<VkFence> inFlightFences_;
  VkSemaphore imageAvailable_ = VK_NULL_HANDLE;
  VkSemaphore renderFinished_ = VK_NULL_HANDLE;

  VkDescriptorSetLayout computeSetLayout_ = VK_NULL_HANDLE;
  VkDescriptorSetLayout graphicsSetLayout_ = VK_NULL_HANDLE;
  VkPipelineLayout computePipelineLayout_ = VK_NULL_HANDLE;
  VkPipelineLayout graphicsPipelineLayout_ = VK_NULL_HANDLE;
  VkPipelineLayout terrainPipelineLayout_ = VK_NULL_HANDLE;
  VkPipeline cullPipeline_ = VK_NULL_HANDLE;
  VkPipeline scenePipeline_ = VK_NULL_HANDLE;
  VkPipeline terrainPipeline_ = VK_NULL_HANDLE;
  VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
  VkDescriptorSet computeSet_ = VK_NULL_HANDLE;
  VkDescriptorSet graphicsSet_ = VK_NULL_HANDLE;

  // Host-visible buffers (scaffold keeps everything mappable; device-local
  // staging is the documented next optimization).
  VkBuffer instanceBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory instanceMemory_ = VK_NULL_HANDLE;
  void* instanceMapped_ = nullptr;
  VkBuffer visibleBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory visibleMemory_ = VK_NULL_HANDLE;
  VkBuffer indirectBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory indirectMemory_ = VK_NULL_HANDLE;
  void* indirectMapped_ = nullptr;
  VkBuffer vertexBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory vertexMemory_ = VK_NULL_HANDLE;
  VkBuffer indexBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory indexMemory_ = VK_NULL_HANDLE;

  // Terrain: one packed vertex/index pair + per-leaf indirect commands
  VkBuffer terrainVertexBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory terrainVertexMemory_ = VK_NULL_HANDLE;
  VkBuffer terrainIndexBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory terrainIndexMemory_ = VK_NULL_HANDLE;
  VkBuffer terrainIndirectBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory terrainIndirectMemory_ = VK_NULL_HANDLE;
  void* terrainIndirectMapped_ = nullptr;
  uint32_t terrainDrawCount_ = 0;

  bool createTerrainBuffers(size_t vertexBytes, size_t indexBytes, size_t commandBytes);

  // Extension entry points resolved via vkGetDeviceProcAddr (Android loader
  // does not dispatch device-level extension symbols).
  PFN_vkAcquireNextImageKHR acquireImage_ = nullptr;
  PFN_vkQueuePresentKHR queuePresent_ = nullptr;

  // One-shot frame readback (debug/verification): render -> copy to host-visible buffer
  bool captureRequested_ = false;
  std::string capturePath_;
  VkBuffer captureBuffer_ = VK_NULL_HANDLE;
  VkDeviceMemory captureMemory_ = VK_NULL_HANDLE;
  void* captureMapped_ = nullptr;
  bool writeCapturePpm();

  uint32_t instanceCount_ = 0;
  uint32_t indirectCommandCount_ = 0;
  int drawCallEstimate_ = 0;
  TerrainMeshPlan terrainPlan_{};
  uint32_t currentFrame_ = 0;
  std::string shaderDir_;
  std::string lastError_;
};

}  // namespace heretek

#else  // !HERETEK_ENABLE_VULKAN — host stub

namespace heretek {

class VulkanRenderer {
 public:
  bool initialize(const std::string& shaderDir = "") {
    shaderDir_ = shaderDir;
    lastError_ = "built without HERETEK_ENABLE_VULKAN";
    return false;
  }
  bool createSurface(void* /*window*/, int /*width*/, int /*height*/) { return false; }
  void destroySurface() {}
  void renderFrame() {}
  bool captureNextFrame(const std::string& /*path*/) { return false; }
  void uploadScene(const NativeScene& scene) {
    drawCallEstimate_ = scene.drawCallEstimate();
    instanceCount_ = static_cast<int>(scene.instances.size());
  }
  void shutdown() {}

  int drawCallEstimate() const { return drawCallEstimate_; }
  int instanceCount() const { return instanceCount_; }
  int terrainLeaves() const { return 0; }
  int terrainVertices() const { return 0; }
  bool isReady() const { return false; }
  const std::string& lastError() const { return lastError_; }

 private:
  int drawCallEstimate_ = 0;
  int instanceCount_ = 0;
  std::string shaderDir_;
  std::string lastError_;
};

}  // namespace heretek

#endif  // HERETEK_ENABLE_VULKAN
