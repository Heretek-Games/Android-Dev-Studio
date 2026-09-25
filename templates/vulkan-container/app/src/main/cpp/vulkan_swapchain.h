// Heretek Tier 2 — Android Vulkan swapchain (NDK only).

#pragma once

#include <cstdint>
#include <vector>

#ifdef HERETEK_ENABLE_VULKAN

#include <android/native_window.h>
#include <vulkan/vulkan.h>
#include <vulkan/vulkan_android.h>

namespace heretek {

class VulkanSwapchain {
 public:
  bool create(VkInstance instance, VkPhysicalDevice physical, VkDevice device, uint32_t queueFamily,
              ANativeWindow* window, int width, int height);
  void destroy(VkDevice device);

  VkSwapchainKHR handle() const { return swapchain_; }
  VkRenderPass renderPass() const { return renderPass_; }
  VkExtent2D extent() const { return extent_; }
  uint32_t imageCount() const { return static_cast<uint32_t>(images_.size()); }
  VkFramebuffer framebuffer(uint32_t index) const { return framebuffers_[index]; }
  VkSurfaceFormatKHR format() const { return format_; }
  const char* lastError() const { return lastError_; }

 private:
  VkInstance instance_ = VK_NULL_HANDLE;
  VkSurfaceKHR surface_ = VK_NULL_HANDLE;
  VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  VkSurfaceFormatKHR format_{};
  VkExtent2D extent_{};
  std::vector<VkImage> images_;
  std::vector<VkImageView> imageViews_;
  std::vector<VkFramebuffer> framebuffers_;
  const char* lastError_ = "";
};

}  // namespace heretek

#endif  // HERETEK_ENABLE_VULKAN
