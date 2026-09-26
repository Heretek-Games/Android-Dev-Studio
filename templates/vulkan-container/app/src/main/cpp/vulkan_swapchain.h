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
  // Destroys the swapchain + image views + render pass + framebuffers while
  // keeping the surface alive. Used both by destroy() (before surface
  // teardown) and by create() failure paths so a half-built swapchain never
  // leaks device objects.
  void destroySwapchainObjects(VkDevice device);
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

// VkFormat mirrors (vulkan_core.h); the NDK translation unit re-verifies them
// with static_asserts next to the compositeAlpha mirrors.
constexpr uint32_t kFormatR8G8B8A8Unorm = 37;
constexpr uint32_t kFormatB8G8R8A8Unorm = 44;

// Preference ladder: first 8-bit RGBA entry (R or B channel order, either of
// which the copy-to-staging readback handles), else index 0. Returns
// UINT32_MAX when count == 0 — the caller must fail loudly instead of
// indexing formats[0] out of bounds.
inline uint32_t chooseFormatIndex(const uint32_t* formats, uint32_t count) {
  if (formats == nullptr || count == 0) return UINT32_MAX;
  for (uint32_t i = 0; i < count; i++) {
    if (formats[i] == kFormatR8G8B8A8Unorm || formats[i] == kFormatB8G8R8A8Unorm) return i;
  }
  return 0;
}

struct Extent2D {
  uint32_t width = 0;
  uint32_t height = 0;
};

// Resolves the swapchain extent from the surface capabilities: an
// implementation-defined current extent wins unless it carries the
// UINT32_MAX sentinel, in which case the requested size is clamped into the
// [min, max] bounds. A 0x0 result means minimized — the caller must skip
// creation/recreation, not build a zero-area swapchain.
inline Extent2D resolveExtent(uint32_t reqW, uint32_t reqH, uint32_t minW, uint32_t minH,
                              uint32_t maxW, uint32_t maxH, uint32_t curW, uint32_t curH) {
  Extent2D out;
  if (curW != UINT32_MAX && curH != UINT32_MAX) {
    out.width = curW;
    out.height = curH;
    return out;
  }
  out.width = reqW < minW ? minW : (reqW > maxW ? maxW : reqW);
  out.height = reqH < minH ? minH : (reqH > maxH ? maxH : reqH);
  return out;
}

// Size-change predicate for the surfaceChanged hook: a live surface whose
// dimensions differ needs a rebuild. Not a pure "differ" check — a 0 new
// size is the minimized/backgrounded state, which must skip recreation.
inline bool shouldRecreateOnSizeChange(uint32_t oldW, uint32_t oldH, uint32_t newW,
                                       uint32_t newH) {
  if (newW == 0 || newH == 0) return false;
  return oldW != newW || oldH != newH;
}

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
