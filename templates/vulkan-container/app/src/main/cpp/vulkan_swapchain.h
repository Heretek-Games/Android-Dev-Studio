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
  VkImage image(uint32_t index) const { return images_[index]; }
  VkRenderPass renderPass() const { return renderPass_; }
  VkExtent2D extent() const { return extent_; }
  uint32_t imageCount() const { return static_cast<uint32_t>(images_.size()); }
  VkFramebuffer framebuffer(uint32_t index) const { return framebuffers_[index]; }
  VkSurfaceFormatKHR format() const { return format_; }
  const char* lastError() const { return lastError_; }

 private:
  // Device/instance-level extension functions must be resolved through
  // vkGetDeviceProcAddr / vkGetInstanceProcAddr on Android: the loader does not
  // dispatch extension entry points from its exported symbols (calling the
  // exported stubs returns VK_SUCCESS while doing nothing).
  PFN_vkCreateAndroidSurfaceKHR createAndroidSurface_ = nullptr;
  PFN_vkGetPhysicalDeviceSurfaceCapabilitiesKHR getSurfaceCaps_ = nullptr;
  PFN_vkGetPhysicalDeviceSurfaceFormatsKHR getSurfaceFormats_ = nullptr;
  PFN_vkCreateSwapchainKHR createSwapchain_ = nullptr;
  PFN_vkGetSwapchainImagesKHR getSwapchainImages_ = nullptr;
  PFN_vkDestroySwapchainKHR destroySwapchain_ = nullptr;
  PFN_vkDestroySurfaceKHR destroySurface_ = nullptr;

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
