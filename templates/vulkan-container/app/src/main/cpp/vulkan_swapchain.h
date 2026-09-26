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

// ---- Host-testable swapchain policy helpers (no Vulkan headers) ------------
// Operates on the raw VkSurfaceCapabilitiesKHR::supportedCompositeAlpha mask
// so the host unit test can pin the selection rule without NDK headers.
// Bit values mirror VkCompositeAlphaFlagBitsKHR (vulkan_core.h); the NDK
// translation unit re-verifies them with static_asserts below.
namespace heretek {
namespace swapchain_policy {

constexpr uint32_t kCompositeAlphaOpaque = 0x1u;
constexpr uint32_t kCompositeAlphaPreMultiplied = 0x2u;
constexpr uint32_t kCompositeAlphaPostMultiplied = 0x4u;
constexpr uint32_t kCompositeAlphaInherit = 0x8u;

// Preference ladder: opaque first (no blending surprises on real hardware),
// then pre/post-multiplied, then inherit (what the lavapipe emulator
// reports). Returns 0 when the implementation advertises nothing — the
// caller must fail loudly instead of passing an unsupported flag.
inline uint32_t chooseCompositeAlpha(uint32_t supported) {
  if (supported & kCompositeAlphaOpaque) return kCompositeAlphaOpaque;
  if (supported & kCompositeAlphaPreMultiplied) return kCompositeAlphaPreMultiplied;
  if (supported & kCompositeAlphaPostMultiplied) return kCompositeAlphaPostMultiplied;
  if (supported & kCompositeAlphaInherit) return kCompositeAlphaInherit;
  return 0;
}

}  // namespace swapchain_policy
}  // namespace heretek
